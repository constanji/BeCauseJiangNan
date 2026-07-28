import orgPermissionSettingsSchema from '~/schema/orgPermissionSettings';
import type { IOrgPermissionSettings } from '~/types';

export function createOrgPermissionSettingsModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.OrgPermissionSettings ||
    mongoose.model<IOrgPermissionSettings>('OrgPermissionSettings', orgPermissionSettingsSchema)
  );
}
