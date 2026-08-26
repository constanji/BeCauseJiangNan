import { Schema } from 'mongoose';
import type { IOrgPermissionUnit } from '~/types';

const orgPermissionUnitSchema = new Schema<IOrgPermissionUnit>(
  {
    orgCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    orgName: {
      type: String,
      default: '',
      trim: true,
    },
    parentOrgCode: {
      type: String,
      default: null,
      index: true,
      trim: true,
    },
    /** 1=全行 2=本级+下级 3=管理行本级+下级 4=仅本级 */
    brchLv: {
      type: Number,
      min: 1,
      max: 4,
      default: null,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['manual', 'table', 'excel'],
      default: 'manual',
    },
    dataDt: {
      type: String,
      default: null,
    },
    importedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

export default orgPermissionUnitSchema;
