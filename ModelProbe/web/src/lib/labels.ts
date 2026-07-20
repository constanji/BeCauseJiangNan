/** 状态 / 层名等前端展示文案 */

export const STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export const LAYER_LABEL: Record<string, string> = {
  direct: '直连层',
  assembled: '组装层',
};

export function statusLabel(status?: string) {
  if (!status) return '—';
  return STATUS_LABEL[status] || status;
}

export const REPORT_KIND_LABEL: Record<string, string> = {
  performance: '性能',
  capability: '规范/工具',
};

export function reportKindLabel(kind?: string) {
  if (!kind) return '性能';
  return REPORT_KIND_LABEL[kind] || kind;
}

export function layerLabel(layer?: string) {
  if (!layer) return '—';
  return LAYER_LABEL[layer] || layer;
}
