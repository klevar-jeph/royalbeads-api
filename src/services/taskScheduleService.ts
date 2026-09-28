// src/services/taskScheduleService.ts
// Task schedule evaluation engine.
// Priority:
// 1. Explicit date override
// 2. Audit / holiday rule
// 3. Level-specific schedule
// 4. Weekly schedule (Mon-Fri enabled, Sat/Sun configurable)
// 5. Global task availability

import { TaskScheduleOverride } from '../models/TaskScheduleOverride';
import { systemSettingService } from './systemSettingService';
import { LevelConfig } from '../models/LevelConfig';
import { levelService } from './levelService';


export interface TaskAvailabilityResult {
  enabled: boolean;
  status: 'ENABLED' | 'DISABLED';
  reason?: string;
}

export const taskScheduleService = {
  async evaluateTaskAvailability(
    userLevelCode: string,
    date = new Date()
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

    // Intern weekend schedule
    if (userLevelCode.toUpperCase() === 'INTERN' && settings.taskInternWeekendEnabled) {
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
