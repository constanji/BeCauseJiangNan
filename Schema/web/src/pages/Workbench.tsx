import React from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import ToggleSwitch from '../components/ToggleSwitch';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import {
  clearWorkbenchCatalog,
  formatCatalogFetchedAt,
  loadWorkbenchCatalog,
  patchWorkbenchCatalog,
  type WorkbenchSchemaEntry,
} from '../lib/workbenchCatalogCache';
import {
  clearGenJob,
  fetchWithTableTimeout,
  formatElapsed,
  loadGenJob,
  markGenJobInterrupted,
  pendingTableNames,
  processedTableNames,
  saveGenJob,
  type SkippedTableRecord,
  type SlowTableRecord,
  type TableTimeoutMinutes,
  type WorkbenchGenJob,
} from '../lib/workbenchGenJob';
import SchemaViewer from './SchemaViewer';

type SkippedTable = SkippedTableRecord;

const TABLE_TIMEOUT_OPTIONS: Array<{ value: TableTimeoutMinutes; label: string }> = [
  { value: 0, label: '不限制' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 20, label: '20 分钟' },
];

function slowReasonLabel(reason: SlowTableRecord['reason']) {
  switch (reason) {
    case 'timeout': return '超时跳过';
    case 'skipped_by_user': return '手动跳过';
    case 'slow_success': return '慢表(已成功)';
    case 'generate_failed': return '生成失败';
    default: return reason;
  }
}

function schemaHasTables(entry: WorkbenchSchemaEntry) {
  if (entry.tableCount == null) return true;
  return entry.tableCount > 0;
}

function usableSchemas(list: WorkbenchSchemaEntry[]) {
  return list.filter(schemaHasTables);
}

function pickPreferredSchema(list: WorkbenchSchemaEntry[], lastSchemaName?: string) {
  const pool = usableSchemas(list);
  const candidates = pool.length > 0 ? pool : list;
  if (lastSchemaName && candidates.some((s) => s.schemaName === lastSchemaName)) {
    return lastSchemaName;
  }
  return candidates.find((s) => s.schemaName === 'public')?.schemaName
    || candidates[0]?.schemaName
    || '';
}

