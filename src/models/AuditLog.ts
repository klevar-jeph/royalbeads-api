// src/models/AuditLog.ts
// Immutable audit trail of every administrative mutation.
//
// One document per admin action: who did it (actor), what they did (action),
// to what (targetType/targetId), extra context (meta) and the client IP when
// available. Audit logs are append-only — no route updates or deletes them.

import { Schema, model, Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  actorId: Types.ObjectId;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorEmail: { type: String, required: true },
    action: { type: String, required: true, trim: true, maxlength: 80, index: true },
    targetType: { type: String, required: true, trim: true, maxlength: 40 },
    targetId: { type: String, trim: true, maxlength: 64 },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String, trim: true, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema);
