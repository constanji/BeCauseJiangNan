/**
 * Shared helper for config-admin save responses that include runtime reload metadata.
 */
export type RuntimeReloadResult = {
  yamlSaved?: boolean;
  runtimeReloaded?: boolean;
  warnings?: string[];
  needRestart?: boolean;
  message?: string;
  success?: boolean;
};

export function formatConfigSaveToast(
  result: RuntimeReloadResult,
  fallbackSuccessMessage: string,
): { message: string; status: 'success' | 'warning' | 'error' } {
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [];
  const yamlSaved = result.yamlSaved !== false;
  const runtimeReloaded = result.runtimeReloaded === true;

  if (yamlSaved && runtimeReloaded && warnings.length === 0) {
    return { message: result.message || fallbackSuccessMessage, status: 'success' };
  }

  if (yamlSaved && runtimeReloaded && warnings.length > 0) {
    return {
      message: `${result.message || fallbackSuccessMessage}（部分警告：${warnings.slice(0, 2).join('；')}）`,
      status: 'warning',
    };
  }

  if (yamlSaved && !runtimeReloaded) {
    const hint = result.needRestart
      ? '配置已写入，但运行时重载失败，请重载后端服务（必要时再重启 api 容器）'
      : '配置已写入，运行时可能未完全刷新，请刷新页面或重载后端配置';
    const extra = warnings.length ? `：${warnings[0]}` : '';
    return { message: `${hint}${extra}`, status: 'warning' };
  }

  return {
    message: result.message || '保存失败',
    status: 'error',
  };
}
