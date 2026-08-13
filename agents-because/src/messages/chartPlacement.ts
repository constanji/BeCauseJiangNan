/**
 * Chart placeholder construction and placement helpers.
 * Marker format: @ec@<marker>:<id>@ec@  (marker defaults to chart type or agent config)
 */

export const EC_MARKER_RE = /@ec@([^:@]+(?::[^@]+)?)@ec@/g;
export const EC_PARTIAL_OPEN = '@ec@';

import type { ChartRole } from '@/utils/autoChartRules/types';

export type PlacementChart = {
  chartId: string;
  role: ChartRole;
  marker?: string;
  /** Prefer bar/line/pie for legacy-compatible markers when marker omitted */
  typeHint?: string;
};

export function buildPlaceholder(
  marker: string | undefined,
  chartId: string,
  typeHint = 'bar',
): string {
  const m = (marker && marker.trim()) || typeHint;
  return `@ec@${m}:${chartId}@ec@`;
}

/** Strip all @ec@...@ec@ markers from text (for multi-turn history isolation). */
export function stripChartPlaceholders(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  return text.replace(EC_MARKER_RE, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Insert placeholders before the first visible paragraph of body text.
 * If text is empty, returns placeholders joined by newlines.
 */
export function placePrepend(
  text: string,
  placeholders: string[],
): string {
  if (!placeholders.length) {
    return text;
  }
  const block = placeholders.join('\n');
  if (!text || !text.trim()) {
    return block;
  }
  // Insert before first non-whitespace content
  const match = text.match(/^(\s*)/);
  const lead = match?.[1] ?? '';
  const rest = text.slice(lead.length);
  return `${lead}${block}\n\n${rest}`;
}

const SECTION_HINTS: Record<ChartRole, string[]> = {
  indicator: ['总体变化', '总体情况', '指标变化', '整体变化'],
  contribution: ['主要增加项', '增加项', '主要贡献', '正向贡献', '贡献因素', '贡献分析'],
  drag: ['主要减少项', '减少项', '主要拖累', '负向拖累', '拖累因素', '拖累分析'],
  general: [],
};

/**
 * Insert a placeholder near the matching semantic section heading.
 * If no section found, append at end of buffer.
 */
export function placeSemantic(
  text: string,
  placeholder: string,
  role: ChartRole,
): string {
  if (!placeholder) {
    return text;
  }
  // Already present — keep first occurrence only
  if (text.includes(placeholder)) {
    return text;
  }

  const hints = SECTION_HINTS[role] ?? [];
  for (const hint of hints) {
    const idx = text.indexOf(hint);
    if (idx < 0) {
      continue;
    }
    // Insert after the heading line
    const lineEnd = text.indexOf('\n', idx);
    const insertAt = lineEnd >= 0 ? lineEnd + 1 : text.length;
    return (
      text.slice(0, insertAt) +
      placeholder +
      '\n' +
      text.slice(insertAt)
    );
  }

  return text ? `${text}\n\n${placeholder}` : placeholder;
}

export type PlacementBufferState = {
  text: string;
  pendingPlaceholders: string[];
  roles: ChartRole[];
  active: boolean;
};

/**
 * Streaming buffer keyed by stepId for semantic placement.
 */
export class ChartPlacementBufferMap {
  private buffers = new Map<string, PlacementBufferState>();

  getOrCreate(stepId: string): PlacementBufferState {
    let buf = this.buffers.get(stepId);
    if (!buf) {
      buf = {
        text: '',
        pendingPlaceholders: [],
        roles: [],
        active: false,
      };
      this.buffers.set(stepId, buf);
    }
    return buf;
  }

  activate(
    stepId: string,
    placeholders: string[],
    roles: ChartRole[],
  ): void {
    const buf = this.getOrCreate(stepId);
    buf.active = true;
    buf.pendingPlaceholders = [...placeholders];
    buf.roles = [...roles];
  }

  /**
   * Push a text delta. When buffering is active, accumulate and return null
   * (caller should not dispatch yet). When inactive, return delta unchanged.
   */
  pushDelta(stepId: string, delta: string): string | null {
    const buf = this.buffers.get(stepId);
    if (!buf?.active) {
      return delta;
    }
    buf.text += delta;
    // Flush on paragraph boundary (double newline)
    if (/\n\n/.test(buf.text)) {
      return this.flush(stepId);
    }
    return null;
  }

  /**
   * Flush remaining buffer: apply semantic placement then return final text.
   */
  flush(stepId: string): string {
    const buf = this.buffers.get(stepId);
    if (!buf) {
      return '';
    }
    let text = buf.text;
    for (let i = 0; i < buf.pendingPlaceholders.length; i++) {
      const ph = buf.pendingPlaceholders[i];
      const role = buf.roles[i] ?? 'general';
      text = placeSemantic(text, ph, role);
    }
    buf.text = '';
    buf.pendingPlaceholders = [];
    buf.roles = [];
    buf.active = false;
    this.buffers.delete(stepId);
    return text;
  }

  flushAll(): Map<string, string> {
    const result = new Map<string, string>();
    for (const stepId of [...this.buffers.keys()]) {
      const text = this.flush(stepId);
      if (text) {
        result.set(stepId, text);
      }
    }
    return result;
  }

  clear(): void {
    this.buffers.clear();
  }
}
