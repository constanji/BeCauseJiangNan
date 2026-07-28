import orgPermissionUnitSchema from '~/schema/orgPermissionUnit';
import type { IOrgPermissionUnit } from '~/types';

export function createOrgPermissionUnitModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.OrgPermissionUnit ||
    mongoose.model<IOrgPermissionUnit>('OrgPermissionUnit', orgPermissionUnitSchema)
  );
}
