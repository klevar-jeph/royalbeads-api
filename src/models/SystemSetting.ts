// src/models/SystemSetting.ts
// Global platform configuration including Audit Mode, Withdrawal Rules, and Task Schedules.

import { Schema, model, Document } from 'mongoose';

export interface ISystemSetting extends Document {
  key: string; // 'GLOBAL'
  // Audit Mode
  auditModeActive: boolean;
  auditModeStart?: Date;
  auditModeEnd?: Date;
  auditNotice: string;
  auditDisableWithdrawals: boolean;
  auditDisableTasks: boolean;
  auditDisableTaskRewards: boolean;

  // Task Schedule Engine
  taskWeekdaysEnabled: boolean; // default true (Mon-Fri)
  taskSaturdayEnabled: boolean; // default false / configurable
  taskSundayEnabled: boolean;   // default false / configurable
  taskInternWeekendEnabled: boolean; // Intern Mon-Sun enabled by default

  // Withdrawal Rules
  withdrawalFeePercent: number; // default 10%
  withdrawalFeeEnabled: boolean; // default true
  minWithdrawal: number; // default 5000
  maxWithdrawal: number; // default 1000000
  withdrawalDays: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri (0=Sun, 6=Sat)
  withdrawalStartTime: string; // e.g. "08:00"
  withdrawalEndTime: string;   // e.g. "17:00"
  withdrawalSuspended: boolean;

  // Lucky Draw Referral condition
  luckyDrawMinReferralDeposit: number; // minimum deposit or upgrade of referred user to grant spin

  createdAt: Date;
  updatedAt: Date;
}

const SystemSettingSchema = new Schema<ISystemSetting>(
  {
    key: { type: String, required: true, unique: true, default: 'GLOBAL' },
    // Audit Mode
    auditModeActive: { type: Boolean, default: false },
    auditModeStart: { type: Date },
    auditModeEnd: { type: Date },
    auditNotice: { type: String, default: 'System is currently in audit mode.' },
    auditDisableWithdrawals: { type: Boolean, default: true },
    auditDisableTasks: { type: Boolean, default: true },
    auditDisableTaskRewards: { type: Boolean, default: true },

    // Task Schedules
    taskWeekdaysEnabled: { type: Boolean, default: true },
    taskSaturdayEnabled: { type: Boolean, default: false },
    taskSundayEnabled: { type: Boolean, default: false },
    taskInternWeekendEnabled: { type: Boolean, default: true },

    // Withdrawal Rules
    withdrawalFeePercent: { type: Number, default: 10, min: 0, max: 100 },
    withdrawalFeeEnabled: { type: Boolean, default: true },
    minWithdrawal: { type: Number, default: 5000, min: 100 },
    maxWithdrawal: { type: Number, default: 1000000, min: 1000 },
    withdrawalDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    withdrawalStartTime: { type: String, default: '00:00' },
    withdrawalEndTime: { type: String, default: '23:59' },
    withdrawalSuspended: { type: Boolean, default: false },

    // Lucky Draw
    luckyDrawMinReferralDeposit: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const SystemSetting = model<ISystemSetting>('SystemSetting', SystemSettingSchema);
