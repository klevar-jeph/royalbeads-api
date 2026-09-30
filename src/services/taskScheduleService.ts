// src/services/taskScheduleService.ts
// Task schedule evaluation engine.
// Priority:
// 1. Explicit date override
// 2. Audit / holiday rule
// 3. Level-specific schedule
// 4. Intern one-time working-day allowance (3 days total, any weekday/Sunday)
// 5. Weekly schedule (Mon-Fri enabled, Sat/Sun configurable)
// 6. Global task availability

import { Types } from 'mongoose';
import { TaskScheduleOverride } from '../models/TaskScheduleOverride';
import { TaskCompletion } from '../models/TaskCompletion';
import { systemSettingService } from './systemSettingService';
import { LevelConfig } from '../models/LevelConfig';
import { levelService } from './levelService';


export interface TaskAvailabilityResult {
  enabled: boolean;
  status: 'ENABLED' | 'DISABLED';
  reason?: string;
}

/** Interns may work this many distinct days in total before upgrading. */
export const INTERN_TOTAL_WORKING_DAYS = 3;

export const taskScheduleService = {
  /**
   * Whether `userLevelCode` may complete tasks on `date`.
   *
   * `userId` powers the Intern one-time allowance (3 distinct working days);
   * every real call site passes it. Without a `userId` only the day/week rules
   * are evaluated (used by level-agnostic tests).
   */
  async evaluateTaskAvailability(
    userLevelCode: string,
    date = new Date(),
    userId?: string | Types.ObjectId
  ): Promise<TaskAvailabilityResult> {
    const dayOfWeek = date.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD

    // 1. Explicit date override check
    const override = await TaskScheduleOverride.findOne({ date: dateStr });
    if (override) {
      if (!override.applicableLevels || override.applicableLevels.length === 0 || override.applicableLevels.includes(userLevelCode.toUpperCase())) {
        if (!override.enabled) {
          return {
            enabled: false,
            status: 'DISABLED',
            reason: `Disabled because of ${override.reason || 'date override'}`,
          };
        }
        return { enabled: true, status: 'ENABLED' };
      }
    }

    // 2. Audit Mode check
    const isAudit = await systemSettingService.isAuditModeActive();
    if (isAudit) {
      const settings = await systemSettingService.getSettings();
      if (settings.auditDisableTasks) {
        return {
          enabled: false,
          status: 'DISABLED',
          reason: 'Disabled because of audit',
        };
      }
    }

    // 3. Level Open/Locked check
    const level = await LevelConfig.findOne({ code: userLevelCode.toUpperCase() });
    if (level && !levelService.isLevelAccessible(level)) {
      return {
        enabled: false,
        status: 'DISABLED',
        reason: "Disabled because user's level cannot access it (Level is locked)",
      };
    }

    // 4. Weekly schedule check
    const settings = await systemSettingService.getSettings();
    const isIntern = userLevelCode.toUpperCase() === 'INTERN';

    // Intern one-time allowance: 3 distinct working days in total (lifetime),
    // counted from days the intern actually completed at least one task.
    if (isIntern && userId) {
      const workedDays = await TaskCompletion.distinct<string>('day', { userId });
      if (
        workedDays.length >= INTERN_TOTAL_WORKING_DAYS &&
        !workedDays.includes(dateStr)
      ) {
        return {
          enabled: false,
          status: 'DISABLED',
          reason: `You have used all ${INTERN_TOTAL_WORKING_DAYS} Intern working days — upgrade your membership to continue tasks.`,
        };
      }
    }

    // Intern weekend schedule (enabled on every day of the week).
    if (isIntern && settings.taskInternWeekendEnabled) {
      return { enabled: true, status: 'ENABLED' };
    }

    // Interns always work Sundays while their allowance lasts — even when the
    // global Sunday schedule is off.
    if (isIntern && dayOfWeek === 0) {
      return { enabled: true, status: 'ENABLED' };
    }

    // Saturday
    if (dayOfWeek === 6) {
      if (!settings.taskSaturdayEnabled) {
        return {
          enabled: false,
          status: 'DISABLED',
          reason: 'Disabled because of weekend schedule (Saturday disabled)',
        };
      }
    }

    // Sunday
    if (dayOfWeek === 0) {
      if (!settings.taskSundayEnabled) {
        return {
          enabled: false,
          status: 'DISABLED',
          reason: 'Disabled because of weekend schedule (Sunday disabled)',
        };
      }
    }

    // Weekdays (Mon-Fri)
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      if (!settings.taskWeekdaysEnabled) {
        return {
          enabled: false,
          status: 'DISABLED',
          reason: 'Disabled because of weekday schedule',
        };
      }
    }

    return { enabled: true, status: 'ENABLED' };
  },
};
