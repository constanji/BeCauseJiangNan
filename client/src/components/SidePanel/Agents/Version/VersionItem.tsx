import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn, defaultTextProps, removeFocusOutlines } from '~/utils';
import type { VersionRecord } from './types';
import type { VersionChange, VersionChangeSummary } from './getVersionChanges';
import { buildSideBySideDiff } from './promptDiff';

type VersionItemProps = {
  version: VersionRecord;
  index: number;
  isActive: boolean;
  versionsLength: number;
  originalIndex: number;
  changeSummary: VersionChangeSummary;
  isLast?: boolean;
  onRestore: (index: number) => void;
  onSaveNote?: (originalIndex: number, note: string) => Promise<void> | void;
};

const noteInputClass = cn(
  defaultTextProps,
  'w-full min-h-[72px] resize-y px-3 py-2 border-border-light bg-surface-secondary text-text-primary dark:text-text-primary placeholder:text-text-secondary',
  removeFocusOutlines,
);

const PREVIEW_LEN = 80;

function truncatePreview(value: string, max = PREVIEW_LEN): string {
  const t = value.trim();
  if (!t) return '（空）';
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…（共 ${t.length} 字）`;
}

function oneLineSummary(change: VersionChange): string {
  if (change.field === 'tools') {
    return change.after;
  }
  if (change.longText) {
    return `${truncatePreview(change.before)} → ${truncatePreview(change.after)}`;
  }
  return `${change.before} → ${change.after}`;
}

function LongTextDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => buildSideBySideDiff(before, after), [before, after]);
  const changedOnly = useMemo(
    () => rows.filter((r) => r.kind !== 'equal'),
    [rows],
  );
  const [showUnchanged, setShowUnchanged] = useState(false);
  const visible = showUnchanged ? rows : changedOnly.length > 0 ? changedOnly : rows;

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
        <span>
          前 {before.length} 字 → 后 {after.length} 字
          {!showUnchanged && changedOnly.length > 0
            ? ` · 仅差异 ${changedOnly.length} 行`
            : ` · 共 ${rows.length} 行`}
        </span>
        {changedOnly.length > 0 && changedOnly.length < rows.length && (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => setShowUnchanged((v) => !v)}
          >
            {showUnchanged ? '只看差异行' : '显示全文对照'}
          </button>
        )}
      </div>
      <div className="grid max-h-[min(60vh,28rem)] grid-cols-1 gap-0 overflow-auto rounded-lg border border-border-light md:grid-cols-2">
        <div className="border-b border-border-light bg-surface-secondary/60 px-3 py-1.5 text-xs font-medium text-text-secondary md:border-b-0 md:border-r">
          之前
        </div>
        <div className="hidden bg-surface-secondary/60 px-3 py-1.5 text-xs font-medium text-text-secondary md:block">
          当前
        </div>
        {visible.map((row, idx) => (
          <div key={idx} className="contents">
            <div
              className={cn(
                'border-b border-border-light px-3 py-1 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words md:border-r',
                row.kind === 'remove' || row.kind === 'change'
                  ? 'bg-red-500/10 text-text-primary'
                  : 'bg-surface-primary text-text-secondary',
                row.left == null ? 'text-text-tertiary italic' : '',
              )}
            >
              <span className="md:hidden mr-2 text-[10px] font-sans font-medium text-text-tertiary">
                前
              </span>
              {row.left ?? '（无）'}
            </div>
            <div
              className={cn(
                'border-b border-border-light px-3 py-1 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words',
                row.kind === 'add' || row.kind === 'change'
                  ? 'bg-green-500/10 text-text-primary'
                  : 'bg-surface-primary text-text-secondary',
                row.right == null ? 'text-text-tertiary italic' : '',
              )}
            >
              <span className="md:hidden mr-2 text-[10px] font-sans font-medium text-text-tertiary">
                后
              </span>
              {row.right ?? '（无）'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangeRows({
  changeSummary,
  expanded,
}: {
  changeSummary: VersionChangeSummary;
  expanded: boolean;
}) {
  if (changeSummary.kind === 'initial') {
    return <p className="text-sm text-text-secondary">创建本智能体时的初始快照</p>;
  }
  if (changeSummary.kind === 'none') {
    return <p className="text-sm text-text-secondary">相对上一版无字段差异</p>;
  }

  return (
    <ul className="space-y-2">
      {changeSummary.changes.map((c) => (
        <li key={c.field} className="min-w-0">
          <div className="text-token-text-primary dark:text-text-primary text-sm font-medium">
            {c.label}
            {c.longText && (
              <span className="ml-2 text-xs font-normal text-text-tertiary">
                {c.before.length} → {c.after.length} 字
              </span>
            )}
          </div>
          {!expanded ? (
            <p
              className="mt-0.5 truncate text-xs text-text-secondary"
              title={oneLineSummary(c)}
            >
              {oneLineSummary(c)}
            </p>
          ) : c.longText ? (
            <LongTextDiff before={c.before} after={c.after} />
          ) : (
            <div className="mt-1.5 grid gap-1 rounded-lg border border-border-light bg-surface-secondary/50 px-3 py-2 text-xs leading-relaxed md:grid-cols-2">
              <div className="break-words text-text-secondary">
                <span className="mr-2 font-medium text-text-tertiary">前</span>
                {c.before}
              </div>
              <div className="break-words text-text-secondary">
                <span className="mr-2 font-medium text-text-tertiary">后</span>
                {c.after}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function VersionItem({
  version,
  index,
  isActive,
  versionsLength,
  originalIndex,
  changeSummary,
  isLast = false,
  onRestore,
  onSaveNote,
}: VersionItemProps) {
  const localize = useLocalize();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(String(version.versionNote || ''));
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    setNoteDraft(String(version.versionNote || ''));
  }, [version.versionNote, version.updatedAt]);

  const savedNote = String(version.versionNote || '').trim();
  const noteDirty = noteDraft.trim() !== savedNote;

  const timestamp = useMemo(() => {
    const raw = version.updatedAt || version.createdAt;
    if (!raw) return localize('com_ui_agent_version_no_date');
    try {
      const date = new Date(raw);
      if (isNaN(date.getTime()) || date.toString() === 'Invalid Date') {
        return localize('com_ui_agent_version_unknown_date');
      }
      return date.toLocaleString();
    } catch {
      return localize('com_ui_agent_version_unknown_date');
    }
  }, [version.updatedAt, version.createdAt, localize]);

  const handleSaveNote = async () => {
    if (!onSaveNote) return;
    setSavingNote(true);
    try {
      await onSaveNote(originalIndex, noteDraft);
      setNoteOpen(false);
    } finally {
      setSavingNote(false);
    }
  };

  const handleRestore = () => {
    if (window.confirm(localize('com_ui_agent_version_restore_confirm'))) {
      onRestore(index);
    }
  };

  const hasExpandableDiff =
    changeSummary.kind === 'changes' && changeSummary.changes.length > 0;

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* 时间轴线 */}
      <div className="flex w-5 shrink-0 flex-col items-center">
        <span
          className={cn(
            'mt-1.5 z-[1] h-3 w-3 rounded-full border-2',
            isActive
              ? 'border-green-500 bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.25)]'
              : 'border-border-medium bg-surface-tertiary',
          )}
          aria-hidden
        />
        {!isLast && <span className="mt-1 w-px flex-1 bg-border-light" aria-hidden />}
      </div>

      {/* 卡片 */}
      <div
        className={cn(
          'min-w-0 flex-1 rounded-xl border bg-surface-primary px-4 py-3',
          isActive
            ? 'border-green-500/40 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.12)]'
            : 'border-border-light',
        )}
      >
        {/* 顶栏：左信息 / 右操作 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex flex-wrap items-center gap-2">
            <h3 className="text-token-text-primary dark:text-text-primary text-base font-semibold">
              {localize('com_ui_agent_version_title', { versionNumber: versionsLength - index })}
            </h3>
            {isActive ? (
              <span className="inline-flex items-center rounded-md bg-green-500/20 px-2 py-0.5 text-xs font-semibold text-green-600 dark:text-green-300">
                当前生效
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary">
                历史版本
              </span>
            )}
            <span className="text-xs text-text-tertiary">{timestamp}</span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isActive && (
              <button
                type="button"
                className="btn btn-neutral border-token-border-light relative inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
                onClick={handleRestore}
                aria-label={localize('com_ui_agent_version_restore')}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {localize('com_ui_agent_version_restore')}
              </button>
            )}
          </div>
        </div>

        {/* 变更摘要 */}
        <div className="mt-3 border-t border-border-light pt-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
            变更摘要
          </div>
          <ChangeRows changeSummary={changeSummary} expanded={detailsOpen} />
        </div>

        {/* 底部操作：展开详情 / 备注 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-light pt-3">
          {hasExpandableDiff && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary"
              onClick={() => setDetailsOpen((v) => !v)}
            >
              {detailsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              {detailsOpen ? '收起前后详情' : '展开前后详情'}
            </button>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary"
            onClick={() => setNoteOpen((v) => !v)}
          >
            {noteOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
            {savedNote ? '编辑备注' : '添加备注'}
            <span className="font-normal text-text-tertiary">
              · {savedNote ? '已填写' : '暂无'}
            </span>
          </button>
        </div>

        {noteOpen && (
          <div className="mt-3 rounded-lg border border-border-light bg-surface-secondary/40 p-3">
            <label
              className="text-token-text-primary dark:text-text-primary mb-1.5 block text-xs font-medium"
              htmlFor={`version-note-${originalIndex}`}
            >
              备注
            </label>
            <textarea
              id={`version-note-${originalIndex}`}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              className={noteInputClass}
              placeholder="可补充本次修改说明"
              aria-label="版本备注"
            />
            {onSaveNote && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="btn btn-primary relative h-8 rounded-lg px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!noteDirty || savingNote}
                  onClick={() => void handleSaveNote()}
                >
                  {savingNote ? '保存中…' : '保存备注'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
