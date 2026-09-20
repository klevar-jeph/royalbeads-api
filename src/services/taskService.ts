// src/services/taskService.ts
// Tasks & rewards engine.
//
// Definitions are seeded from src/config/tasks.ts (idempotent sync). A user
// can complete each task `dailyLimit` times per UTC day. Rewards are credited
// through the wallet service with an idempotency key so retries cannot
// double-pay. Tasks above the user's VIP tier are hidden.

import { User } from '../models/User';
import { Task, ITask } from '../models/Task';
import { TaskCompletion, ITaskCompletion } from '../models/TaskCompletion';
import { Notification, NotificationType } from '../models/Notification';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { TASK_SEEDS } from '../config/tasks';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** UTC day bucket: YYYY-MM-DD. */
export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export const taskService = {
  /**
   * Idempotently sync seed definitions into the Task collection. Safe to call
   * on every request path / startup; only inserts missing keys.
   */
  async syncDefinitions(): Promise<void> {
    const keys = TASK_SEEDS.map((t) => t.key);
    const existing = await Task.find({ key: { $in: keys } }).select('key');
    const existingKeys = new Set(existing.map((t) => t.key));
    const missing = TASK_SEEDS.filter((t) => !existingKeys.has(t.key));
    if (missing.length > 0) {
      await Task.insertMany(missing);
    }
  },

  /**
   * Today's task list for the user: tasks visible at their VIP tier with
   * completion counts for the current UTC day and potential earnings.
   */
  async listForUser(userId: string | Types.ObjectId) {
    await taskService.syncDefinitions();

    const user = await User.findById(userId).select('vipLevel');
    if (!user) throw httpError(404, 'User not found.');
    const vipTier = user.vipLevel ?? 0;

    const day = utcDay();
    const tasks = await Task.find({ active: true }).sort({ sortOrder: 1 });
    const completions = await TaskCompletion.find({ userId, day }).select('taskKey reward');

    const completionsByKey = new Map<string, { count: number; reward: number }>();
    let earnedToday = 0;
    for (const c of completions) {
      const entry = completionsByKey.get(c.taskKey) ?? { count: 0, reward: 0 };
      entry.count += 1;
      entry.reward += c.reward;
      earnedToday += c.reward;
      completionsByKey.set(c.taskKey, entry);
    }

    const items = tasks.map((task: ITask) => {
      const entry = completionsByKey.get(task.key) ?? { count: 0, reward: 0 };
      const locked = vipTier < task.minVipTier;
      return {
        id: task._id.toString(),
        key: task.key,
        title: task.title,
        description: task.description,
        reward: task.reward,
        minVipTier: task.minVipTier,
        dailyLimit: task.dailyLimit,
        completedToday: entry.count,
        remainingToday: locked ? 0 : Math.max(task.dailyLimit - entry.count, 0),
        locked,
      };
    });

    return {
      day,
      items,
      completedToday: completions.length,
      earnedToday,
    };
  },

  /** The user's completion history (most recent first). */
  async listCompletions(userId: string | Types.ObjectId, limit = 30): Promise<ITaskCompletion[]> {
    return TaskCompletion.find({ userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100));
  },

  /**
   * Complete a task once now. Validates the task is active, unlocked by VIP
   * tier, and under its daily limit; credits the reward to the wallet and
   * notifies the user.
   */
  async complete(
    userId: string | Types.ObjectId,
    taskId: string
  ): Promise<{ completion: ITaskCompletion; reward: number }> {
    const user = await User.findById(userId).select('vipLevel');
    if (!user) throw httpError(404, 'User not found.');

    const task = await Task.findById(taskId);
    if (!task || !task.active) throw httpError(404, 'Task not found.');
    if ((user.vipLevel ?? 0) < task.minVipTier) {
      throw httpError(403, `This task requires VIP level R${task.minVipTier}.`);
    }

    const day = utcDay();
    const doneToday = await TaskCompletion.countDocuments({ userId, taskKey: task.key, day });
    if (doneToday >= task.dailyLimit) {
      throw httpError(409, 'You have already completed this task for today.');
    }

    const idempotencyKey = `${userId}-${task.key}-${day}-${doneToday + 1}`;

    // The unique index is the final guard against double claims.
    let completion: ITaskCompletion;
    try {
      completion = await TaskCompletion.create({
        userId,
        taskKey: task.key,
        taskTitle: task.title,
        day,
        reward: task.reward,
      });
    } catch {
      throw httpError(409, 'You have already completed this task for today.');
    }

    try {
      await walletService.credit(
        userId,
        TransactionType.TASK_REWARD,
        task.reward,
        `Task reward: ${task.title}`,
        { idempotencyKey, meta: { taskId: task._id.toString(), taskKey: task.key, day } }
      );
    } catch (err) {
      // Roll back the completion if crediting failed so the attempt isn't lost.
      await TaskCompletion.deleteOne({ _id: completion._id });
      throw err;
    }

    await Notification.create({
      userId,
      type: NotificationType.TASK,
      title: 'Task reward credited',
      message: `You earned ₦${task.reward.toLocaleString()} for completing "${task.title}".`,
    });

    return { completion, reward: task.reward };
  },
};
