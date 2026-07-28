import type { Document, Types } from 'mongoose';

export type OrgPermissionSource = 'manual' | 'table' | 'excel';

export type OrgDataScope = 'ALL' | 'SELF_AND_DESCENDANTS' | 'SELF';

export interface IOrgPermissionUnit extends Document {
  _id: Types.ObjectId;
  orgCode: string;
  orgName?: string;
  parentOrgCode?: string | null;
  brchLv?: number | null;
  enabled: boolean;
  source: OrgPermissionSource;
  dataDt?: string | null;
  importedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IOrgPermissionSettings extends Document {
  _id: Types.ObjectId;
  configId: string;
  enforcementEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
