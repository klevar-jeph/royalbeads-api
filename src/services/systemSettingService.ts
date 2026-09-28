// src/services/systemSettingService.ts
// Service for global platform settings, Audit Mode, and task schedule configurations.

import { SystemSetting, ISystemSetting } from '../models/SystemSetting';
import { bootstrapService } from './bootstrapService';

export const systemSettingService = {
  async getSettings(): Promise<ISystemSetting> {
    await bootstrapService.bootstrapSettings();
    let settings = await SystemSetting.findOne({ key: 'GLOBAL' });
    if (!settings) {
      settings = await SystemSetting.create({ key: 'GLOBAL' });
    }
    return settings;
  },

  async updateSettings(patch: Partial<ISystemSetting>): Promise<ISystemSetting> {
    const settings = await systemSettingService.getSettings();
    Object.assign(settings, patch);
    await settings.save();
    return settings;
  },

  async isAuditModeActive(): Promise<boolean> {
    const settings = await systemSettingService.getSettings();
    if (!settings.auditModeActive) return false;
    const now = new Date();
    if (settings.auditModeStart && now < settings.auditModeStart) return false;
    if (settings.auditModeEnd && now > settings.auditModeEnd) return false;
    return true;
  },
};
