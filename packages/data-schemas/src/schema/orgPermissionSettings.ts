import { Schema } from 'mongoose';
import type { IOrgPermissionSettings } from '~/types';

const orgPermissionSettingsSchema = new Schema<IOrgPermissionSettings>(
  {
    configId: {
      type: String,
      default: 'default',
      unique: true,
      index: true,
    },
    /** 默认关闭：关闭时 MCP 不拦截，等同当前软透传行为 */
    enforcementEnabled: {
      type: Boolean,
      default: false,
    },
    /**
     * 独立开关：控制 Because-jn sql-executor 是否按机构权限强制校验/改写 SQL
     * （越权的 org_code 字面量直接拒绝执行；IN(...) 列表按可访问范围收窄）。
     * 与 enforcementEnabled（MCP 门禁）解耦，可单独开启。默认关闭。
     */
    sqlEnforcementEnabled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

export default orgPermissionSettingsSchema;