export default function Workbench() {
  const { id = '' } = useParams();
  const [dataSource, setDataSource] = React.useState<any>(null);
  const [schemaName, setSchemaName] = React.useState('');
  const [schemasReady, setSchemasReady] = React.useState(false);
  const [schemas, setSchemas] = React.useState<WorkbenchSchemaEntry[]>([]);
  const [schemaSearch, setSchemaSearch] = React.useState('');
  const [schemaPickerOpen, setSchemaPickerOpen] = React.useState(false);
  const [catalogFetchedAt, setCatalogFetchedAt] = React.useState('');
  const [refreshingCatalog, setRefreshingCatalog] = React.useState(false);
  const [refreshingSchema, setRefreshingSchema] = React.useState(false);
  const [tables, setTables] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState('');
  const [showUngeneratedOnly, setShowUngeneratedOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [generated, setGenerated] = React.useState<any[]>([]);
  const [sampleLimit, setSampleLimit] = React.useState(5);
  const [sampleScope, setSampleScope] = React.useState<'text_only' | 'all_columns'>('text_only');
  const [skipEmptyTables, setSkipEmptyTables] = React.useState(false);
  const [tableTimeoutMinutes, setTableTimeoutMinutes] = React.useState<TableTimeoutMinutes>(10);
  const [loadingSchemas, setLoadingSchemas] = React.useState(false);
  const [loadingTables, setLoadingTables] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [genProgress, setGenProgress] = React.useState('');
  const [genDetail, setGenDetail] = React.useState<{
    generated: number;
    processed: number;
    total: number;
    currentTable: string;
    currentIndex: number;
    failed: number;
    skippedEmpty: number;
    skippedTimeout: number;
    skippedManual: number;
  } | null>(null);
  const [slowTables, setSlowTables] = React.useState<SlowTableRecord[]>([]);
  const [showSlowTables, setShowSlowTables] = React.useState(false);
  const [skippingCurrent, setSkippingCurrent] = React.useState(false);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [tableStartedAt, setTableStartedAt] = React.useState<number | null>(null);
  const [interruptedJob, setInterruptedJob] = React.useState<WorkbenchGenJob | null>(null);
  const [, tick] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [viewerTable, setViewerTable] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const cancelRequestedRef = React.useRef(false);
  const skipCurrentRequestedRef = React.useRef(false);
  const tablesLoadSeq = React.useRef(0);
  const schemaPickerRef = React.useRef<HTMLDivElement>(null);
  const schemaSearchRef = React.useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const refreshGenerated = React.useCallback(async (sn: string) => {
    const r = await api.listLightSchemas(id, sn);
    if (!r.success) throw new Error(r.error || '加载 LightSchema 失败');
    return r.data || [];
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
    setSchemaSearch('');
    setSchemaPickerOpen(false);
    setTables([]);
    setGenerated([]);
    setShowUngeneratedOnly(false);
    setError(null);

    const local = loadWorkbenchCatalog(id);
    if (local?.schemas?.length) {
      setSchemas(local.schemas);
      setCatalogFetchedAt(local.fetchedAt);
      setSchemaName(pickPreferredSchema(local.schemas, local.lastSchemaName));
      setSchemasReady(true);
      setLoadingSchemas(false);
    }

    api.listSchemas(id, 'auto')
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载 schema 失败');
        const list = (r.data || []) as WorkbenchSchemaEntry[];
        const meta = (r as { meta?: { cachedAt?: string } }).meta;
        const fetchedAt = meta?.cachedAt || new Date().toISOString();
        setSchemas(list);
        setCatalogFetchedAt(fetchedAt);
        const preferred = pickPreferredSchema(list, local?.lastSchemaName);
        setSchemaName((prev) => (prev && list.some((s) => s.schemaName === prev) ? prev : preferred));
        patchWorkbenchCatalog(id, {
          schemas: list,
          fetchedAt,
          lastSchemaName: preferred || local?.lastSchemaName,
        });
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => {
        setLoadingSchemas(false);
        setSchemasReady(true);
      });
  }, [id]);

  React.useEffect(() => {
    if (!schemasReady || schemas.length === 0) return;
    const current = schemas.find((s) => s.schemaName === schemaName);
    if (current && !schemaHasTables(current)) {
      const next = pickPreferredSchema(schemas, schemaName);
      if (next && next !== schemaName) {
        setSchemaName(next);
        patchWorkbenchCatalog(id, { lastSchemaName: next });
      }
    }
  }, [schemasReady, schemas, schemaName, id]);

  const applyTablesSelection = React.useCallback((list: string[], genRows: any[]) => {
    setTables(list);
    setGenerated(genRows || []);
    const cached = new Set((genRows || []).map((g: any) => g.table_name || g.tableName));
    const ungenerated = list.filter((t) => !cached.has(t));
    setSelected(new Set(ungenerated.length > 0 ? ungenerated : list));
  }, []);

  React.useEffect(() => {
    if (!schemasReady || !schemaName) return;
    const seq = ++tablesLoadSeq.current;
    setLoadingTables(true);
    setError(null);

    const local = loadWorkbenchCatalog(id);
    const cachedTables = local?.tablesBySchema?.[schemaName];
    const useLocalTables = Array.isArray(cachedTables);

    if (useLocalTables) {
      applyTablesSelection(cachedTables, []);
    }

    Promise.all([api.listTables(id, schemaName, 'auto'), refreshGenerated(schemaName)])
      .then(([tablesRes, genRows]) => {
        if (seq !== tablesLoadSeq.current) return;
        if (!tablesRes.success) throw new Error(tablesRes.error || '加载表失败');
        const list = ((tablesRes.data || []) as string[]).slice().sort();
        applyTablesSelection(list, genRows || []);
        patchWorkbenchCatalog(id, {
          tablesBySchema: { [schemaName]: list },
          lastSchemaName: schemaName,
        });
      })
      .catch((e) => {
        if (seq !== tablesLoadSeq.current) return;
        setError(String(e?.message || e));
      })
      .finally(() => {
        if (seq === tablesLoadSeq.current) setLoadingTables(false);
      });
  }, [id, schemaName, schemasReady, refreshGenerated, applyTablesSelection]);

  const handleRefreshCatalog = async () => {
    if (generating || refreshingCatalog) return;
    setRefreshingCatalog(true);
    setError(null);
    clearWorkbenchCatalog(id);
    try {
      const r = await api.refreshCatalog(id, schemaName || '');
      if (!r.success) throw new Error(r.error || '刷新目录失败');
      const list = (r.data?.schemas || []) as WorkbenchSchemaEntry[];
      const tablesList = ((r.data?.tables || []) as string[]).slice().sort();
      const resolvedSchema = r.data?.schemaName || pickPreferredSchema(list, schemaName);
      const fetchedAt = (r as { meta?: { schemas?: { cachedAt?: string } } }).meta?.schemas?.cachedAt
        || new Date().toISOString();
      setSchemas(list);
      setCatalogFetchedAt(fetchedAt);
      setSchemaName(resolvedSchema);
      const genRows = await refreshGenerated(resolvedSchema);
      applyTablesSelection(tablesList, genRows || []);
      patchWorkbenchCatalog(id, {
        schemas: list,
        fetchedAt,
        lastSchemaName: resolvedSchema,
        tablesBySchema: tablesList.length > 0 ? { [resolvedSchema]: tablesList } : {},
      });
      const tablesErr = (r as { meta?: { tables?: { error?: string } } }).meta?.tables?.error;
      if (tablesErr) {
        setWarning(`Schema 列表已刷新，但表名加载失败：${tablesErr}`);
        showToast('目录已刷新（表名加载失败）');
      } else {
        showToast(`目录已刷新（${list.length} 个 Schema）`);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const handleRefreshCurrentSchema = async () => {
    if (generating || refreshingSchema || !schemaName) return;
    setRefreshingSchema(true);
    setError(null);
    try {
      const r = await api.refreshSchemaTables(id, schemaName);
      if (!r.success) throw new Error(r.error || '刷新 Schema 失败');
      const list = ((r.data || []) as string[]).slice().sort();
      const genRows = await refreshGenerated(schemaName);
      applyTablesSelection(list, genRows || []);
      patchWorkbenchCatalog(id, {
        tablesBySchema: { [schemaName]: list },
        lastSchemaName: schemaName,
      });
      showToast(`「${schemaName}」表名已刷新（${list.length} 张）`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRefreshingSchema(false);
    }
  };

  const handleSelectSchema = (name: string) => {
    if (generating || name === schemaName) {
      setSchemaPickerOpen(false);
      return;
    }
    setSchemaName(name);
    setShowUngeneratedOnly(false);
    setSchemaSearch('');
    setSchemaPickerOpen(false);
    patchWorkbenchCatalog(id, { lastSchemaName: name });
  };

  React.useEffect(() => {
    if (!schemaPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (schemaPickerRef.current?.contains(event.target as Node)) return;
      setSchemaPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [schemaPickerOpen]);

  React.useEffect(() => {
    if (schemaPickerOpen) {
      schemaSearchRef.current?.focus();
    }
  }, [schemaPickerOpen]);

  React.useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  React.useEffect(() => {
    const job = loadGenJob(id);
    if (job?.status === 'running') {
      const marked = markGenJobInterrupted(id);
      setInterruptedJob(marked);
    } else if (job?.status === 'interrupted') {
      setInterruptedJob(job);
    }
  }, [id]);

  React.useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const generatedSet = React.useMemo(
    () => new Set(generated.map((g: any) => g.table_name || g.tableName)),
    [generated],
  );
  const tableSearchNeedle = search.trim().toLowerCase();
  const matchesTableSearch = React.useCallback(
    (t: string) => t.toLowerCase().includes(tableSearchNeedle),
    [tableSearchNeedle],
  );
  const visibleTables = React.useMemo(() => {
    return tables.filter((t) => {
      if (showUngeneratedOnly && generatedSet.has(t)) return false;
      return matchesTableSearch(t);
    });
  }, [tables, showUngeneratedOnly, generatedSet, matchesTableSearch]);
  const ungeneratedCount = React.useMemo(
    () => tables.filter((t) => !generatedSet.has(t)).length,
    [tables, generatedSet],
  );
  const schemaSearchNeedle = schemaSearch.trim().toLowerCase();
  const schemasWithTables = React.useMemo(() => usableSchemas(schemas), [schemas]);
  const filteredSchemas = React.useMemo(() => {
    let list = schemaSearchNeedle
      ? schemasWithTables.filter((s) => s.schemaName.toLowerCase().includes(schemaSearchNeedle))
      : schemasWithTables;
    if (schemaName && !list.some((s) => s.schemaName === schemaName)) {
      const current = schemasWithTables.find((s) => s.schemaName === schemaName);
      if (current) list = [current, ...list];
    }
    return list;
  }, [schemasWithTables, schemaSearchNeedle, schemaName]);
  const currentSchemaEntry = React.useMemo(
    () => schemas.find((s) => s.schemaName === schemaName),
    [schemas, schemaName],
  );

  const countSkippedByReason = (list: SkippedTable[]) => ({
    failed: list.filter((x) => x.reason !== 'empty_table' && x.reason !== 'timeout' && x.reason !== 'skipped_by_user').length,
    skippedEmpty: list.filter((x) => x.reason === 'empty_table').length,
    skippedTimeout: list.filter((x) => x.reason === 'timeout').length,
    skippedManual: list.filter((x) => x.reason === 'skipped_by_user').length,
  });

  const calcProcessedCount = (completed: string[], skipped: SkippedTable[]) =>
    new Set([...completed, ...skipped.map((s) => s.tableName)]).size;

  const buildGenDetail = (
    generated: number,
    completed: string[],
    skipped: SkippedTable[],
    total: number,
    currentTable: string,
    currentIndex = 0,
  ) => ({
    generated,
    processed: calcProcessedCount(completed, skipped),
    total,
    currentTable,
    currentIndex,
    ...countSkippedByReason(skipped),
  });

  const handleGenerate = async (resumeFrom?: WorkbenchGenJob) => {
    const runSchemaName = resumeFrom?.schemaName || schemaName;
    if (!runSchemaName) {
      setWarning('Schema 尚未加载完成，请稍候');
      return;
    }
    const fullTableNames = resumeFrom?.tableNames || [...selected];
    const pendingTables = resumeFrom
      ? pendingTableNames(resumeFrom)
      : fullTableNames;
    const runSampleLimit = resumeFrom?.sampleLimit ?? sampleLimit;
    const runSampleScope = resumeFrom?.sampleScope ?? sampleScope;
    const runSkipEmpty = resumeFrom?.skipEmptyTables ?? skipEmptyTables;
    const runTableTimeoutMinutes = resumeFrom?.tableTimeoutMinutes ?? tableTimeoutMinutes;
    const runTimeoutMs = runTableTimeoutMinutes > 0 ? runTableTimeoutMinutes * 60 * 1000 : 0;

    if (pendingTables.length === 0) {
      setWarning(resumeFrom ? '剩余未处理表已全部跑完（已跳过/失败的表需手动重选后重试）' : '请先选择要处理的表');
      return;
    }
    setInterruptedJob(null);
    abortRef.current?.abort();
    abortRef.current = null;
    cancelRequestedRef.current = false;
    skipCurrentRequestedRef.current = false;
    setSkippingCurrent(false);
    setCancelling(false);
    setGenerating(true);
    setError(null);
    setWarning(null);
    setSuccess(null);
    setShowSlowTables(false);
    const runStart = Date.now();
    setRunStartedAt(runStart);
    let generatedCount = resumeFrom?.completedTables.length ?? 0;
    const skippedTables: SkippedTable[] = resumeFrom ? [...resumeFrom.failedTables] : [];
    const slowTableRecords: SlowTableRecord[] = resumeFrom ? [...(resumeFrom.slowTables || [])] : [];
    setSlowTables(slowTableRecords);
    const completedTables = resumeFrom ? [...resumeFrom.completedTables] : [];
    const sampleWarnings: Array<{ tableName: string; column: string; error: string }> = [];
    setGenProgress(`${calcProcessedCount(completedTables, skippedTables)}/${fullTableNames.length}`);
    setGenDetail(buildGenDetail(
      generatedCount,
      completedTables,
      skippedTables,
      fullTableNames.length,
      pendingTables[0] || '',
      fullTableNames.indexOf(pendingTables[0]) + 1,
    ));

    const persistJob = (patch: Partial<WorkbenchGenJob> & { status: WorkbenchGenJob['status'] }) => {
      saveGenJob({
        dataSourceId: id,
        schemaName: runSchemaName,
        tableNames: fullTableNames,
        completedTables,
        failedTables: skippedTables,
        currentTable: patch.currentTable,
        currentIndex: patch.currentIndex ?? completedTables.length,
        status: patch.status,
        startedAt: resumeFrom?.startedAt || new Date(runStart).toISOString(),
        updatedAt: new Date().toISOString(),
        sampleLimit: runSampleLimit,
        sampleScope: runSampleScope,
        skipEmptyTables: runSkipEmpty,
        tableTimeoutMinutes: runTableTimeoutMinutes,
        slowTables: slowTableRecords,
        ...patch,
      });
    };

    persistJob({
      status: 'running',
      currentTable: pendingTables[0],
      currentIndex: completedTables.length + 1,
    });

    const finishRun = async (opts: {
      cancelled: boolean;
      emptySkipped: SkippedTable[];
      failedSkipped: SkippedTable[];
    }) => {
      try {
        await refreshGenerated(runSchemaName).then(setGenerated);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
      setGenerating(false);
      setCancelling(false);
      setSkippingCurrent(false);
      setRunStartedAt(null);
      setTableStartedAt(null);
      cancelRequestedRef.current = false;
      skipCurrentRequestedRef.current = false;
      abortRef.current = null;
      setSlowTables(slowTableRecords);

      const { cancelled, emptySkipped, failedSkipped } = opts;
      const warnings: string[] = [];

      if (cancelled) {
        persistJob({ status: 'cancelled', currentTable: undefined, currentIndex: completedTables.length });
        warnings.push(`已终止，已完成 ${generatedCount}/${fullTableNames.length} 张`);
      } else {
        clearGenJob(id);
        if (generatedCount > 0) {
          const msg = `生成成功 ${generatedCount}/${fullTableNames.length} 张`;
          setSuccess(msg);
          showToast(msg);
        }
      }

      if (emptySkipped.length > 0) {
        warnings.push(`跳过空表 ${emptySkipped.length} 张：${emptySkipped.map((x) => x.tableName).join('、')}`);
      }
      if (failedSkipped.length > 0) {
        const failMsg = `生成失败 ${failedSkipped.length} 张：${failedSkipped.map((x) => x.tableName).join('、')}`;
        if (!cancelled && generatedCount === 0 && emptySkipped.length === 0) {
          setError(failMsg);
        } else {
          warnings.push(failMsg);
        }
      }
      const timeoutSkipped = skippedTables.filter((x) => x.reason === 'timeout');
      const manualSkipped = skippedTables.filter((x) => x.reason === 'skipped_by_user');
      if (timeoutSkipped.length > 0) {
        warnings.push(`超时跳过 ${timeoutSkipped.length} 张：${timeoutSkipped.map((x) => x.tableName).join('、')}`);
      }
      if (manualSkipped.length > 0) {
        warnings.push(`手动跳过 ${manualSkipped.length} 张：${manualSkipped.map((x) => x.tableName).join('、')}`);
      }
      if (slowTableRecords.length > 0) {
        warnings.push(`慢表记录 ${slowTableRecords.length} 张（可展开查看详情）`);
        setShowSlowTables(true);
      }
      if (sampleWarnings.length > 0) {
        warnings.push(`采样警告 ${sampleWarnings.length} 条`);
      }
      if (warnings.length > 0) {
        setWarning(warnings.join('；'));
      }
      setGenProgress(cancelled
        ? `已终止 ${generatedCount}/${fullTableNames.length}`
        : `完成 ${generatedCount}/${fullTableNames.length}`);
      setGenDetail((prev) => prev ? {
        ...prev,
        ...buildGenDetail(generatedCount, completedTables, skippedTables, fullTableNames.length, ''),
      } : null);
    };

    const mergeSlowFromSummary = (tableName: string, summary: any, elapsedMs: number) => {
      if (Array.isArray(summary?.slowTables)) {
        for (const item of summary.slowTables) {
          if (!slowTableRecords.some((s) => s.tableName === item.tableName && s.reason === item.reason)) {
            slowTableRecords.push(item);
          }
        }
      }
      const slowSuccessMs = 5 * 60 * 1000;
      if (elapsedMs >= slowSuccessMs && !slowTableRecords.some((s) => s.tableName === tableName && s.reason === 'slow_success')) {
        slowTableRecords.push({ tableName, elapsedMs, reason: 'slow_success' });
      }
      setSlowTables([...slowTableRecords]);
    };

    const recordTableSkip = (tableName: string, reason: string, error: string, elapsedMs: number) => {
      skippedTables.push({ tableName, error, reason, elapsedMs });
      const slowReason = (reason === 'timeout' || reason === 'skipped_by_user' || reason === 'generate_failed'
        ? reason
        : 'generate_failed') as SlowTableRecord['reason'];
      if (!slowTableRecords.some((s) => s.tableName === tableName && s.reason === slowReason)) {
        slowTableRecords.push({ tableName, elapsedMs, reason: slowReason, error });
      }
      setSlowTables([...slowTableRecords]);
    };

    try {
      let lastTableName = pendingTables[0] || '';
      for (let i = 0; i < pendingTables.length; i += 1) {
        if (cancelRequestedRef.current) break;

        const tableName = pendingTables[i];
        lastTableName = tableName;
        const overallIndex = fullTableNames.indexOf(tableName) + 1;
        const tableStart = Date.now();
        setTableStartedAt(tableStart);
        skipCurrentRequestedRef.current = false;
        setSkippingCurrent(false);
        const tableController = new AbortController();
        abortRef.current = tableController;
        setGenProgress(`${calcProcessedCount(completedTables, skippedTables)}/${fullTableNames.length} · 正在处理 ${tableName}`);
        setGenDetail(buildGenDetail(generatedCount, completedTables, skippedTables, fullTableNames.length, tableName, overallIndex));
        persistJob({
          status: 'running',
          currentTable: tableName,
          currentIndex: overallIndex,
          slowTables: slowTableRecords,
        });

        let res: Awaited<ReturnType<typeof api.generateLightSchema>>;
        try {
          res = await fetchWithTableTimeout(
            (signal) => api.generateLightSchema(id, {
              schemaName: runSchemaName,
              tableNames: [tableName],
              sampleLimit: runSampleLimit,
              sampleScope: runSampleScope,
              skipEmptyTables: runSkipEmpty,
              tableTimeoutMs: runTimeoutMs,
              progress: { index: overallIndex, total: fullTableNames.length },
            }, signal),
            runTimeoutMs,
            `单表超时（${runTableTimeoutMinutes} 分钟）`,
            tableController,
          );
        } catch (e: any) {
          const elapsedMs = Date.now() - tableStart;
          if (skipCurrentRequestedRef.current) {
            recordTableSkip(tableName, 'skipped_by_user', '用户跳过', elapsedMs);
            skipCurrentRequestedRef.current = false;
            setSkippingCurrent(false);
            showToast(`已跳过 ${tableName}`);
            persistJob({
              status: 'running',
              currentTable: tableName,
              currentIndex: overallIndex,
              completedTables,
              failedTables: skippedTables,
              slowTables: slowTableRecords,
            });
            continue;
          }
          if (e?.reason === 'timeout' || String(e?.message || '').includes('超时')) {
            recordTableSkip(tableName, 'timeout', e?.message || '单表超时', elapsedMs);
            persistJob({
              status: 'running',
              currentTable: tableName,
              currentIndex: overallIndex,
              completedTables,
              failedTables: skippedTables,
              slowTables: slowTableRecords,
            });
            continue;
          }
          if (e?.name === 'AbortError' && cancelRequestedRef.current) {
            break;
          }
          throw e;
        }

        const elapsedMs = Date.now() - tableStart;

        if (!res.success) {
          recordTableSkip(tableName, 'generate_failed', res.error || '生成失败', elapsedMs);
        } else {
          if (Array.isArray(res.data) && res.data[0]) {
            generatedCount += 1;
            completedTables.push(tableName);
            const row = res.data[0];
            const columnCount = row.columns?.length;
            setGenerated((prev) => {
              const key = row.table_name || row.tableName;
              const without = prev.filter((g: any) => (g.table_name || g.tableName) !== key);
              return [...without, row];
            });
            if (elapsedMs >= 5 * 60 * 1000) {
              const existing = slowTableRecords.find((s) => s.tableName === tableName && s.reason === 'slow_success');
              if (!existing) {
                slowTableRecords.push({ tableName, elapsedMs, columnCount, reason: 'slow_success' });
                setSlowTables([...slowTableRecords]);
              } else if (columnCount != null) {
                existing.columnCount = columnCount;
              }
            }
          }
          const summary = (res as any).summary;
          mergeSlowFromSummary(tableName, summary, elapsedMs);
          if (Array.isArray(summary?.skippedTables)) {
            for (const item of summary.skippedTables) {
              skippedTables.push({
                ...item,
                elapsedMs: item.elapsedMs ?? elapsedMs,
              });
              if (item.reason === 'timeout'
                && !slowTableRecords.some((s) => s.tableName === item.tableName && s.reason === 'timeout')) {
                slowTableRecords.push({
                  tableName: item.tableName,
                  elapsedMs: item.elapsedMs ?? elapsedMs,
                  reason: 'timeout',
                  error: item.error,
                });
              }
            }
            setSlowTables([...slowTableRecords]);
          }
          if (Array.isArray(summary?.sampleWarnings)) {
            sampleWarnings.push(...summary.sampleWarnings);
          }
        }

        persistJob({
          status: 'running',
          currentTable: tableName,
          currentIndex: overallIndex,
          completedTables,
          failedTables: skippedTables,
          slowTables: slowTableRecords,
        });

        if (cancelRequestedRef.current) break;
      }

      const emptySkipped = skippedTables.filter((x) => x.reason === 'empty_table');
      const failedSkipped = skippedTables.filter((x) =>
        x.reason !== 'empty_table' && x.reason !== 'timeout' && x.reason !== 'skipped_by_user',
      );
      await finishRun({
        cancelled: cancelRequestedRef.current,
        emptySkipped,
        failedSkipped,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        const emptySkipped = skippedTables.filter((x) => x.reason === 'empty_table');
        const failedSkipped = skippedTables.filter((x) =>
          x.reason !== 'empty_table' && x.reason !== 'timeout' && x.reason !== 'skipped_by_user',
        );
        await finishRun({ cancelled: true, emptySkipped, failedSkipped });
      } else {
        persistJob({
          status: 'interrupted',
          currentTable: lastTableName,
          currentIndex: completedTables.length,
          completedTables,
          failedTables: skippedTables,
          slowTables: slowTableRecords,
        });
        try {
          await refreshGenerated(runSchemaName).then(setGenerated);
        } catch {
          // refresh 失败不覆盖原始错误
        }
        setSlowTables(slowTableRecords);
        setError(e?.message || String(e));
        setGenerating(false);
        setCancelling(false);
        setSkippingCurrent(false);
        setRunStartedAt(null);
        setTableStartedAt(null);
        cancelRequestedRef.current = false;
        abortRef.current = null;
      }
    }
  };

  const handleResumeInterrupted = () => {
    if (!interruptedJob) return;
    const remaining = pendingTableNames(interruptedJob);
    setSelected(new Set(remaining));
    setSchemaName(interruptedJob.schemaName);
    setSampleLimit(interruptedJob.sampleLimit);
    setSampleScope(interruptedJob.sampleScope);
    setSkipEmptyTables(interruptedJob.skipEmptyTables);
    setTableTimeoutMinutes(interruptedJob.tableTimeoutMinutes ?? 10);
    setSlowTables(interruptedJob.slowTables || []);
    void handleGenerate(interruptedJob);
  };

  const handleSkipCurrentTable = () => {
    if (!generating || skippingCurrent || cancelling) return;
    skipCurrentRequestedRef.current = true;
    setSkippingCurrent(true);
    setGenProgress((prev) => `${prev} · 正在跳过当前表…`);
    abortRef.current?.abort();
  };

  const handleCancelGenerate = () => {
    if (!generating || cancelling) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    setGenProgress('正在终止，当前表完成后停止');
  };

  const controlsLocked = generating;

  const genRunStatus = cancelling
    ? '终止中'
    : skippingCurrent
      ? '跳过中'
      : generating
        ? '生成中'
        : null;
  const genProgressPercent = genDetail && genDetail.total > 0
    ? Math.min(100, Math.round((genDetail.processed / genDetail.total) * 100))
    : 0;
  const tableElapsedMs = tableStartedAt != null ? Date.now() - tableStartedAt : 0;
  const activeTableTimeoutMs = tableTimeoutMinutes > 0 ? tableTimeoutMinutes * 60 * 1000 : 0;
  const tableWaitPercent = activeTableTimeoutMs > 0
    ? Math.min(99, Math.round((tableElapsedMs / activeTableTimeoutMs) * 100))
    : null;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">数据预处理</h2>
        <p className="mt-1 text-sm text-text-secondary">选择表并生成 LightSchema，支持预览与 Excel 导出</p>
      </div>

      <div className="rounded-lg border border-border-light bg-surface-primary px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-semibold text-text-primary">{dataSource?.name || '数据源'}</span>
            {catalogFetchedAt && !loadingSchemas && (
              <span className="text-xs text-text-tertiary">
                目录缓存 {formatCatalogFetchedAt(catalogFetchedAt)}
              </span>
            )}
            <span className="text-xs text-text-secondary">
              {dataSource?.host}:{dataSource?.port} / {dataSource?.database}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={schemaPickerRef}>
              <button
                type="button"
                disabled={loadingSchemas || controlsLocked}
                className={cn(
                  'input flex min-w-[9rem] max-w-[14rem] items-center justify-between gap-2 py-1.5 text-left text-sm',
                  schemaPickerOpen && 'border-brand',
                )}
                onClick={() => {
                  if (loadingSchemas || controlsLocked) return;
                  setSchemaPickerOpen((open) => !open);
                }}
              >
                <span className="truncate">
                  {loadingSchemas
                    ? '加载 Schema…'
                    : schemaName
                      ? `${schemaName} (${currentSchemaEntry?.tableCount ?? '?'})`
                      : '选择 Schema'}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-text-secondary transition-transform', schemaPickerOpen && 'rotate-180')} />
              </button>
              {schemaPickerOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border-light bg-surface-primary shadow-lg">
                  <div className="border-b border-border-light p-2">
                    <input
                      ref={schemaSearchRef}
                      className="input w-full py-1 text-sm"
                      placeholder="搜索 Schema…"
                      value={schemaSearch}
                      disabled={controlsLocked}
                      onChange={(e) => setSchemaSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto overscroll-y-contain text-sm">
                    {filteredSchemas.length === 0 ? (
                      <div className="px-3 py-2 text-text-tertiary">无匹配 Schema</div>
                    ) : (
                      filteredSchemas.map((s) => {
                        const active = s.schemaName === schemaName;
                        return (
                          <button
                            key={s.schemaName}
                            type="button"
                            disabled={controlsLocked}
                            className={cn(
                              'block w-full truncate px-3 py-1.5 text-left transition-colors',
                              active
                                ? 'list-item-active text-text-primary'
                                : 'text-text-primary hover:bg-surface-tertiary',
                            )}
                            onClick={() => handleSelectSchema(s.schemaName)}
                          >
                            {s.schemaName}
                            <span className="ml-1 text-text-tertiary">({s.tableCount ?? '?'})</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <Button
              variant="neutral"
              className="px-2 py-1 text-xs"
              disabled={loadingSchemas || refreshingCatalog || controlsLocked}
              onClick={handleRefreshCatalog}
            >
              {refreshingCatalog ? '刷新中…' : '刷新目录'}
            </Button>
            <Button
              variant="neutral"
              className="px-2 py-1 text-xs"
              disabled={loadingTables || refreshingSchema || controlsLocked || !schemaName}
              onClick={handleRefreshCurrentSchema}
            >
              {refreshingSchema ? '刷新中…' : '刷新当前 Schema'}
            </Button>
            <span className="text-sm text-text-secondary">已生成 {generated.length} 张</span>
          </div>
        </div>
      </div>

      {error && <StatusBanner tone="error" title="生成失败" message={error} />}
      {warning && <StatusBanner tone="warning" title="提示" message={warning} />}
      {success && <StatusBanner tone="success" title="完成" message={success} />}
      {interruptedJob && !generating && (() => {
        const processed = processedTableNames(interruptedJob).size;
        const remaining = pendingTableNames(interruptedJob).length;
        const skippedCount = (interruptedJob.failedTables || []).length;
        return (
        <StatusBanner
          tone="warning"
          title="检测到未完成的生成任务"
          message={`${interruptedJob.schemaName}：已处理 ${processed}/${interruptedJob.tableNames.length} 张（成功 ${interruptedJob.completedTables.length}）${
            skippedCount > 0 ? `，已跳过/失败 ${skippedCount} 张（续跑不会重试，需手动重选）` : ''
          }${
            interruptedJob.currentTable ? `；中断时正在处理 ${interruptedJob.currentTable}` : ''
          }。刷新会中断浏览器端提交，服务端上一条请求可能仍在执行。`}
        >
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" className="px-3 py-1.5 text-xs" onClick={handleResumeInterrupted}>
              继续未处理表 ({remaining} 张)
            </Button>
            <Button
              variant="neutral"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                clearGenJob(id);
                setInterruptedJob(null);
              }}
            >
              忽略
            </Button>
          </div>
        </StatusBanner>
        );
      })()}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr_0.9fr]">
        <div className="flex h-[39rem] flex-col rounded-lg border border-border-light bg-surface-primary p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-medium text-text-primary">表选择</span>
            <span className="text-xs text-text-secondary">
              {loadingTables
                ? '加载中…'
                : showUngeneratedOnly
                  ? tableSearchNeedle
                    ? `${visibleTables.length} / ${ungeneratedCount} 张（未生成 · 已筛选）`
                    : `${visibleTables.length} / ${tables.length} 张（仅未生成）`
                  : tableSearchNeedle
                    ? `${visibleTables.length} / ${tables.length} 张（已筛选）`
                    : `${tables.length} 张`}
            </span>
          </div>
          <input className="input mb-3" placeholder="搜索表名" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mb-3 flex gap-2">
            <Button
              variant="neutral"
              className="px-2 py-1 text-xs"
              disabled={controlsLocked}
              onClick={() => {
                setShowUngeneratedOnly(false);
                setSelected(new Set(tables.filter(matchesTableSearch)));
              }}
            >
              全选
            </Button>
            <Button
              variant="neutral"
              className={cn('px-2 py-1 text-xs', showUngeneratedOnly && 'border-brand text-brand')}
              disabled={controlsLocked}
              onClick={() => {
                setShowUngeneratedOnly(true);
                setSelected(new Set(tables.filter((t) => !generatedSet.has(t) && matchesTableSearch(t))));
              }}
            >
              仅未生成
            </Button>
            <Button variant="neutral" className="px-2 py-1 text-xs" disabled={controlsLocked} onClick={() => setSelected(new Set())}>清空</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain text-sm text-text-primary">
            {visibleTables.map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(t)}
                  disabled={controlsLocked}
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
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="shrink-0 space-y-3">
            <label className="block text-sm text-text-secondary">
              采样数量
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={20}
                value={sampleLimit}
                disabled={controlsLocked}
                onChange={(e) => setSampleLimit(Number(e.target.value) || 5)}
              />
            </label>
            <label className="block text-sm text-text-secondary">
              采样范围
              <select
                className="input mt-1"
                value={sampleScope}
                disabled={controlsLocked}
                onChange={(e) => setSampleScope(e.target.value as 'text_only' | 'all_columns')}
              >
                <option value="text_only">仅文本类列</option>
                <option value="all_columns">全部列</option>
              </select>
            </label>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border-light px-3 py-2">
              <div>
                <div className="text-sm text-text-primary">检测到空表则跳过</div>
                <div className="text-xs text-text-tertiary">无数据行时不拉元数据、不写 SQLite</div>
              </div>
              <ToggleSwitch
                checked={skipEmptyTables}
                onChange={setSkipEmptyTables}
                label="检测到空表则跳过"
                disabled={controlsLocked}
              />
            </div>
            <label className="block text-sm text-text-secondary">
              单表超时
              <select
                className="input mt-1"
                value={tableTimeoutMinutes}
                disabled={controlsLocked}
                onChange={(e) => setTableTimeoutMinutes(Number(e.target.value) as TableTimeoutMinutes)}
              >
                {TABLE_TIMEOUT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-text-tertiary">超时后跳过该表并继续下一批，不中断整批任务</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" className="flex-1 px-3 py-2" disabled={generating || selected.size === 0} onClick={() => void handleGenerate()}>
                {generating ? (cancelling ? '终止中…' : skippingCurrent ? '跳过中…' : '生成中…') : `生成 (${selected.size} 张)`}
              </Button>
              <Button
                variant="neutral"
                className="px-3 py-2"
                disabled={!generating || skippingCurrent || cancelling || !genDetail?.currentTable}
                onClick={handleSkipCurrentTable}
              >
                跳过当前表
              </Button>
              <Button
                variant="neutral"
                className="px-3 py-2"
                disabled={!generating || cancelling}
                onClick={handleCancelGenerate}
              >
                终止生成
              </Button>
            </div>
            </div>
            {(generating || genDetail) && (
              <div className="shrink-0 space-y-2.5 rounded-md border border-border-light bg-surface-secondary px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {genRunStatus && (
                      <span className={cn(
                        'rounded px-2 py-0.5 text-xs font-medium',
                        cancelling ? 'bg-amber-500/20 text-amber-100' : 'bg-brand/15 text-brand',
                      )}
                      >
                        {genRunStatus}
                      </span>
                    )}
                    {genDetail && (
                      <span className="text-sm font-medium text-text-primary">
                        {genDetail.processed}/{genDetail.total}
                        <span className="ml-1 text-text-secondary">({genProgressPercent}%)</span>
                      </span>
                    )}
                  </div>
                  {runStartedAt != null && generating && (
                    <span className="text-xs text-text-tertiary">总用时 {formatElapsed(Date.now() - runStartedAt)}</span>
                  )}
                </div>
                {genDetail && (
                  <>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-tertiary">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          cancelling ? 'bg-amber-500' : 'bg-brand',
                        )}
                        style={{ width: `${genProgressPercent}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                      <span>成功 {genDetail.generated}</span>
                      {genDetail.failed > 0 && <span>失败 {genDetail.failed}</span>}
                      {genDetail.skippedTimeout > 0 && <span>超时 {genDetail.skippedTimeout}</span>}
                      {genDetail.skippedManual > 0 && <span>跳过 {genDetail.skippedManual}</span>}
                      {genDetail.skippedEmpty > 0 && <span>空表 {genDetail.skippedEmpty}</span>}
                    </div>
                  </>
                )}
                {generating && genDetail?.currentTable && (
                  <div className="space-y-2 border-t border-border-light/60 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                      <span>
                        当前表
                        {genDetail.currentIndex > 0 && (
                          <span className="ml-1 text-text-primary">
                            第 {genDetail.currentIndex}/{genDetail.total} 张
                          </span>
                        )}
                      </span>
                      {tableStartedAt != null && (
                        <span>
                          已等待 {formatElapsed(tableElapsedMs)}
                          {activeTableTimeoutMs > 0 && (
                            <span> / {tableTimeoutMinutes} 分钟</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-tertiary">
                      {tableWaitPercent != null ? (
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-1000',
                            tableWaitPercent >= 80 ? 'bg-amber-500' : 'bg-brand/70',
                          )}
                          style={{ width: `${Math.max(4, tableWaitPercent)}%` }}
                        />
                      ) : (
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-brand/60" />
                      )}
                    </div>
                    <p className="truncate text-sm font-medium text-text-primary" title={genDetail.currentTable}>
                      {cancelling
                        ? `等待当前表完成：${genDetail.currentTable}`
                        : skippingCurrent
                          ? `正在跳过：${genDetail.currentTable}`
                          : `正在处理：${genDetail.currentTable}`}
                    </p>
                    {!cancelling && !skippingCurrent && (
                      <p className="text-xs text-text-tertiary">
                        拉取列元数据与采样中
                        {tableWaitPercent == null && ' · 列多/远程库单表数分钟属正常情况'}
                      </p>
                    )}
                  </div>
                )}
                {genProgress && (generating ? (cancelling || skippingCurrent) : true) && (
                  <p className={cn(
                    'text-xs',
                    generating && (cancelling || skippingCurrent) ? 'text-amber-100/90' : 'text-text-secondary',
                  )}
                  >
                    {genProgress}
                  </p>
                )}
              </div>
            )}
            {(slowTables.length > 0 || showSlowTables) && (
              <div className="min-h-0 shrink-0 rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-xs font-medium text-amber-100"
                  onClick={() => setShowSlowTables((v) => !v)}
                >
                  <span>慢表 / 跳过记录 ({slowTables.length})</span>
                  <span>{showSlowTables ? '收起' : '展开'}</span>
                </button>
                {showSlowTables && (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-amber-100/90">
                    {slowTables.map((item) => (
                      <li key={`${item.tableName}-${item.reason}-${item.elapsedMs}`} className="truncate" title={item.error}>
                        {item.tableName}
                        {' · '}
                        {item.columnCount != null ? `${item.columnCount} 列 · ` : ''}
                        {formatElapsed(item.elapsedMs)}
                        {' · '}
                        {slowReasonLabel(item.reason)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="mt-auto shrink-0 border-t border-border-light pt-3 text-xs leading-relaxed text-text-tertiary">
              「跳过当前表」仅放弃等待并继续下一张，服务端 JDBC 查询可能仍在后台执行直至超时；连续跳过多张慢表可能短暂堆积并发。
              「终止生成」在当前表完成后停止整批。
              {tableTimeoutMinutes > 0 ? ` 单表超过 ${tableTimeoutMinutes} 分钟将自动跳过。` : ''}
            </p>
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
