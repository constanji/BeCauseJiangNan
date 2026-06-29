import React from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import SchemaViewer from './SchemaViewer';

export default function Workbench() {
  const { id = '' } = useParams();
  const [dataSource, setDataSource] = React.useState<any>(null);
  const [schemaName, setSchemaName] = React.useState('');
  const [schemasReady, setSchemasReady] = React.useState(false);
  const [schemas, setSchemas] = React.useState<any[]>([]);
  const [tables, setTables] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState('');
  const [showUngeneratedOnly, setShowUngeneratedOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [generated, setGenerated] = React.useState<any[]>([]);
  const [sampleLimit, setSampleLimit] = React.useState(5);
  const [sampleScope, setSampleScope] = React.useState<'text_only' | 'all_columns'>('text_only');
  const [loadingSchemas, setLoadingSchemas] = React.useState(false);
  const [loadingTables, setLoadingTables] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [genProgress, setGenProgress] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [viewerTable, setViewerTable] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const tablesLoadSeq = React.useRef(0);
  const { showToast } = useToast();

  const refreshGenerated = React.useCallback(async (sn: string) => {
    const r = await api.listLightSchemas(id, sn);
    if (!r.success) throw new Error(r.error || '加载 LightSchema 失败');
    let rows = r.data || [];
    if (rows.length === 0) {
      const allRes = await api.listLightSchemas(id);
      if (allRes.success && (allRes.data || []).length > 0) {
        rows = allRes.data || [];
      }
    }
    return rows;
  }, [id]);

  React.useEffect(() => {
    api.getDataSource(id)
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载数据源失败');
        setDataSource(r.data || null);
      })
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);

  React.useEffect(() => {
    setLoadingSchemas(true);
    setSchemasReady(false);
    setSchemaName('');
    setTables([]);
    setGenerated([]);
    setShowUngeneratedOnly(false);
    setError(null);
    api.listSchemas(id)
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载 schema 失败');
        const list = r.data || [];
        setSchemas(list);
        const preferred = list.find((s: any) => s.schemaName === 'public') || list[0];
        if (preferred) setSchemaName(preferred.schemaName);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => {
        setLoadingSchemas(false);
        setSchemasReady(true);
      });
  }, [id]);

  React.useEffect(() => {
    if (!schemasReady || !schemaName) return;
    const seq = ++tablesLoadSeq.current;
    setLoadingTables(true);
    setError(null);
    Promise.all([api.listTables(id, schemaName), refreshGenerated(schemaName)])
      .then(([tablesRes, genRows]) => {
        if (seq !== tablesLoadSeq.current) return;
        if (!tablesRes.success) throw new Error(tablesRes.error || '加载表失败');
        const list = (tablesRes.data || []).sort();
        setTables(list);
        setGenerated(genRows || []);
        const cached = new Set((genRows || []).map((g: any) => g.table_name || g.tableName));
        const ungenerated = list.filter((t) => !cached.has(t));
        setSelected(new Set(ungenerated.length > 0 ? ungenerated : list));
      })
      .catch((e) => {
        if (seq !== tablesLoadSeq.current) return;
        setError(String(e?.message || e));
      })
      .finally(() => {
        if (seq === tablesLoadSeq.current) setLoadingTables(false);
      });
  }, [id, schemaName, schemasReady, refreshGenerated]);

  const generatedSet = React.useMemo(
    () => new Set(generated.map((g: any) => g.table_name || g.tableName)),
    [generated],
  );
  const visibleTables = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tables.filter((t) => {
      if (showUngeneratedOnly && generatedSet.has(t)) return false;
      return t.toLowerCase().includes(needle);
    });
  }, [tables, search, showUngeneratedOnly, generatedSet]);

  const handleGenerate = async () => {
    if (!schemaName) {
      setWarning('Schema 尚未加载完成，请稍候');
      return;
    }
    const tableNames = [...selected];
    if (tableNames.length === 0) {
      setWarning('请先选择要处理的表');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setError(null);
    setWarning(null);
    setSuccess(null);
    setGenProgress(`0 / ${tableNames.length}`);
    const skippedTables: Array<{ tableName: string; error: string }> = [];
    const sampleWarnings: Array<{ tableName: string; column: string; error: string }> = [];
    const generatedRows: any[] = [];
    try {
      for (let i = 0; i < tableNames.length; i += 1) {
        if (controller.signal.aborted) {
          setWarning(`已取消，完成 ${generatedRows.length}/${tableNames.length}`);
          break;
        }
        const tableName = tableNames[i];
        setGenProgress(`${i + 1}/${tableNames.length}：${tableName}`);
        const res = await api.generateLightSchema(id, {
          schemaName,
          tableNames: [tableName],
          sampleLimit,
          sampleScope,
        }, controller.signal);
        if (!res.success) {
          skippedTables.push({ tableName, error: res.error || '生成失败' });
          continue;
        }
        if (Array.isArray(res.data) && res.data[0]) {
          generatedRows.push(res.data[0]);
        }
        const summary = (res as any).summary;
        if (Array.isArray(summary?.skippedTables)) {
          skippedTables.push(...summary.skippedTables);
        }
        if (Array.isArray(summary?.sampleWarnings)) {
          sampleWarnings.push(...summary.sampleWarnings);
        }
      }
      await refreshGenerated(schemaName).then(setGenerated);
      if (!controller.signal.aborted) {
        const allFailed = generatedRows.length === 0 && skippedTables.length > 0;
        if (generatedRows.length > 0) {
          const msg = `生成成功 ${generatedRows.length}/${tableNames.length} 张表`;
          setSuccess(msg);
          showToast(msg);
        }
        if (skippedTables.length > 0) {
          const skippedText = skippedTables.map((x) => x.tableName).join('、');
          if (allFailed) {
            setError(`全部失败：${skippedText}`);
          } else {
            setWarning(`部分表未生成：${skippedText}`);
          }
        }
        if (sampleWarnings.length > 0) {
          setWarning((prev) => (prev ? `${prev}；采样警告 ${sampleWarnings.length} 条` : `采样警告 ${sampleWarnings.length} 条`));
        }
        setGenProgress(`完成 ${generatedRows.length}/${tableNames.length}`);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setWarning(`已取消，完成 ${generatedRows.length}/${tableNames.length}`);
      } else {
        setError(e?.message || String(e));
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">数据预处理</h2>
        <p className="mt-1 text-sm text-text-secondary">选择表并生成 LightSchema，支持预览与 Excel 导出</p>
      </div>

      <div className="rounded-lg border border-border-light bg-surface-primary p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div>
              <div className="text-lg font-semibold text-text-primary">{dataSource?.name || '数据源'}</div>
              <div className="text-xs text-text-secondary">{dataSource?.host}:{dataSource?.port} / {dataSource?.database}</div>
            </div>
            <select
              className="input w-44"
              value={schemaName}
              disabled={loadingSchemas || !schemaName}
              onChange={(e) => {
                setSchemaName(e.target.value);
                setShowUngeneratedOnly(false);
              }}
            >
              {schemas.map((s) => (
                <option key={s.schemaName} value={s.schemaName}>
                  {s.schemaName} ({s.tableCount ?? '?'})
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-text-secondary">当前 Schema 已生成 {generated.length} 张</div>
        </div>
      </div>

      {error && <StatusBanner tone="error" title="生成失败" message={error} />}
      {warning && <StatusBanner tone="warning" title="提示" message={warning} />}
      {success && <StatusBanner tone="success" title="完成" message={success} />}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr_0.9fr]">
        <div className="flex h-[39rem] flex-col rounded-lg border border-border-light bg-surface-primary p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-medium text-text-primary">表选择</span>
            <span className="text-xs text-text-secondary">
              {loadingTables
                ? '加载中…'
                : showUngeneratedOnly
                  ? `${visibleTables.length} / ${tables.length} 张（仅未生成）`
                  : `${tables.length} 张`}
            </span>
          </div>
          <input className="input mb-3" placeholder="搜索表名" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mb-3 flex gap-2">
            <Button
              variant="neutral"
              className="px-2 py-1 text-xs"
              onClick={() => {
                setShowUngeneratedOnly(false);
                setSelected(new Set(tables));
              }}
            >
              全选
            </Button>
            <Button
              variant="neutral"
              className={cn('px-2 py-1 text-xs', showUngeneratedOnly && 'border-brand text-brand')}
              onClick={() => {
                setShowUngeneratedOnly(true);
                setSelected(new Set(tables.filter((t) => !generatedSet.has(t))));
              }}
            >
              仅未生成
            </Button>
            <Button variant="neutral" className="px-2 py-1 text-xs" onClick={() => setSelected(new Set())}>清空</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain text-sm text-text-primary">
            {visibleTables.map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(t)}
                  onChange={() => setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(t)) next.delete(t);
                    else next.add(t);
                    return next;
                  })}
                />
                <span className="truncate">{t}</span>
                {generatedSet.has(t) && <span className="ml-auto text-xs text-brand">✓</span>}
              </label>
            ))}
            {!loadingTables && visibleTables.length === 0 && (
              <div className="py-6 text-center text-text-tertiary">
                {showUngeneratedOnly ? '暂无未生成的表' : '无匹配表'}
              </div>
            )}
          </div>
        </div>

        <div className="flex h-[39rem] flex-col rounded-lg border border-border-light bg-surface-primary p-4">
          <div className="mb-3 shrink-0 font-medium text-text-primary">生成 LightSchema</div>
          <div className="flex min-h-0 flex-1 flex-col justify-between">
            <div className="space-y-3">
            <label className="block text-sm text-text-secondary">
              采样数量
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={20}
                value={sampleLimit}
                onChange={(e) => setSampleLimit(Number(e.target.value) || 5)}
              />
            </label>
            <label className="block text-sm text-text-secondary">
              采样范围
              <select
                className="input mt-1"
                value={sampleScope}
                onChange={(e) => setSampleScope(e.target.value as 'text_only' | 'all_columns')}
              >
                <option value="text_only">仅文本类列</option>
                <option value="all_columns">全部列</option>
              </select>
            </label>
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1 px-3 py-2" disabled={generating || selected.size === 0} onClick={handleGenerate}>
                {generating ? '生成中…' : `生成 (${selected.size} 张)`}
              </Button>
              <Button variant="neutral" className="px-3 py-2" disabled={!generating} onClick={() => abortRef.current?.abort()}>
                取消
              </Button>
            </div>
            {genProgress && <div className="shrink-0 text-xs text-text-secondary">{genProgress}</div>}
            </div>
          </div>
        </div>

        <div className="flex h-[39rem] flex-col rounded-lg border border-border-light bg-surface-primary p-4">
          <div className="mb-3 shrink-0 font-medium text-text-primary">已生成</div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain text-sm">
            {generated.map((g: any) => (
              <button
                key={g.id || g.table_name}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-text-primary hover:bg-surface-tertiary"
                onClick={() => setViewerTable(g.table_name || g.tableName)}
              >
                {g.table_name || g.tableName}
              </button>
            ))}
            {generated.length === 0 && <div className="text-text-tertiary">暂无</div>}
          </div>
          <Button
            variant="primary"
            className="mt-3 shrink-0 w-full px-3 py-2"
            disabled={generated.length === 0 || exporting}
            onClick={async () => {
              setExporting(true);
              setError(null);
              setWarning(null);
              try {
                const res = await api.exportExcel(id, {
                  schemaName,
                });
                if (!res.ok) {
                  let msg = '操作失败';
                  try {
                    const text = await res.text();
                    const payload = text ? JSON.parse(text) : {};
                    msg = payload.error || payload.message || msg;
                  } catch {
                    msg = '操作失败';
                  }
                  setError(msg);
                  return;
                }
                const skippedHeader = res.headers.get('X-Export-Skipped');
                if (skippedHeader) {
                  try {
                    const skipped = JSON.parse(decodeURIComponent(skippedHeader));
                    if (Array.isArray(skipped) && skipped.length > 0) {
                      setWarning(`导出跳过：${skipped.map((x: any) => x.tableName).join('、')}`);
                    }
                  } catch {
                    setWarning('导出时有部分表被跳过');
                  }
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `light-schema-${schemaName}.xlsx`;
                a.click();
                URL.revokeObjectURL(url);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? '导出中…' : '导出 Excel'}
          </Button>
        </div>
      </div>

      <SchemaViewer
        dataSourceId={id}
        schemaName={schemaName}
        initialTable={viewerTable}
        onSchemaChanged={() => {
          refreshGenerated(schemaName).then(setGenerated).catch(() => {});
        }}
      />
    </div>
  );
}
