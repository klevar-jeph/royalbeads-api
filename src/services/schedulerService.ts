// src/services/schedulerService.ts
// Central server-side scheduling for automated financial and retention jobs.
//
// Every job is IDEMPOTENT and safe to run concurrently or repeatedly:
//  - month-end salary finalization transitions each ACCUMULATING record to
//    READY_TO_CLAIM exactly once (guarded by a status-conditional update),
//  - weekly retention evaluation upserts one record per position/week,
//  - weekly event activation/expiration is derived from the event dates.
//
// No user session is required: jobs run from the server process only.

import { salaryService, getMonthString } from './salaryService';
import { WeeklyEvent } from '../models/WeeklyEvent';

const HOUR_MS = 60 * 60 * 1000;

interface JobState {
  lastMonthFinalized?: string;
  lastRetentionWeek?: string;
}

const state: JobState = {};

/** ISO week bucket (YYYY-Www) used to run retention once per week. */
function isoWeekBucket(date = new Date()): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * HOUR_MS));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const schedulerService = {
  /**
   * True on the last calendar day of the month (UTC), when the previous month
   * should be finalized.
   */
  isMonthEnd(date = new Date()): boolean {
    const tomorrow = new Date(date.getTime() + 24 * HOUR_MS);
    return tomorrow.getUTCMonth() !== date.getUTCMonth();
  },

  /** Run the month-end salary job once per month (idempotent). */
  async runMonthEndJob(date = new Date()): Promise<{ ran: boolean; finalizedCount?: number }> {
    // Finalize the month that just ended.
    const previous = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
    const targetMonth = getMonthString(previous);

    if (state.lastMonthFinalized === targetMonth) return { ran: false };
    const { finalizedCount } = await salaryService.finalizeMonthEnd(targetMonth);
    state.lastMonthFinalized = targetMonth;
    return { ran: true, finalizedCount };
  },

  /** Run the weekly retention evaluation once per ISO week (idempotent). */
  async runWeeklyRetentionJob(date = new Date()): Promise<{ ran: boolean; evaluated?: number }> {
    const bucket = isoWeekBucket(date);
    if (state.lastRetentionWeek === bucket) return { ran: false };
    const { evaluated } = await salaryService.evaluateWeeklyRetention();
    state.lastRetentionWeek = bucket;
    return { ran: true, evaluated };
  },

  /** Expire weekly events whose end date has passed (idempotent). */
  async expireWeeklyEvents(date = new Date()): Promise<{ expired: number }> {
    const result = await WeeklyEvent.updateMany(
      { active: true, endDate: { $lt: date } },
      { $set: { active: false } }
    );
    return { expired: result.modifiedCount ?? 0 };
  },

  /** Tick handler: evaluates which jobs are due and runs them. */
  async tick(date = new Date()): Promise<void> {
    try {
      await schedulerService.expireWeeklyEvents(date);
      if (schedulerService.isMonthEnd(date)) {
        await schedulerService.runMonthEndJob(date);
      }
      await schedulerService.runWeeklyRetentionJob(date);
    } catch (err) {
      console.error('[scheduler] Job run failed:', err instanceof Error ? err.message : err);
    }
  },

  /**
   * Start the hourly scheduler. Returns a stop function for graceful shutdown.
   * Never fatal: a failed tick is logged and retried on the next interval.
   */
  start(intervalMs = HOUR_MS): () => void {
    // Run once shortly after boot, then on the configured interval.
    const firstRun = setTimeout(() => {
      void schedulerService.tick();
    }, 30_000);
    firstRun.unref?.();

    const timer = setInterval(() => {
      void schedulerService.tick();
    }, intervalMs);
    timer.unref?.();

    return () => {
      clearTimeout(firstRun);
      clearInterval(timer);
    };
  },
};
