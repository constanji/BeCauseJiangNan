import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Database, MessageSquare, BookOpen, FileText, Plus, Trash2, Eye, Upload, X, ChevronRight, ChevronDown, Folder, FolderOpen, Server, Pencil, Sparkles, Bot, FileUp, TestTube, FileSpreadsheet, RefreshCw, Search, Loader2, BarChart3, Building2 } from 'lucide-react';
import * as yaml from 'js-yaml';
import { Button, useToastContext, Spinner, Dropdown } from '@because/client';
import {
  useListKnowledgeQuery,
  useAddKnowledgeMutation,
  useDeleteKnowledgeMutation,
} from '~/data-provider';
import { useUpdateKnowledgeMutation } from '~/data-provider/KnowledgeBase';
import { useListDataSourcesQuery } from '~/data-provider/DataSources';
import { useUploadFileMutation, useFileDownload } from '~/data-provider/Files';
import { useAuthContext } from '~/hooks/AuthContext';
import { EToolResources, EModelEndpoint } from '@because/data-provider';
import type { DataSource } from '@because/data-provider';
import { dataService, request, apiBaseUrl } from '@because/data-provider';
import { cn } from '~/utils';
import OrgHierarchyPreview from './OrgHierarchyPreview';

// 类型定义
type KnowledgeEntry = {
  _id: string;
  user: string;
  type: 'semantic_model' | 'qa_pair' | 'synonym' | 'business_knowledge' | 'file';
  title: string;
  content: string;
  embedding?: number[];
  parent_id?: string; // 父级知识条目ID
  metadata?: Record<string, any>;
  children?: KnowledgeEntry[]; // 子项（用于层级展示）
  createdAt?: string;
  updatedAt?: string;
};

type AddKnowledgeRequest = {
  type: string;
  data: Record<string, any>;
};

type KnowledgeType =
  | 'semantic_model'
  | 'qa_pair'
  | 'synonym'
  | 'business_knowledge'
  | 'excel_file'
  | 'kpi_definition'
  | 'org_info';

interface TabConfig {
  id: KnowledgeType;
  label: string;
  icon: React.ReactNode;
}

const KPI_KB_FILENAME = '指标定义信息';
const ORG_KB_FILENAME = '机构信息';

const tabs: TabConfig[] = [
  { id: 'semantic_model', label: '语义模型', icon: <Database className="h-4 w-4" /> },
  { id: 'qa_pair', label: 'QA对', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'synonym', label: '同义词', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'business_knowledge', label: '业务知识', icon: <FileText className="h-4 w-4" /> },
  { id: 'excel_file', label: 'Excel 文件', icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: 'kpi_definition', label: '指标定义', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'org_info', label: '机构信息', icon: <Building2 className="h-4 w-4" /> },
];

const isVectorTab = (tab: KnowledgeType) =>
  tab === 'excel_file' || tab === 'kpi_definition' || tab === 'org_info';
const isTableExtractTab = (tab: KnowledgeType) =>
  tab === 'kpi_definition' || tab === 'org_info';

function preferSortNames(names: string[], preferred: string[]) {
  return [...names].sort((a, b) => {
    const ai = preferred.findIndex((p) => a.toLowerCase() === p.toLowerCase());
    const bi = preferred.findIndex((p) => b.toLowerCase() === p.toLowerCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function formatRequestError(err: any, fallback: string) {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    (typeof err === 'string' ? err : '') ||
    fallback
  );
}

/** Schema / 表：可搜索下拉（支持大量表名过滤） */
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  loading = false,
  emptyText = '无匹配项',
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-left text-sm text-text-primary transition-colors',
          'hover:border-green-500/40 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('truncate', !value && 'text-text-secondary')}>
          {loading ? '加载中…' : value || placeholder}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-text-secondary" />
      </button>
      {open && !disabled && !loading && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-border-light bg-surface-primary shadow-xl">
          <div className="border-b border-border-light p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索…"
              className="w-full rounded-md border border-border-light bg-surface-secondary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <ul className="max-h-56 overflow-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-text-tertiary">{emptyText}</li>
            ) : (
              filtered.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    className={cn(
                      'w-full truncate px-3 py-1.5 text-left text-sm hover:bg-surface-secondary',
                      opt === value ? 'bg-green-500/10 text-green-400' : 'text-text-primary',
                    )}
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                  >
                    {opt}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBaseManagement() {
  const { showToast } = useToastContext();
  const [activeTab, setActiveTab] = useState<KnowledgeType>('semantic_model');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<KnowledgeEntry | null>(null);
  const [showViewModal, setShowViewModal] = useState<KnowledgeEntry | null>(null);
  const [showRAGTestModal, setShowRAGTestModal] = useState(false);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string | null>(null);

  // 获取数据源列表
  const { data: dataSourcesResponse } = useListDataSourcesQuery();
  const dataSources = dataSourcesResponse?.data || [];
  const selectedDataSource = selectedDataSourceId 
    ? dataSources.find((ds: DataSource) => ds._id === selectedDataSourceId)
    : null;

  const dataSourceOptions = useMemo(
    () => [
      { value: '', label: '请选择数据源' },
      ...dataSources.map((ds: DataSource) => {
        const isMock =
          String(ds.host || '').toLowerCase() === 'knowledge-extract.mock' ||
          String(ds.database || '').toLowerCase() === 'knowledge_extract_mock';
        return {
          value: ds._id,
          label: isMock
            ? `${ds.name} · Mock 验收`
            : `${ds.name} · ${ds.type} · ${ds.database}`,
        };
      }),
    ],
    [dataSources],
  );

  // 语义模型需要包含子项以支持层级展示，但默认只显示父级
  // 根据选中的数据源过滤知识库（使用 entityId）
  // Excel / 指标 / 机构 Tab 不走知识库查询
  const { data: knowledgeData, refetch } = useListKnowledgeQuery(
    {
      type: activeTab as Exclude<KnowledgeType, 'excel_file' | 'kpi_definition' | 'org_info'>,
      entityId: selectedDataSourceId || undefined,
      includeChildren: activeTab === 'semantic_model',
      limit: 100,
    },
    { enabled: !isVectorTab(activeTab) },
  );

  // ── Excel 文件向量化 state ──────────────────────────────────────────────────
  type ExcelColumnRole = 'primary' | 'searchable' | 'excluded';
  interface ExcelFile {
    fileId: string;
    filename: string;
    cellCount: number;
    rowCount: number;
    createdAt: string;
    primaryColumns?: string[];
    excludedColumns?: string[];
    headers?: string[];
    dataDt?: string | null;
  }
  interface ExcelSearchResult {
    score: number;
    cellValue: string;
    columnName: string;
    fullRow: string;
    filename: string;
    rowIndex: number;
    sheetName: string;
    isPrimaryColumn?: boolean;
    isExactMatch?: boolean;
    rowKey?: string;
    aliases?: string[];
    matchedViaAlias?: boolean;
  }
  interface ExcelFileRow {
    rowIndex: number;
    fullRow: string;
    sheetName: string;
    rowKey?: string;
    aliases?: string[];
  }
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [excelFiles, setExcelFiles] = useState<ExcelFile[]>([]);
  const [loadingExcelFiles, setLoadingExcelFiles] = useState(false);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [excelSearchQuery, setExcelSearchQuery] = useState('');
  const [excelSearching, setExcelSearching] = useState(false);
  const [excelSearchResults, setExcelSearchResults] = useState<ExcelSearchResult[]>([]);
  const [previewFile, setPreviewFile] = useState<{ file: ExcelFile; rows: ExcelFileRow[] } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [previewAliasFilter, setPreviewAliasFilter] = useState<'all' | 'has' | 'none'>('all');
  /** 机构信息默认树状；列表模式仍走服务端筛选 */
  const [previewViewMode, setPreviewViewMode] = useState<'tree' | 'list'>('list');
  const [aliasEditor, setAliasEditor] = useState<{
    fileId: string;
    filename: string;
    rowKey: string;
    rowIndex: number;
    fullRow: string;
    sheetName?: string;
    aliases: string[];
  } | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);
  // 上传列配置弹窗
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [showUploadConfigModal, setShowUploadConfigModal] = useState(false);
  const [loadingExcelHeaders, setLoadingExcelHeaders] = useState(false);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelSheetNames, setExcelSheetNames] = useState<string[]>([]);
  const [columnRoles, setColumnRoles] = useState<Record<string, ExcelColumnRole>>({});

  // ── 指标定义 / 机构信息抽取 state ──────────────────────────────────────────
  const [extractSchemas, setExtractSchemas] = useState<string[]>([]);
  const [extractTables, setExtractTables] = useState<string[]>([]);
  const [extractSchema, setExtractSchema] = useState('');
  const [extractTable, setExtractTable] = useState('');
  const [loadingExtractSchemas, setLoadingExtractSchemas] = useState(false);
  const [loadingExtractTables, setLoadingExtractTables] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [vectorizingExtract, setVectorizingExtract] = useState(false);
  const [extractResult, setExtractResult] = useState<{
    kind: 'kpi' | 'org';
    filename: string;
    schema?: string;
    table?: string;
    dataDt?: string | null;
    headers: string[];
    rows: Record<string, string>[];
    rowCount: number;
    previewTruncated?: boolean;
    mock?: boolean;
  } | null>(null);
  const [showExtractConfigModal, setShowExtractConfigModal] = useState(false);
  const [extractPreviewExpanded, setExtractPreviewExpanded] = useState(false);
  const EXTRACT_PREVIEW_LIMIT = 5;
  const extractLoadGenRef = useRef(0);

  /** 机构预览列优先展示检索关键字段（对齐 org_master，避免误以为只有源表四列） */
  const ORG_PREVIEW_HEADER_PRIORITY = [
    'org_code',
    'org_name',
    'org_level',
    'org_level_name',
    'parent_org_code',
    'parent_org_name',
    'leaf_child_codes',
    'leaf_child_orgs',
    'same_level_codes',
    'same_level_orgs',
    'region_org_code',
    'scope_note',
    'kpi_query_self',
    'kpi_query_drilldown',
    'notes',
  ];

  const extractPreviewHeaders = useMemo(() => {
    if (!extractResult?.headers?.length) return [];
    if (extractResult.kind !== 'org') return extractResult.headers;
    const set = new Set(extractResult.headers);
    const ordered = ORG_PREVIEW_HEADER_PRIORITY.filter((h) => set.has(h));
    for (const h of extractResult.headers) {
      if (!ordered.includes(h)) ordered.push(h);
    }
    return ordered;
  }, [extractResult]);

  const isMockKnowledgeDataSource = useMemo(() => {
    if (!selectedDataSource) return false;
    const host = String(selectedDataSource.host || '').toLowerCase();
    const database = String(selectedDataSource.database || '').toLowerCase();
    return host === 'knowledge-extract.mock' || database === 'knowledge_extract_mock';
  }, [selectedDataSource]);

  const previewExcelHeaders = async (dataSourceId: string, formData: FormData) => {
    if (typeof dataService.previewExcelHeaders === 'function') {
      return dataService.previewExcelHeaders(dataSourceId, formData);
    }
    return request.postMultiPart(
      `${apiBaseUrl()}/api/config/data-sources/${dataSourceId}/excel-files/preview-headers`,
      formData,
    );
  };

  const fetchExcelFiles = async (dsId?: string) => {
    const id = dsId ?? selectedDataSourceId;
    if (!id) return;
    setLoadingExcelFiles(true);
    try {
      const res = await dataService.listExcelFiles(id);
      if (res?.success) setExcelFiles(res.data || []);
    } catch (_) { /* 静默 */ } finally { setLoadingExcelFiles(false); }
  };

  useEffect(() => {
    if (isVectorTab(activeTab) && selectedDataSourceId) fetchExcelFiles();
  }, [activeTab, selectedDataSourceId]);

  const loadExtractSchemas = async (dsId: string, prefer: 'kpi' | 'org', gen: number) => {
    setLoadingExtractSchemas(true);
    try {
      const res = await dataService.listDataSourceSchemas(dsId);
      if (gen !== extractLoadGenRef.current) return '';
      if (!res?.success) {
        throw new Error((res as any)?.error || '获取 schema 列表失败');
      }
      const raw =
        res?.data?.schemas?.map((s) => s.schemaName).filter(Boolean) ||
        (res as any)?.schemas?.map((s: any) => s.schemaName || s).filter(Boolean) ||
        [];
      const preferred = prefer === 'kpi' ? ['kpi'] : ['cmdata'];
      const sorted = preferSortNames(raw, preferred);
      setExtractSchemas(sorted);
      const defaultSchema =
        sorted.find((s) => preferred.includes(s.toLowerCase())) || sorted[0] || '';
      setExtractSchema(defaultSchema);
      return defaultSchema;
    } catch (err: any) {
      if (gen !== extractLoadGenRef.current) return '';
      showToast({ message: `加载 schema 失败: ${formatRequestError(err, '未知错误')}`, status: 'error' });
      setExtractSchemas([]);
      setExtractSchema('');
      setExtractTables([]);
      setExtractTable('');
      return '';
    } finally {
      if (gen === extractLoadGenRef.current) setLoadingExtractSchemas(false);
    }
  };

  const loadExtractTables = async (dsId: string, schema: string, prefer: 'kpi' | 'org', gen?: number) => {
    if (!schema) {
      setExtractTables([]);
      setExtractTable('');
      return;
    }
    setLoadingExtractTables(true);
    try {
      const res = await dataService.listDataSourceSchemaTables(dsId, schema);
      if (gen != null && gen !== extractLoadGenRef.current) return;
      if (!res?.success) {
        throw new Error((res as any)?.error || '获取表列表失败');
      }
      const raw =
        res?.data?.tables ||
        (res as any)?.tables ||
        [];
      const preferred = prefer === 'kpi' ? ['kpi_result_ctcx'] : ['c_par_brch_level'];
      const sorted = preferSortNames(raw, preferred);
      setExtractTables(sorted);
      const defaultTable =
        sorted.find((t) => preferred.includes(t.toLowerCase())) || sorted[0] || '';
      setExtractTable(defaultTable);
    } catch (err: any) {
      if (gen != null && gen !== extractLoadGenRef.current) return;
      showToast({ message: `加载表列表失败: ${formatRequestError(err, '未知错误')}`, status: 'error' });
      setExtractTables([]);
      setExtractTable('');
    } finally {
      if (gen == null || gen === extractLoadGenRef.current) setLoadingExtractTables(false);
    }
  };

  useEffect(() => {
    if (!isTableExtractTab(activeTab) || !selectedDataSourceId) {
      setExtractSchemas([]);
      setExtractTables([]);
      setExtractSchema('');
      setExtractTable('');
      setExtractResult(null);
      return;
    }
    const prefer = activeTab === 'kpi_definition' ? 'kpi' : 'org';
    const gen = ++extractLoadGenRef.current;
    // 切换数据源时立刻清空，避免残留上一数据源的 schema/表
    setExtractSchemas([]);
    setExtractTables([]);
    setExtractSchema('');
    setExtractTable('');
    setExtractResult(null);
    setExtractPreviewExpanded(false);
    (async () => {
      const schema = await loadExtractSchemas(selectedDataSourceId, prefer, gen);
      if (gen !== extractLoadGenRef.current) return;
      if (schema) await loadExtractTables(selectedDataSourceId, schema, prefer, gen);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedDataSourceId]);

  const handleExtractSchemaChange = async (schema: string) => {
    setExtractSchema(schema);
    setExtractTable('');
    setExtractTables([]);
    if (!selectedDataSourceId || !isTableExtractTab(activeTab)) return;
    const prefer = activeTab === 'kpi_definition' ? 'kpi' : 'org';
    await loadExtractTables(selectedDataSourceId, schema, prefer);
  };

  const guessDefaultColumnRoles = (headers: string[], kind?: 'kpi' | 'org'): Record<string, ExcelColumnRole> => {
    const roles: Record<string, ExcelColumnRole> = {};
    const primaryPatterns =
      kind === 'org'
        ? [/^org_code$/i, /^org_name$/i, /^leaf_child_codes$/i, /^leaf_child_orgs$/i]
        : kind === 'kpi'
          ? [/指标编号$/, /^标准名称$/, /^index_number$/i, /^standard_name$/i]
          : [
              /^org_code$/i,
              /^name$/i,
              /^org_name$/i,
              /^standard_name$/i,
              /^index_number$/i,
              /机构名称$/,
              /指标名称$/,
              /指标编号$/,
              /^标准名称$/,
              /^leaf_child_codes$/i,
              /^leaf_child_orgs$/i,
            ];
    const excludePatterns =
      kind === 'org'
        ? [/^kpi_query_self$/i, /^kpi_query_drilldown$/i, /^notes$/i, /^scope_note$/i]
        : [
            /region_org_code/i,
            /parent_/i,
            /_path$/i,
            /_ids$/i,
            /权限/,
            /备注/,
            /sql/i,
            /filter/i,
            /kpi_query_/i,
            /scope_note/i,
            /^notes$/i,
          ];

    for (const header of headers) {
      if (excludePatterns.some((p) => p.test(header))) {
        roles[header] = 'excluded';
      } else if (primaryPatterns.some((p) => p.test(header))) {
        roles[header] = 'primary';
      } else {
        roles[header] = 'searchable';
      }
    }
    return roles;
  };

  const handleExtractFromTable = async () => {
    if (!selectedDataSourceId || !isTableExtractTab(activeTab)) return;
    if (!extractSchema || !extractTable) {
      showToast({ message: '请选择 schema 与表', status: 'warning' });
      return;
    }
    setExtracting(true);
    try {
      const body = {
        schema: extractSchema || undefined,
        table: extractTable || undefined,
      };
      const res =
        activeTab === 'kpi_definition'
          ? await dataService.extractKpiDefinition(selectedDataSourceId, body)
          : await dataService.extractOrgInfo(selectedDataSourceId, body);
      if (!res?.success) {
        showToast({ message: res?.error || '抽取失败', status: 'error' });
        return;
      }
      setExtractResult({
        kind: (res.kind as 'kpi' | 'org') || (activeTab === 'kpi_definition' ? 'kpi' : 'org'),
        filename: res.filename || (activeTab === 'kpi_definition' ? KPI_KB_FILENAME : ORG_KB_FILENAME),
        schema: res.schema,
        table: res.table,
        dataDt: res.dataDt,
        headers: res.headers || [],
        rows: res.rows || [],
        rowCount: res.totalRowCount ?? res.rowCount ?? (res.rows || []).length,
        previewTruncated: res.previewTruncated,
        mock: res.mock,
      });
      setExtractPreviewExpanded(false);
      showToast({
        message: `抽取成功：${res.totalRowCount ?? res.rowCount ?? 0} 行${res.dataDt ? `（data_dt=${res.dataDt}）` : ''}${res.mock ? ' [Mock 数据源]' : ''}`,
        status: 'success',
      });
    } catch (err: any) {
      showToast({ message: `抽取失败: ${formatRequestError(err, '未知错误')}`, status: 'error' });
    } finally {
      setExtracting(false);
    }
  };

  const openExtractVectorizeConfig = () => {
    if (!extractResult?.headers?.length) {
      showToast({ message: '请先抽取数据', status: 'warning' });
      return;
    }
    setExcelHeaders(extractResult.headers);
    setColumnRoles(guessDefaultColumnRoles(extractResult.headers, extractResult.kind));
    setShowExtractConfigModal(true);
  };

  const handleExtractVectorize = async () => {
    if (!selectedDataSourceId || !extractResult) return;
    setShowExtractConfigModal(false);
    setVectorizingExtract(true);
    try {
      const body = {
        primary_columns: selectedPrimaryColumns.join(','),
        excluded_columns: selectedExcludedColumns.join(','),
      };
      const res =
        extractResult.kind === 'kpi'
          ? await dataService.vectorizeKpiDefinition(selectedDataSourceId, body)
          : await dataService.vectorizeOrgInfo(selectedDataSourceId, body);
      if (res?.success) {
        showToast({
          message: `向量化成功：${res.rowCount} 行，${res.cellCount} 个单元格（${res.filename || extractResult.filename}）`,
          status: 'success',
        });
        await fetchExcelFiles();
      } else {
        showToast({ message: res?.error || '向量化失败', status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `向量化失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setVectorizingExtract(false);
      setShowExtractConfigModal(false);
    }
  };

  const extractKbFilename =
    activeTab === 'kpi_definition' ? KPI_KB_FILENAME : activeTab === 'org_info' ? ORG_KB_FILENAME : '';
  const extractVectorFiles = useMemo(() => {
    if (!extractKbFilename) return [];
    return excelFiles.filter((f) => f.filename === extractKbFilename);
  }, [excelFiles, extractKbFilename]);

  const handleExtractSearch = async () => {
    if (!excelSearchQuery.trim() || !selectedDataSourceId || !extractKbFilename) return;
    setExcelSearching(true);
    setExcelSearchResults([]);
    try {
      const res = await dataService.searchExcelCells(selectedDataSourceId, {
        query: excelSearchQuery.trim(),
        top_k: 10,
        filename: extractKbFilename,
      });
      if (res?.success) {
        setExcelSearchResults(res.data || []);
        if ((res.data || []).length === 0) showToast({ message: '未找到匹配结果', status: 'warning' });
      } else {
        showToast({ message: `检索失败: ${res?.error}`, status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `检索失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setExcelSearching(false);
    }
  };

  const resetUploadConfigModal = () => {
    setShowUploadConfigModal(false);
    setPendingUploadFile(null);
    setExcelHeaders([]);
    setExcelSheetNames([]);
    setColumnRoles({});
    setLoadingExcelHeaders(false);
  };

  // 文件选中后解析表头并弹配置弹窗
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedDataSourceId) return;
    e.target.value = '';

    setPendingUploadFile(file);
    setShowUploadConfigModal(true);
    setLoadingExcelHeaders(true);
    setExcelHeaders([]);
    setExcelSheetNames([]);
    setColumnRoles({});

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await previewExcelHeaders(selectedDataSourceId, formData);
      if (!res?.success || !res.headers?.length) {
        showToast({ message: res?.error || '未能解析 Excel 表头，请确认首行为列名', status: 'error' });
        resetUploadConfigModal();
        return;
      }
      setExcelHeaders(res.headers);
      setExcelSheetNames(res.sheetNames || []);
      setColumnRoles(guessDefaultColumnRoles(res.headers));
    } catch (err: any) {
      showToast({ message: `解析表头失败: ${err?.message || err}`, status: 'error' });
      resetUploadConfigModal();
    } finally {
      setLoadingExcelHeaders(false);
    }
  };

  const selectedPrimaryColumns = useMemo(
    () => excelHeaders.filter((h) => columnRoles[h] === 'primary'),
    [excelHeaders, columnRoles],
  );
  const selectedExcludedColumns = useMemo(
    () => excelHeaders.filter((h) => columnRoles[h] === 'excluded'),
    [excelHeaders, columnRoles],
  );

  const setColumnRole = (header: string, role: ExcelColumnRole) => {
    setColumnRoles((prev) => ({ ...prev, [header]: role }));
  };

  const excludeAllExceptPrimary = () => {
    setColumnRoles((prev) => {
      const next: Record<string, ExcelColumnRole> = {};
      for (const header of excelHeaders) {
        next[header] = prev[header] === 'primary' ? 'primary' : 'excluded';
      }
      return next;
    });
  };

  const getColumnRoleButtonClass = (role: ExcelColumnRole, active: boolean) =>
    cn(
      'inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors',
      active
        ? role === 'primary'
          ? 'border-green-500/50 bg-green-500/10 text-green-400'
          : role === 'excluded'
            ? 'border-border-medium bg-surface-hover text-text-tertiary'
            : 'border-primary/60 bg-surface-primary text-text-primary'
        : 'border-transparent bg-transparent text-text-secondary hover:border-border-light hover:bg-surface-hover hover:text-text-primary',
    );

  // 确认后真正上传
  const handleExcelUpload = async () => {
    if (!pendingUploadFile || !selectedDataSourceId) return;
    setShowUploadConfigModal(false);
    setUploadingExcel(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingUploadFile);
      if (selectedPrimaryColumns.length > 0) {
        formData.append('primary_columns', selectedPrimaryColumns.join(','));
      }
      if (selectedExcludedColumns.length > 0) {
        formData.append('excluded_columns', selectedExcludedColumns.join(','));
      }
      const res = await dataService.uploadExcelFile(selectedDataSourceId, formData);
      if (res?.success) {
        showToast({
          message: `上传成功：${res.rowCount} 行，${res.cellCount} 个单元格已向量化（主列 ${selectedPrimaryColumns.length}，排除 ${selectedExcludedColumns.length}）`,
          status: 'success',
        });
        await fetchExcelFiles();
      } else {
        showToast({ message: `上传失败: ${res?.error || '未知错误'}`, status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `上传失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setUploadingExcel(false);
      resetUploadConfigModal();
    }
  };

  const handleDeleteExcelFile = async (fileId: string, filename: string) => {
    if (!selectedDataSourceId) return;
    if (!window.confirm(`确定删除「${filename}」的所有向量数据吗？`)) return;
    try {
      const res = await (dataService as any).deleteExcelFile(selectedDataSourceId, fileId);
      if (res?.success) {
        showToast({ message: `已删除 ${res.deletedCount} 条向量记录`, status: 'success' });
        await fetchExcelFiles();
        setExcelSearchResults([]);
      } else {
        showToast({ message: `删除失败: ${res?.error}`, status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `删除失败: ${err?.message || err}`, status: 'error' });
    }
  };

  const handleExcelSearch = async () => {
    if (!excelSearchQuery.trim() || !selectedDataSourceId) return;
    setExcelSearching(true);
    setExcelSearchResults([]);
    try {
      const res = await (dataService as any).searchExcelCells(selectedDataSourceId, { query: excelSearchQuery.trim(), top_k: 10 });
      if (res?.success) {
        setExcelSearchResults(res.data || []);
        if ((res.data || []).length === 0) showToast({ message: '未找到匹配结果', status: 'warning' });
      } else {
        showToast({ message: `检索失败: ${res?.error}`, status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `检索失败: ${err?.message || err}`, status: 'error' });
    } finally { setExcelSearching(false); }
  };

  const isAliasCapableFile = (filename?: string) =>
    filename === KPI_KB_FILENAME || filename === ORG_KB_FILENAME;

  const resolveExcelFileId = (filename: string) =>
    excelFiles.find((f) => f.filename === filename)?.fileId || null;

  const openAliasEditor = (opts: {
    fileId?: string | null;
    filename: string;
    rowKey?: string;
    rowIndex: number;
    fullRow: string;
    sheetName?: string;
    aliases?: string[];
  }) => {
    if (!isAliasCapableFile(opts.filename)) {
      showToast({ message: '仅指标定义信息 / 机构信息支持别名', status: 'warning' });
      return;
    }
    const fileId = opts.fileId || resolveExcelFileId(opts.filename);
    if (!fileId) {
      showToast({ message: '未找到对应向量文件，请先完成向量化', status: 'warning' });
      return;
    }
    const rowKey =
      opts.rowKey ||
      (() => {
        const m =
          opts.fullRow.match(/(?:^|\|\s*)指标编号:\s*([^\s|]+)/) ||
          opts.fullRow.match(/(?:^|\|\s*)org_code:\s*([^\s|]+)/i);
        return m?.[1]?.trim() || '';
      })();
    if (!rowKey) {
      showToast({ message: '无法解析业务主键（指标编号/org_code）', status: 'warning' });
      return;
    }
    setAliasEditor({
      fileId,
      filename: opts.filename,
      rowKey,
      rowIndex: opts.rowIndex,
      fullRow: opts.fullRow,
      sheetName: opts.sheetName,
      aliases: [...(opts.aliases || [])],
    });
    setAliasDraft('');
  };

  const saveAliasEditor = async () => {
    if (!selectedDataSourceId || !aliasEditor) return;

    // 保存前把输入框草稿并入列表（避免只输入未点「添加」就点保存）
    let aliasesToSave = [...aliasEditor.aliases];
    const draft = aliasDraft.trim();
    if (draft) {
      if (!aliasesToSave.some((x) => x.toLowerCase() === draft.toLowerCase())) {
        aliasesToSave = [...aliasesToSave, draft];
      }
      setAliasDraft('');
    }
    aliasesToSave = aliasesToSave.map((a) => a.trim()).filter(Boolean);

    setAliasSaving(true);
    try {
      const res = await dataService.setExcelFileAliases(selectedDataSourceId, aliasEditor.fileId, {
        rowKey: aliasEditor.rowKey,
        rowIndex: aliasEditor.rowIndex,
        aliases: aliasesToSave,
        fullRow: aliasEditor.fullRow,
        sheetName: aliasEditor.sheetName,
      });
      if (!res?.success) {
        showToast({ message: res?.error || '保存别名失败', status: 'error' });
        return;
      }
      const nextAliases = res.aliases ?? aliasesToSave;
      const nextFullRow = upsertAliasInFullRowClient(aliasEditor.fullRow, nextAliases);
      showToast({
        message: nextAliases.length ? `别名已保存（${nextAliases.length} 个）` : '已清空别名',
        status: 'success',
      });

      // 乐观更新检索结果
      setExcelSearchResults((prev) =>
        prev.map((r) =>
          r.rowIndex === aliasEditor.rowIndex &&
          (r.filename === aliasEditor.filename || !r.filename)
            ? { ...r, aliases: nextAliases, fullRow: nextFullRow, rowKey: aliasEditor.rowKey }
            : r,
        ),
      );
      // 乐观更新预览行
      if (previewFile?.file.fileId === aliasEditor.fileId) {
        setPreviewFile((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((row) =>
              row.rowIndex === aliasEditor.rowIndex &&
              (!aliasEditor.sheetName || row.sheetName === aliasEditor.sheetName)
                ? {
                    ...row,
                    aliases: nextAliases,
                    fullRow: nextFullRow,
                    rowKey: aliasEditor.rowKey,
                  }
                : row,
            ),
          };
        });
      }

      setAliasEditor(null);
      // 再拉一次服务端；树状机构预览拉全量以便前端筛选保树
      if (previewFile?.file.fileId === aliasEditor.fileId) {
        const treeMode =
          previewViewMode === 'tree' && previewFile.file.filename === ORG_KB_FILENAME;
        await refreshPreviewRows(previewFile.file, { clientFilter: treeMode });
      }
    } catch (err: any) {
      showToast({ message: `保存别名失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setAliasSaving(false);
    }
  };

  const upsertAliasInFullRowClient = (fullRow: string, aliases: string[]) => {
    const base = String(fullRow || '')
      .replace(/\s*\|\s*别名:\s*[^|]*/g, '')
      .trim()
      .replace(/\s*\|\s*$/, '')
      .trim();
    if (!aliases.length) return base;
    return `${base} | 别名: ${aliases.join('；')}`;
  };

  const refreshPreviewRows = async (
    file: ExcelFile,
    opts?: { q?: string; aliasFilter?: 'all' | 'has' | 'none'; clientFilter?: boolean },
  ) => {
    if (!selectedDataSourceId) return;
    setLoadingPreview(true);
    try {
      // 树状：拉全量，筛选在前端做，避免父链被服务端滤断
      const clientFilter = opts?.clientFilter ?? false;
      const res = await dataService.getExcelFileRows(selectedDataSourceId, file.fileId, {
        limit: 2000,
        q: clientFilter ? undefined : (opts?.q ?? (previewSearchQuery.trim() || undefined)),
        aliasFilter: clientFilter ? 'all' : (opts?.aliasFilter ?? previewAliasFilter),
      });
      if (res?.success) {
        setPreviewFile({ file, rows: res.data || [] });
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  const handlePreviewExcelFile = async (file: ExcelFile) => {
    if (!selectedDataSourceId) return;
    const isOrg = file.filename === ORG_KB_FILENAME;
    setLoadingPreview(true);
    setPreviewFile({ file, rows: [] });
    setPreviewSearchQuery('');
    setPreviewAliasFilter('all');
    setPreviewViewMode(isOrg ? 'tree' : 'list');
    try {
      const res = await dataService.getExcelFileRows(selectedDataSourceId, file.fileId, {
        limit: 2000,
        aliasFilter: 'all',
      });
      if (res?.success) {
        setPreviewFile({ file, rows: res.data || [] });
      } else {
        showToast({ message: `预览失败: ${res?.error}`, status: 'error' });
        setPreviewFile(null);
      }
    } catch (err: any) {
      showToast({ message: `预览失败: ${err?.message || err}`, status: 'error' });
      setPreviewFile(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  // 列表模式：搜索 / 别名筛选走服务端（防抖）。树状模式前端筛选，不触发。
  useEffect(() => {
    if (!previewFile?.file || !selectedDataSourceId) return;
    if (!isAliasCapableFile(previewFile.file.filename)) return;
    if (previewViewMode === 'tree' && previewFile.file.filename === ORG_KB_FILENAME) return;
    const file = previewFile.file;
    const t = setTimeout(() => {
      refreshPreviewRows(file).catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSearchQuery, previewAliasFilter, previewViewMode]);

  // ────────────────────────────────────────────────────────────────────────────

  const knowledgeEntries = knowledgeData?.data || [];

  const addMutation = useAddKnowledgeMutation({
    onSuccess: () => {
      showToast({
        message: '添加成功',
        status: 'success',
      });
      setShowAddModal(false);
      refetch();
    },
    onError: (error: Error) => {
      showToast({
        message: `添加失败: ${error.message}`,
        status: 'error',
      });
    },
  });

  const updateMutation = useUpdateKnowledgeMutation({
    onSuccess: () => {
      showToast({
        message: '更新成功',
        status: 'success',
      });
      setShowEditModal(null);
      refetch();
    },
    onError: (error: Error) => {
      showToast({
        message: `更新失败: ${error.message}`,
        status: 'error',
      });
    },
  });

  const deleteMutation = useDeleteKnowledgeMutation({
    onSuccess: () => {
      showToast({
        message: '删除成功',
        status: 'success',
      });
      refetch();
    },
    onError: (error: Error) => {
      showToast({
        message: `删除失败: ${error.message}`,
        status: 'error',
      });
    },
  });

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条知识吗？此操作无法撤销。')) {
      deleteMutation.mutate(id);
    }
  };

  const activeTabConfig = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">知识库管理</h3>
          <p className="mt-1 text-sm text-text-secondary">
            管理向量数据库中的语义模型、QA对、同义词和业务知识
          </p>
        </div>
      </div>

      {/* 数据源选择器 */}
      <div className="mb-4 rounded-xl border border-border-light bg-surface-primary">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="flex flex-shrink-0 items-center gap-2">
            <Server className="h-4 w-4 text-green-400" />
            <span className="text-sm font-medium text-text-primary">选择数据源</span>
          </div>
          <div className="min-w-0 flex-1">
            <Dropdown
              value={selectedDataSourceId || ''}
              onChange={(value) => setSelectedDataSourceId(value || null)}
              options={dataSourceOptions}
              className="w-full rounded-lg border-border-light bg-surface-secondary hover:border-green-500/40 focus:ring-green-500/30"
              sizeClasses="w-[var(--popover-anchor-width,100%)] min-w-[240px]"
              ariaLabel="选择数据源"
            />
          </div>
          {selectedDataSource && (
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              <span className="rounded-md border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium uppercase text-green-400">
                {selectedDataSource.type}
              </span>
              {isMockKnowledgeDataSource && (
                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                  Mock 验收
                </span>
              )}
              <span className="rounded-md bg-surface-secondary px-2 py-0.5 font-mono text-xs text-text-secondary">
                {selectedDataSource.host}:{selectedDataSource.port}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 标签页和添加按钮 */}
      <div className="mb-4 flex items-end justify-between border-b border-border-light pb-4">
        <div className="flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => setShowRAGTestModal(true)}
            className="btn btn-secondary relative flex items-center gap-2 rounded-lg px-3 py-2"
            disabled={!selectedDataSourceId}
            title={!selectedDataSourceId ? '请先选择数据源' : ''}
          >
            <TestTube className="h-4 w-4" />
            RAG测试
          </Button>
          {activeTab !== 'excel_file' && !isTableExtractTab(activeTab) && (
            <Button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
              disabled={!selectedDataSourceId}
              title={!selectedDataSourceId ? '请先选择数据源' : ''}
            >
              <Plus className="h-4 w-4" />
              添加{activeTabConfig?.label}
            </Button>
          )}
          {activeTab === 'excel_file' && (
            <>
              <Button
                type="button"
                onClick={() => excelInputRef.current?.click()}
                disabled={!selectedDataSourceId || uploadingExcel}
                className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
                title={!selectedDataSourceId ? '请先选择数据源' : ''}
              >
                {uploadingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploadingExcel ? '向量化中…' : '上传 Excel'}
              </Button>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls"
                aria-label="上传 Excel 文件"
                title="上传 Excel 文件"
                className="hidden"
                onChange={handleFileSelected}
              />
            </>
          )}
          {isTableExtractTab(activeTab) && (
            <Button
              type="button"
              onClick={handleExtractFromTable}
              disabled={!selectedDataSourceId || extracting || !extractSchema || !extractTable}
              className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
              title={!selectedDataSourceId ? '请先选择数据源' : ''}
            >
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              {extracting ? '抽取中…' : '从库抽取'}
            </Button>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto">
        {!selectedDataSourceId ? (
          <div className="flex h-64 items-center justify-center text-text-secondary">
            <div className="text-center">
              <Server className="mx-auto mb-4 h-12 w-12 text-green-400/60" />
              <p className="text-sm">请先选择数据源</p>
              <p className="mt-2 text-xs text-text-tertiary">
                在上方选择数据源后，可以管理该数据源绑定的知识库
              </p>
            </div>
          </div>
        ) : activeTab === 'excel_file' ? (
          /* ── Excel 文件向量化面板 ── */
          <div className="flex flex-col gap-4">
            {/* 文件列表 */}
            <div className="rounded-xl border border-border-light bg-surface-primary p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  {loadingExcelFiles ? '加载中…' : `${excelFiles.length} 个文件`}
                </span>
                <button
                  onClick={() => fetchExcelFiles()}
                  disabled={loadingExcelFiles}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-green-400 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingExcelFiles ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              {excelFiles.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-center">
                    <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-text-secondary/40" />
                    <p className="text-sm text-text-secondary">暂无文件</p>
                    <p className="mt-1 text-xs text-text-tertiary">点击右上角「上传 Excel」添加文件</p>
                  </div>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {excelFiles.map((f) => (
                    <li key={f.fileId} className="flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileSpreadsheet className="h-4 w-4 text-green-400 shrink-0" />
                        <span className="text-sm text-text-primary truncate" title={f.filename}>{f.filename}</span>
                        <span className="text-xs text-text-secondary whitespace-nowrap">
                          {f.rowCount} 行 · {f.cellCount} 个单元格
                        </span>
                        {f.primaryColumns && f.primaryColumns.length > 0 && (
                          <span className="text-[10px] rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-green-400 whitespace-nowrap" title={`主列: ${f.primaryColumns.join(', ')}`}>
                            主列: {f.primaryColumns.join(', ')}
                          </span>
                        )}
                        {f.excludedColumns && f.excludedColumns.length > 0 && (
                          <span className="text-[10px] rounded bg-surface-primary px-1.5 py-0.5 text-text-tertiary whitespace-nowrap" title={`排除列: ${f.excludedColumns.join(', ')}`}>
                            排除: {f.excludedColumns.length} 列
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-text-secondary">{new Date(f.createdAt).toLocaleDateString()}</span>
                        <button
                          onClick={() => handlePreviewExcelFile(f)}
                          title="预览内容"
                          disabled={loadingPreview}
                          className="rounded p-1 text-text-secondary hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteExcelFile(f.fileId, f.filename)}
                          title="删除"
                          className="rounded p-1 text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 测试检索 */}
            <div className="rounded-xl border border-border-light bg-surface-primary p-4 flex flex-col gap-3">
              <p className="text-sm font-medium text-text-primary">测试检索</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={excelSearchQuery}
                  onChange={(e) => setExcelSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExcelSearch()}
                  placeholder="输入关键词，如：存款余额"
                  className="flex-1 rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <button
                  onClick={handleExcelSearch}
                  disabled={excelSearching || !excelSearchQuery.trim() || excelFiles.length === 0}
                  className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                >
                  {excelSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  检索
                </button>
              </div>

              {excelSearchResults.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {excelSearchResults.map((r, i) => (
                    <li key={i} className="rounded-lg border border-border-light bg-surface-secondary p-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-green-400">{r.columnName}</span>
                          {r.isPrimaryColumn && (
                            <span className="rounded border border-green-500/30 bg-green-500/10 px-1 py-0.5 text-[10px] font-semibold text-green-400">主列</span>
                          )}
                          {r.matchedViaAlias && (
                            <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1 py-0.5 text-[10px] font-semibold text-sky-400">别名命中</span>
                          )}
                          <span className="text-xs text-text-secondary">=</span>
                          <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-xs font-semibold text-green-300">{r.cellValue}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-text-secondary whitespace-nowrap shrink-0">
                          <span className="text-[10px] text-text-secondary/60 truncate max-w-[80px]" title={r.filename}>{r.filename}</span>
                          <span className="rounded bg-green-700/30 px-1.5 py-0.5 text-green-400">
                            {(r.score * 100).toFixed(r.score >= 0.995 ? 0 : 1)}%
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed line-clamp-3" title={r.fullRow}>
                        {r.fullRow}
                      </p>
                      {isAliasCapableFile(r.filename) && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {(r.aliases || []).length > 0 ? (
                            (r.aliases || []).map((a) => (
                              <span key={a} className="rounded border border-border-medium bg-surface-primary px-1.5 py-0.5 text-[10px] text-text-secondary">
                                别名: {a}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-text-tertiary">暂无别名</span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              openAliasEditor({
                                filename: r.filename,
                                rowKey: r.rowKey,
                                rowIndex: r.rowIndex,
                                fullRow: r.fullRow,
                                sheetName: r.sheetName,
                                aliases: r.aliases,
                              })
                            }
                            className="ml-auto text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            管理别名
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-text-secondary">
                检索优先命中「主列」；「排除列」不参与检索。编码类查询（如 A0000）建议 org_code、name 设为主列，region_org_code 等关联字段设为排除列。右上角「RAG测试」会综合检索全部知识库。
              </p>
            </div>
          </div>
        ) : isTableExtractTab(activeTab) ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border-light bg-surface-primary p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text-primary">
                  {activeTab === 'kpi_definition' ? '从数据表抽取指标定义' : '从数据表抽取机构信息'}
                </p>
              </div>
              {isMockKnowledgeDataSource && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  当前为 <span className="font-medium">Mock 数据源</span>
                  （host=<code className="font-mono">knowledge-extract.mock</code>
                  ）。选表与抽取走内置样例，不连真实 GaussDB；向量化与测试检索仍写入本数据源的 file_vectors。
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[160px] flex-1">
                  <label className="mb-1 block text-xs text-text-secondary">Schema</label>
                  <SearchableSelect
                    value={extractSchema}
                    onChange={(v) => handleExtractSchemaChange(v || '')}
                    options={extractSchemas}
                    placeholder={loadingExtractSchemas ? '加载中…' : '选择 / 搜索 schema'}
                    disabled={loadingExtractSchemas}
                    loading={loadingExtractSchemas}
                    emptyText="无匹配 schema"
                  />
                </div>
                <div className="min-w-[200px] flex-1">
                  <label className="mb-1 block text-xs text-text-secondary">表</label>
                  <SearchableSelect
                    value={extractTable}
                    onChange={(v) => setExtractTable(v || '')}
                    options={extractTables}
                    placeholder={
                      loadingExtractTables
                        ? '加载中…'
                        : !extractSchema
                          ? '请先选 schema'
                          : '选择 / 搜索表'
                    }
                    disabled={loadingExtractTables || !extractSchema}
                    loading={loadingExtractTables}
                    emptyText="无匹配表"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleExtractFromTable}
                  disabled={extracting || !extractSchema || !extractTable}
                  className="btn btn-secondary flex items-center gap-2 rounded-lg px-3 py-2"
                >
                  {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {extracting ? '抽取中…' : '从库抽取'}
                </Button>
              </div>
              <p className="text-xs text-text-tertiary">
                {activeTab === 'kpi_definition'
                  ? '指标：从 kpi.kpi_result_ctcx 按 index_number 各自取最新 data_dt 去重，映射为「指标定义信息」（旧日期独有指标也会抽到）。'
                  : '机构：从 cmdata.c_par_brch_level 按 brchno 各自取最新 data_dt 去重后派生完整 org_master（含 leaf_child_codes / 下级机构列表等；旧日期独有机构也会抽到）。'}
              </p>
            </div>

            {extractResult && (
              <div className="rounded-xl border border-border-light bg-surface-primary p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-text-primary">{extractResult.filename}</span>
                    <span className="text-xs text-text-secondary">
                      {extractResult.kind === 'org' ? `${extractPreviewHeaders.length} 列 org_master · ` : ''}
                      共 {extractResult.rowCount} 行
                      {extractResult.dataDt ? ` · data_dt=${extractResult.dataDt}` : ''}
                      {extractResult.schema && extractResult.table
                        ? ` · ${extractResult.schema}.${extractResult.table}`
                        : ''}
                      {extractResult.mock ? ' · mock' : ''}
                      {extractResult.previewTruncated ? ' · 服务端预览已截断' : ''}
                    </span>
                  </div>
                  <Button
                    type="button"
                    onClick={openExtractVectorizeConfig}
                    disabled={vectorizingExtract || !extractResult.rows.length}
                    className="btn btn-primary flex items-center gap-2 rounded-lg px-3 py-2"
                  >
                    {vectorizingExtract ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {vectorizingExtract ? '向量化中…' : '配置列并向量化'}
                  </Button>
                </div>
                <div className="max-h-80 overflow-auto rounded-lg border border-border-light">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-secondary text-left text-text-secondary">
                      <tr>
                        {extractPreviewHeaders.map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(extractPreviewExpanded
                        ? extractResult.rows
                        : extractResult.rows.slice(0, EXTRACT_PREVIEW_LIMIT)
                      ).map((row, idx) => (
                        <tr key={idx} className="border-t border-border-light/60 hover:bg-surface-secondary/40">
                          {extractPreviewHeaders.map((h) => (
                            <td key={h} className="max-w-[280px] truncate px-2 py-1 text-text-primary" title={row[h] || ''}>
                              {row[h] || ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {extractResult.rows.length > EXTRACT_PREVIEW_LIMIT && (
                  <div className="flex items-center justify-between text-xs text-text-secondary">
                    <span>
                      {extractPreviewExpanded
                        ? `已展开全部 ${extractResult.rows.length} 行预览`
                        : `默认展示前 ${EXTRACT_PREVIEW_LIMIT} 行（共 ${extractResult.rowCount} 行）`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExtractPreviewExpanded((v) => !v)}
                      className="text-green-400 hover:text-green-300 transition-colors"
                    >
                      {extractPreviewExpanded ? '收起' : '展开查看全部'}
                    </button>
                  </div>
                )}
                {extractResult.rows.length <= EXTRACT_PREVIEW_LIMIT && extractResult.rows.length > 0 && (
                  <p className="text-xs text-text-tertiary">
                    共 {extractResult.rowCount} 行（全部已展示）
                  </p>
                )}
              </div>
            )}

            <div className="rounded-xl border border-border-light bg-surface-primary p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {extractVectorFiles[0]
                    ? `已向量化：${extractVectorFiles[0].filename} · 共 ${extractVectorFiles[0].rowCount} 行${
                        extractVectorFiles[0].dataDt ||
                        (extractResult?.filename === extractVectorFiles[0].filename && extractResult.dataDt)
                          ? ` · data_dt=${extractVectorFiles[0].dataDt || extractResult?.dataDt}`
                          : ''
                      } · 配置日期 ${new Date(extractVectorFiles[0].createdAt).toLocaleDateString()}`
                    : `已向量化：${extractKbFilename}（尚未写入）`}
                </span>
                <button
                  onClick={() => fetchExcelFiles()}
                  disabled={loadingExcelFiles}
                  className="flex shrink-0 items-center gap-1 text-xs text-text-secondary hover:text-green-400 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingExcelFiles ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
              {extractVectorFiles.map((f) => (
                <div key={f.fileId} className="mb-2 flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
                  <span className="text-xs text-text-secondary">
                    {f.primaryColumns?.length ? `主列: ${f.primaryColumns.join(', ')}` : '未配置主列'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePreviewExcelFile(f)}
                      title="预览"
                      className="rounded p-1 text-text-secondary hover:text-blue-400"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteExcelFile(f.fileId, f.filename)}
                      title="删除"
                      className="rounded p-1 text-text-secondary hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border-light bg-surface-primary p-4 flex flex-col gap-3">
              <p className="text-sm font-medium text-text-primary">测试检索</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={excelSearchQuery}
                  onChange={(e) => setExcelSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExtractSearch()}
                  placeholder={
                    activeTab === 'kpi_definition'
                      ? '如：各项存款余额'
                      : '如：武进支行 / A0001'
                  }
                  className="flex-1 rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <button
                  onClick={handleExtractSearch}
                  disabled={excelSearching || !excelSearchQuery.trim() || extractVectorFiles.length === 0}
                  className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                >
                  {excelSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  检索
                </button>
              </div>
              {excelSearchResults.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {excelSearchResults.map((r, i) => (
                    <li key={i} className="rounded-lg border border-border-light bg-surface-secondary p-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-green-400">{r.columnName}</span>
                          {r.isPrimaryColumn && (
                            <span className="rounded border border-green-500/30 bg-green-500/10 px-1 py-0.5 text-[10px] font-semibold text-green-400">主列</span>
                          )}
                          {r.matchedViaAlias && (
                            <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1 py-0.5 text-[10px] font-semibold text-sky-400">别名命中</span>
                          )}
                          <span className="text-xs text-text-secondary">=</span>
                          <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-xs font-semibold text-green-300">{r.cellValue}</span>
                        </div>
                        <span className="rounded bg-green-700/30 px-1.5 py-0.5 text-xs text-green-400">
                          {(r.score * 100).toFixed(r.score >= 0.995 ? 0 : 1)}%
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed line-clamp-3" title={r.fullRow}>
                        {r.fullRow}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {(r.aliases || []).length > 0 ? (
                          (r.aliases || []).map((a) => (
                            <span key={a} className="rounded border border-border-medium bg-surface-primary px-1.5 py-0.5 text-[10px] text-text-secondary">
                              别名: {a}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-text-tertiary">暂无别名</span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            openAliasEditor({
                              fileId: extractVectorFiles[0]?.fileId,
                              filename: r.filename || extractKbFilename,
                              rowKey: r.rowKey,
                              rowIndex: r.rowIndex,
                              fullRow: r.fullRow,
                              sheetName: r.sheetName,
                              aliases: r.aliases,
                            })
                          }
                          className="ml-auto text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          管理别名
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : knowledgeEntries.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-text-secondary">
            <div className="text-center">
              <p className="text-sm">暂无{activeTabConfig?.label}</p>
              <p className="mt-2 text-xs text-text-tertiary">
                点击右上角"添加{activeTabConfig?.label}"按钮开始添加
              </p>
            </div>
          </div>
        ) : (
          <div className={cn(
            activeTab === 'qa_pair' || activeTab === 'synonym'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'
              : 'space-y-2'
          )}>
            {knowledgeEntries.map((entry) => (
              <KnowledgeEntryCard
                key={entry._id}
                entry={entry}
                activeTab={activeTab}
                onView={(entry) => setShowViewModal(entry)}
                onEdit={(entry) => setShowEditModal(entry)}
                onDelete={() => handleDelete(entry._id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 添加模态框 */}
      {showAddModal && selectedDataSourceId && (
        <>
          {(activeTab === 'qa_pair' || activeTab === 'synonym') ? (
            <BatchAddKnowledgeModal
              type={activeTab as 'qa_pair' | 'synonym'}
              dataSourceId={selectedDataSourceId}
              onClose={() => setShowAddModal(false)}
              onAdd={(payload) => addMutation.mutate(payload)}
              isLoading={addMutation.isLoading}
            />
          ) : (
            <AddKnowledgeModal
              type={activeTab}
              dataSourceId={selectedDataSourceId}
              onClose={() => setShowAddModal(false)}
              onAdd={(payload) => addMutation.mutate(payload)}
              isLoading={addMutation.isLoading}
            />
          )}
        </>
      )}

      {/* 编辑模态框 */}
      {showEditModal && selectedDataSourceId && (
        <EditKnowledgeModal
          entry={showEditModal}
          dataSourceId={selectedDataSourceId}
          onClose={() => setShowEditModal(null)}
          onUpdate={(payload) => updateMutation.mutate({ id: showEditModal._id, payload })}
          isLoading={updateMutation.isLoading}
        />
      )}

      {/* 查看模态框 */}
      {showViewModal && (
        <ViewKnowledgeModal entry={showViewModal} onClose={() => setShowViewModal(null)} />
      )}

      {/* Excel 上传列配置弹窗 */}
      {showUploadConfigModal && pendingUploadFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] rounded-xl border border-border-light bg-surface-primary p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">配置 Excel 检索列</h3>
              <button
                onClick={resetUploadConfigModal}
                title="取消"
                aria-label="取消上传"
                className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg bg-surface-secondary px-3 py-2 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-green-400 shrink-0" />
              <span className="text-sm text-text-primary truncate">{pendingUploadFile.name}</span>
              {excelSheetNames.length > 0 && (
                <span className="text-xs text-text-secondary whitespace-nowrap">
                  {excelSheetNames.length} 个 sheet
                </span>
              )}
            </div>

            {loadingExcelHeaders ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在解析表头…
              </div>
            ) : excelHeaders.length === 0 ? (
              <p className="text-sm text-text-secondary py-6 text-center">未识别到表头，请确认 Excel 首行为列名</p>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-text-secondary">
                    已识别 {excelHeaders.length} 列。主列优先返回；排除列不会参与检索。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={excludeAllExceptPrimary}
                      disabled={selectedPrimaryColumns.length === 0}
                      title={selectedPrimaryColumns.length === 0 ? '请先选择至少一列作为主列' : undefined}
                      className="rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-green-500/40 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      除主列外全设为排除
                    </button>
                    <div className="flex gap-1.5 text-[10px] whitespace-nowrap">
                      <span className="rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-green-400">
                        主列 {selectedPrimaryColumns.length}
                      </span>
                      <span className="rounded border border-border-light bg-surface-secondary px-1.5 py-0.5 text-text-secondary">
                        可检索 {excelHeaders.length - selectedPrimaryColumns.length - selectedExcludedColumns.length}
                      </span>
                      <span className="rounded border border-border-light bg-surface-secondary px-1.5 py-0.5 text-text-tertiary">
                        排除 {selectedExcludedColumns.length}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-auto rounded-lg border border-border-light bg-surface-secondary/30">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-surface-secondary text-left text-xs text-text-secondary">
                      <tr>
                        <th className="px-3 py-2.5 font-medium">列名（表头）</th>
                        <th className="px-3 py-2 font-medium w-28 text-center text-green-400/90">主列</th>
                        <th className="px-3 py-2 font-medium w-28 text-center">可检索</th>
                        <th className="px-3 py-2 font-medium w-28 text-center text-text-tertiary">排除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excelHeaders.map((header) => {
                        const role = columnRoles[header] || 'searchable';
                        return (
                          <tr key={header} className="border-t border-border-light/60 hover:bg-surface-secondary/60">
                            <td className="px-3 py-2 font-mono text-xs text-text-primary">{header}</td>
                            {(['primary', 'searchable', 'excluded'] as ExcelColumnRole[]).map((option) => (
                              <td key={option} className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setColumnRole(header, option)}
                                  className={getColumnRoleButtonClass(option, role === option)}
                                  aria-label={`${header} - ${option === 'primary' ? '主列' : option === 'excluded' ? '排除' : '可检索'}`}
                                >
                                  {option === 'primary' ? '主列' : option === 'excluded' ? '排除' : '检索'}
                                </button>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={resetUploadConfigModal}
                className="rounded-md border border-border-light px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExcelUpload}
                disabled={loadingExcelHeaders || excelHeaders.length === 0 || uploadingExcel}
                className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
              >
                {uploadingExcel ? '向量化中…' : '开始向量化'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 指标/机构抽取列配置弹窗 */}
      {showExtractConfigModal && extractResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] rounded-xl border border-border-light bg-surface-primary p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">
                配置检索列 · {extractResult.filename}
              </h3>
              <button
                onClick={() => setShowExtractConfigModal(false)}
                title="取消"
                aria-label="取消"
                className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-secondary">
                共 {extractResult.headers.length} 列 · {extractResult.rowCount} 行。
                {extractResult.kind === 'org'
                  ? ' 机构默认主列含 org_code / org_name / leaf_child_*，检索机构号可命中子机构列表；排除列不参与检索。'
                  : ' 主列优先返回；排除列不参与检索。'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={excludeAllExceptPrimary}
                  disabled={selectedPrimaryColumns.length === 0}
                  title={selectedPrimaryColumns.length === 0 ? '请先选择至少一列作为主列' : undefined}
                  className="rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-green-500/40 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  除主列外都设为排除
                </button>
                <div className="flex gap-1.5 text-[10px] whitespace-nowrap">
                  <span className="rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-green-400">
                    主列 {selectedPrimaryColumns.length}
                  </span>
                  <span className="rounded border border-border-light bg-surface-secondary px-1.5 py-0.5 text-text-secondary">
                    可检索 {excelHeaders.length - selectedPrimaryColumns.length - selectedExcludedColumns.length}
                  </span>
                  <span className="rounded border border-border-light bg-surface-secondary px-1.5 py-0.5 text-text-tertiary">
                    排除 {selectedExcludedColumns.length}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-auto rounded-lg border border-border-light bg-surface-secondary/30">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface-secondary text-left text-xs text-text-secondary">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">列名</th>
                    <th className="px-3 py-2 font-medium w-28 text-center text-green-400/90">主列</th>
                    <th className="px-3 py-2 font-medium w-28 text-center">可检索</th>
                    <th className="px-3 py-2 font-medium w-28 text-center text-text-tertiary">排除</th>
                  </tr>
                </thead>
                <tbody>
                  {excelHeaders.map((header) => {
                    const role = columnRoles[header] || 'searchable';
                    return (
                      <tr key={header} className="border-t border-border-light/60 hover:bg-surface-secondary/60">
                        <td className="px-3 py-2 font-mono text-xs text-text-primary">{header}</td>
                        {(['primary', 'searchable', 'excluded'] as ExcelColumnRole[]).map((option) => (
                          <td key={option} className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => setColumnRole(header, option)}
                              className={getColumnRoleButtonClass(option, role === option)}
                            >
                              {option === 'primary' ? '主列' : option === 'excluded' ? '排除' : '检索'}
                            </button>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowExtractConfigModal(false)}
                className="rounded-md border border-border-light px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExtractVectorize}
                disabled={vectorizingExtract || excelHeaders.length === 0}
                className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
              >
                {vectorizingExtract ? '向量化中…' : '开始向量化'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel 文件预览模态框 */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className={cn(
              'flex max-h-[80vh] w-full flex-col rounded-xl border border-border-light bg-surface-primary shadow-2xl',
              previewFile.file.filename === ORG_KB_FILENAME ? 'max-w-4xl' : 'max-w-3xl',
            )}
          >
            <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-5 w-5 text-green-400 shrink-0" />
                <h3 className="text-base font-semibold text-text-primary truncate">{previewFile.file.filename}</h3>
                <span className="text-xs text-text-secondary whitespace-nowrap">
                  {previewFile.rows.length} 行
                  {previewSearchQuery || previewAliasFilter !== 'all' ? '（已筛选）' : ''}
                </span>
              </div>
              <button onClick={() => setPreviewFile(null)} title="关闭预览" aria-label="关闭预览" className="rounded p-1 text-text-secondary hover:text-text-primary transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            {isAliasCapableFile(previewFile.file.filename) && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-5 py-3">
                <input
                  type="text"
                  value={previewSearchQuery}
                  onChange={(e) => setPreviewSearchQuery(e.target.value)}
                  placeholder="搜索编号 / 名称 / 别名…"
                  className="min-w-[180px] flex-1 rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <div className="flex items-center gap-1 rounded-md border border-border-light bg-surface-secondary p-0.5 text-xs">
                  {(
                    [
                      { id: 'all', label: '全部' },
                      { id: 'has', label: '有别名' },
                      { id: 'none', label: '无别名' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPreviewAliasFilter(opt.id)}
                      className={cn(
                        'rounded px-2 py-1 transition-colors',
                        previewAliasFilter === opt.id
                          ? 'bg-surface-primary text-text-primary'
                          : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {previewFile.file.filename === ORG_KB_FILENAME && (
                  <div className="flex items-center gap-1 rounded-md border border-border-light bg-surface-secondary p-0.5 text-xs">
                    {(
                      [
                        { id: 'tree' as const, label: '树状' },
                        { id: 'list' as const, label: '列表' },
                      ]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          const next = opt.id;
                          setPreviewViewMode(next);
                          if (next === 'tree' && previewFile?.file) {
                            refreshPreviewRows(previewFile.file, { clientFilter: true }).catch(
                              () => undefined,
                            );
                          }
                        }}
                        className={cn(
                          'rounded px-2 py-1 transition-colors',
                          previewViewMode === opt.id
                            ? 'bg-surface-primary text-text-primary'
                            : 'text-text-secondary hover:text-text-primary',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-auto p-4">
              {loadingPreview ? (
                <p className="text-sm text-text-secondary">加载中…</p>
              ) : previewFile.rows.length === 0 ? (
                <p className="text-sm text-text-secondary">暂无数据</p>
              ) : previewViewMode === 'tree' &&
                previewFile.file.filename === ORG_KB_FILENAME ? (
                <OrgHierarchyPreview
                  rows={previewFile.rows}
                  searchQuery={previewSearchQuery}
                  aliasFilter={previewAliasFilter}
                  onManageAlias={(row) =>
                    openAliasEditor({
                      fileId: previewFile.file.fileId,
                      filename: previewFile.file.filename,
                      rowKey: row.rowKey,
                      rowIndex: row.rowIndex,
                      fullRow: row.fullRow,
                      sheetName: row.sheetName,
                      aliases: row.aliases,
                    })
                  }
                />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {previewFile.rows.map((row) => (
                    <li key={`${row.sheetName}-${row.rowIndex}`} className="flex flex-col gap-1.5 rounded-md border border-border-light bg-surface-secondary px-3 py-2">
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 rounded bg-surface-primary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                          {row.rowIndex + 1}
                        </span>
                        <span className="text-xs text-text-primary leading-relaxed break-all">{row.fullRow}</span>
                      </div>
                      {isAliasCapableFile(previewFile.file.filename) && (
                        <div className="flex flex-wrap items-center gap-2 pl-7">
                          {(row.aliases || []).length > 0 ? (
                            (row.aliases || []).map((a) => (
                              <span key={a} className="rounded border border-border-medium bg-surface-primary px-1.5 py-0.5 text-[10px] text-text-secondary">
                                {a}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-text-tertiary">暂无别名</span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              openAliasEditor({
                                fileId: previewFile.file.fileId,
                                filename: previewFile.file.filename,
                                rowKey: row.rowKey,
                                rowIndex: row.rowIndex,
                                fullRow: row.fullRow,
                                sheetName: row.sheetName,
                                aliases: row.aliases,
                              })
                            }
                            className="ml-auto text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            管理别名
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border-light px-5 py-3 flex justify-end">
              <button onClick={() => setPreviewFile(null)} className="rounded-lg bg-surface-secondary px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 别名管理弹窗 */}
      {aliasEditor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border-light bg-surface-primary shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-light px-5 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text-primary">管理别名</h3>
                <p className="mt-0.5 truncate text-xs text-text-secondary">
                  {aliasEditor.rowKey}
                  {aliasEditor.filename ? ` · ${aliasEditor.filename}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAliasEditor(null)}
                className="rounded p-1 text-text-secondary hover:text-text-primary"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <ul className="flex flex-col gap-1.5 max-h-48 overflow-auto">
                {aliasEditor.aliases.length === 0 ? (
                  <li className="text-xs text-text-tertiary">尚未添加别名。例如「存款余额」。</li>
                ) : (
                  aliasEditor.aliases.map((a, idx) => (
                    <li key={`${a}-${idx}`} className="flex items-center gap-2 rounded-md border border-border-light bg-surface-secondary px-2 py-1.5">
                      <input
                        type="text"
                        value={a}
                        onChange={(e) => {
                          const next = [...aliasEditor.aliases];
                          next[idx] = e.target.value;
                          setAliasEditor({ ...aliasEditor, aliases: next });
                        }}
                        className="flex-1 bg-transparent text-sm text-text-primary outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAliasEditor({
                            ...aliasEditor,
                            aliases: aliasEditor.aliases.filter((_, i) => i !== idx),
                          })
                        }
                        className="rounded p-1 text-text-secondary hover:text-red-400"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = aliasDraft.trim();
                      if (!v) return;
                      if (aliasEditor.aliases.some((x) => x.toLowerCase() === v.toLowerCase())) {
                        showToast({ message: '别名已存在', status: 'warning' });
                        return;
                      }
                      setAliasEditor({ ...aliasEditor, aliases: [...aliasEditor.aliases, v] });
                      setAliasDraft('');
                    }
                  }}
                  placeholder="输入新别名后回车添加"
                  className="flex-1 rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = aliasDraft.trim();
                    if (!v) return;
                    if (aliasEditor.aliases.some((x) => x.toLowerCase() === v.toLowerCase())) {
                      showToast({ message: '别名已存在', status: 'warning' });
                      return;
                    }
                    setAliasEditor({ ...aliasEditor, aliases: [...aliasEditor.aliases, v] });
                    setAliasDraft('');
                  }}
                  className="rounded-md border border-border-light px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
                >
                  添加
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary">
                保存后，检索别名将作为主列优先命中；重新向量化不会丢失别名。
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-light px-5 py-3">
              <button
                type="button"
                onClick={() => setAliasEditor(null)}
                className="rounded-md border border-border-light px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveAliasEditor}
                disabled={aliasSaving}
                className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {aliasSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RAG测试模态框 */}
      {showRAGTestModal && selectedDataSourceId && (
        <RAGTestModal
          dataSourceId={selectedDataSourceId}
          onClose={() => setShowRAGTestModal(false)}
        />
      )}
    </div>
  );
}

interface KnowledgeEntryCardProps {
  entry: KnowledgeEntry;
  activeTab: KnowledgeType;
  onView: (entry: KnowledgeEntry) => void;
  onEdit: (entry: KnowledgeEntry) => void;
  onDelete: () => void;
}

function KnowledgeEntryCard({ entry, activeTab, onView, onEdit, onDelete }: KnowledgeEntryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = entry.children && entry.children.length > 0;
  const isDatabaseLevel = entry.metadata?.is_database_level === true;
  const isCompactView = activeTab === 'qa_pair' || activeTab === 'synonym';

  // 根据知识类型获取对应的图标
  const getEntryIcon = () => {
    if (isDatabaseLevel) {
      return isExpanded ? (
        <FolderOpen className="h-4 w-4 text-primary" />
      ) : (
        <Folder className="h-4 w-4 text-primary" />
      );
    }
    
    // 根据类型返回对应的图标
    const tabConfig = tabs.find((tab) => tab.id === entry.type);
    if (tabConfig) {
      return React.cloneElement(tabConfig.icon as React.ReactElement, {
        className: 'h-4 w-4 text-text-secondary',
      });
    }
    
    // 默认图标
    return <Database className="h-4 w-4 text-text-secondary" />;
  };

  // QA对和同义词的紧凑显示
  if (isCompactView) {
    const question = entry.metadata?.question || '';
    const answer = entry.metadata?.answer || '';
    const noun = entry.metadata?.noun || '';
    const synonyms = Array.isArray(entry.metadata?.synonyms) 
      ? entry.metadata.synonyms.join(', ')
      : entry.metadata?.synonyms || '';

    return (
      <div className="rounded-lg border border-border-light bg-surface-secondary p-3 transition-colors hover:bg-surface-hover">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {activeTab === 'qa_pair' ? (
              <>
                <div className="flex items-start gap-2 mb-1">
                  <MessageSquare className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary line-clamp-2">
                      <span className="text-text-tertiary">Q:</span> {question || entry.title.replace('QA: ', '')}
                    </p>
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                      <span className="text-text-tertiary">A:</span> {answer || entry.content.replace(/^问题:.*?\n答案: /, '')}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <BookOpen className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {noun || entry.title}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">
                      {synonyms || entry.content}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => onView(entry)}
              className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              title="查看详情"
              aria-label="查看详情"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onEdit(entry)}
              className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              title="编辑"
              aria-label="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-red-500"
              title="删除"
              aria-label="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary transition-colors hover:bg-surface-hover">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  title={isExpanded ? '折叠' : '展开'}
                  aria-label={isExpanded ? '折叠' : '展开'}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              )}
              {getEntryIcon()}
              <h4 className="font-medium text-text-primary">{entry.title}</h4>
              {hasChildren && entry.children && (
                <span className="text-xs text-text-tertiary">
                  ({entry.children.length} 个表)
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-text-secondary line-clamp-2">
              {entry.content.length > 100 ? `${entry.content.substring(0, 100)}...` : entry.content}
            </p>
            {entry.metadata && Object.keys(entry.metadata).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(entry.metadata)
                  .filter(([key]) => key !== 'is_database_level')
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded bg-surface-primary px-2 py-1 text-xs text-text-secondary"
                    >
                      {key}: {String(value)}
                    </span>
                  ))}
              </div>
            )}
            {entry.createdAt && (
              <p className="mt-2 text-xs text-text-tertiary">
                创建时间: {new Date(entry.createdAt).toLocaleString('zh-CN')}
              </p>
            )}
          </div>
          <div className="ml-4 flex gap-2">
            <button
              type="button"
              onClick={() => onView(entry)}
              className="rounded p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              title="查看详情"
              aria-label="查看详情"
            >
              <Eye className="h-4 w-4" />
            </button>
            {/* 只对 QA对、同义词、业务知识显示编辑按钮 */}
            {(entry.type === 'qa_pair' || entry.type === 'synonym' || entry.type === 'business_knowledge') && (
              <button
                type="button"
                onClick={() => onEdit(entry)}
                className="rounded p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                title="编辑"
                aria-label="编辑"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-2 text-text-secondary hover:bg-surface-hover hover:text-red-500"
              title="删除"
              aria-label="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* 子项展示（可展开/折叠） */}
      {hasChildren && isExpanded && entry.children && (
        <div className="border-t border-border-light bg-surface-primary pl-8 pr-4 py-2">
          <div className="space-y-2">
            {entry.children.map((child) => (
              <div
                key={child._id}
                className="flex items-center justify-between rounded border border-border-light bg-surface-secondary p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Database className="h-3 w-3 text-text-tertiary" />
                    <span className="text-sm font-medium text-text-primary">
                      {child.metadata?.table_name || child.title}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary line-clamp-1">
                    {child.content.length > 80 ? `${child.content.substring(0, 80)}...` : child.content}
                  </p>
                </div>
                <div className="ml-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onView(child)}
                    className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                    title="查看详情"
                    aria-label="查看详情"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface AddKnowledgeModalProps {
  type: KnowledgeType;
  dataSourceId: string;
  onClose: () => void;
  onAdd: (payload: AddKnowledgeRequest) => void;
  isLoading: boolean;
}

function AddKnowledgeModal({ type, dataSourceId, onClose, onAdd, isLoading }: AddKnowledgeModalProps) {
  const { showToast } = useToastContext();
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 语义模型导入方式选择状态
  const [semanticModelImportMode, setSemanticModelImportMode] = useState<'file' | 'database' | 'agent' | null>(
    type === 'semantic_model' ? null : null
  );
  const [generating, setGenerating] = useState(false);
  const [generatedSemanticModel, setGeneratedSemanticModel] = useState<any>(null);
  // Schema类型选择：'light' | 'meta'
  const [schemaType, setSchemaType] = useState<'light' | 'meta'>('meta');
  
  // 获取数据源列表（用于数据库生成方式）
  const { data: dataSourcesResponse } = useListDataSourcesQuery();
  const dataSources = dataSourcesResponse?.data || [];
  
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [agentRequirement, setAgentRequirement] = useState<string>('');
  
  // 处理Agent调用生成语义模型
  const handleStartAgentGeneration = () => {
    showToast({
      message: 'Agent 生成语义模型暂不可用',
      status: 'warning',
    });
  };
  
  // 文件上传 mutation（用于业务知识文档上传）
  const uploadFileMutation = useUploadFileMutation({
    onSuccess: (data) => {
      setUploadedFileId(data.file_id);
      showToast({
        message: '文件上传成功，正在向量化处理...',
        status: 'success',
      });
    },
    onError: (error: any) => {
      showToast({
        message: `文件上传失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileLowerName = file.name.toLowerCase();
    setFileName(fileLowerName);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      
      // 尝试解析 JSON 或 YAML
      try {
        if (fileLowerName.endsWith('.json')) {
          const json = JSON.parse(content);
          setFormData(json);
        } else if (fileLowerName.endsWith('.yaml') || fileLowerName.endsWith('.yml')) {
          // 支持 YAML 解析
          const yamlData = yaml.load(content) as Record<string, any>;
          setFormData(yamlData);
        }
      } catch (error) {
        showToast({
          message: '文件解析失败，请检查文件格式',
          status: 'error',
        });
      }
    };
    reader.readAsText(file);
  };

  // 处理数据库生成语义模型
  const handleGenerateFromDatabase = async (selectedDataSourceIdForGen: string) => {
    try {
      setGenerating(true);
      
      // 确保 schemaType 有值
      const effectiveSchemaType = schemaType || 'meta';
      console.log('[前端] 准备发送请求');
      console.log('[前端] selectedDataSourceIdForGen:', selectedDataSourceIdForGen);
      console.log('[前端] schemaType状态值:', schemaType);
      console.log('[前端] effectiveSchemaType:', effectiveSchemaType);
      console.log('[前端] schemaType类型:', typeof schemaType);
      
      const requestPayload = {
        id: selectedDataSourceIdForGen,
        userInput: {},
        schemaType: effectiveSchemaType, // 明确传递Schema类型
      };
      console.log('[前端] 完整payload:', JSON.stringify(requestPayload, null, 2));
      
      const response = await dataService.generateSemanticModel({
        id: selectedDataSourceIdForGen,
        userInput: {},
        schemaType: effectiveSchemaType, // 明确传递
      } as any); // 临时类型断言，等待TypeScript重新编译
      
      console.log('[前端] 请求发送完成，响应:', response);

      if (response.success && response.data) {
        // 解析YAML内容
        const yamlData = yaml.load(response.data.yaml) as any;
        setGeneratedSemanticModel({
          yaml: response.data.yaml,
          database: response.data.database,
          tableCount: response.data.tableCount,
          semanticModels: yamlData.semantic_models || [],
          schemaType, // 保存Schema类型
        });
        // 初始化formData，设置默认标题（如果还没有设置）
        if (!formData.title) {
          setFormData({
            ...formData,
            title: response.data.database || '',
          });
        }
        showToast({
          message: `语义模型生成成功（${schemaType === 'light' ? 'Light Schema' : 'MSchema'}），共包含 ${response.data.tableCount} 张表`,
          status: 'success',
        });
      } else {
        showToast({
          message: response.error || '生成语义模型失败',
          status: 'error',
        });
      }
    } catch (error) {
      showToast({
        message: `生成语义模型失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setGenerating(false);
    }
  };

  // 处理从数据库生成的语义模型添加到知识库
  const handleAddGeneratedSemanticModel = (title?: string, modelType?: string) => {
    if (!generatedSemanticModel) return;

    const databaseName = generatedSemanticModel.database || dataSourceId;
    const yamlData = yaml.load(generatedSemanticModel.yaml) as any;
    
    // 使用传入的title和modelType，如果为空则使用默认值
    const finalTitle = (title && title.trim()) || generatedSemanticModel.database || '语义模型';
    const finalModelType = (modelType && modelType.trim()) || undefined;

    onAdd({
      type: 'semantic_model',
      data: {
        isDatabaseLevel: true,
        databaseName: databaseName,
        semanticModels: yamlData.semantic_models || [],
        databaseContent: JSON.stringify(yamlData),
        metadata: {
          entity_id: dataSourceId,
          title: finalTitle,
          model_type: finalModelType,
        },
      },
    });
    showToast({
      message: `成功添加数据库语义模型: ${databaseName} (包含 ${generatedSemanticModel.tableCount} 个表)`,
      status: 'success',
    });
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (type === 'semantic_model') {
      // 语义模型：从文件或表单获取数据
      if (fileContent) {
        try {
          // 支持 JSON 和 YAML 文件解析
          let semanticData: Record<string, any>;
          
          if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
            // YAML 解析，确保数据结构与 JSON 一致
            semanticData = yaml.load(fileContent) as Record<string, any>;
            
            // 验证和规范化数据结构，确保与 JSON 格式一致
            if (!semanticData || typeof semanticData !== 'object') {
              throw new Error('YAML 文件格式错误：根元素必须是对象');
            }
            
            // 确保 semantic_models 是数组（如果存在）
            if (semanticData.semantic_models && !Array.isArray(semanticData.semantic_models)) {
              throw new Error('YAML 文件格式错误：semantic_models 必须是数组');
            }
          } else {
            semanticData = JSON.parse(fileContent);
          }
          
          // 检查是否为数据库级别的语义模型文件
          // 如果有 semantic_models 数组，无论是否有 database 字段，都应该创建父子结构
          if (semanticData.semantic_models && Array.isArray(semanticData.semantic_models) && semanticData.semantic_models.length > 0) {
            // 确定数据库名称：优先使用文件中的 database 字段，否则使用文件名（去除扩展名）
            const databaseName = semanticData.database || fileName.replace(/\.(yaml|yml|json)$/i, '') || 'unknown_database';
            
            // 数据库级别的批量导入：创建父级（数据库）和子级（表）
            // 一份文件对应一个数据库（父级），里面的表作为子级
            onAdd({
              type: 'semantic_model',
              data: {
                isDatabaseLevel: true,
                databaseName: databaseName,
                semanticModels: semanticData.semantic_models,
                databaseContent: JSON.stringify(semanticData), // 整个文件内容作为数据库级别的内容
                metadata: {
                  ...semanticData.metadata,
                  entity_id: dataSourceId, // 关联数据源
                  title: formData.title,
                  model_type: formData.model_type,
                },
              },
            });
            showToast({
              message: `成功添加数据库语义模型: ${databaseName} (包含 ${semanticData.semantic_models.length} 个表)`,
              status: 'success',
            });
            onClose();
            return;
          } else {
            // 单个语义模型
            onAdd({
              type: 'semantic_model',
              data: {
                semanticModelId: semanticData.name || semanticData.model,
                databaseName: semanticData.database || '',
                tableName: semanticData.name || semanticData.model,
                content: JSON.stringify(semanticData),
                entityId: dataSourceId, // 关联数据源
              },
            });
          }
        } catch (error) {
          showToast({
            message: '文件解析失败，请检查文件格式（支持 JSON 和 YAML）',
            status: 'error',
          });
          return;
        }
      } else {
        if (!formData.semanticModelId || !formData.databaseName || !formData.tableName) {
          showToast({
            message: '请填写所有必填字段',
            status: 'error',
          });
          return;
        }
        onAdd({
          type: 'semantic_model',
          data: {
            semanticModelId: formData.semanticModelId || '',
            databaseName: formData.databaseName || '',
            tableName: formData.tableName || '',
            content: formData.content || JSON.stringify({}),
            entityId: dataSourceId, // 关联数据源
          },
        });
      }
    } else if (type === 'qa_pair') {
      if (!formData.question || !formData.answer) {
        showToast({
          message: '请填写问题和答案',
          status: 'error',
        });
        return;
      }
      onAdd({
        type: 'qa_pair',
        data: {
          question: formData.question || '',
          answer: formData.answer || '',
          entityId: dataSourceId, // 关联数据源
        },
      });
    } else if (type === 'synonym') {
      if (!formData.noun || !formData.synonyms) {
        showToast({
          message: '请填写名词和同义词',
          status: 'error',
        });
        return;
      }
      onAdd({
        type: 'synonym',
        data: {
          noun: formData.noun || '',
          synonyms: Array.isArray(formData.synonyms)
            ? formData.synonyms
            : formData.synonyms?.split(',').map((s: string) => s.trim()) || [],
          entityId: dataSourceId, // 关联数据源
        },
      });
    } else if (type === 'business_knowledge') {
      // 如果上传了文件，使用文件信息；否则需要手动输入内容
      if (uploadedFileId) {
        // 使用上传的文件作为业务知识
        onAdd({
          type: 'business_knowledge',
          data: {
            title: formData.title || uploadedFile?.name || '文档',
            content: formData.content || `文档: ${uploadedFile?.name || '已上传文档'}`,
            category: formData.category || '',
            tags: Array.isArray(formData.tags)
              ? formData.tags
              : formData.tags?.split(',').map((s: string) => s.trim()) || [],
            entityId: dataSourceId, // 关联数据源
            fileId: uploadedFileId, // 关联上传的文件
            filename: uploadedFile?.name || '',
          },
        });
      } else {
        // 手动输入模式
        if (!formData.title || !formData.content) {
          showToast({
            message: '请填写标题和内容，或上传文档',
            status: 'error',
          });
          return;
        }
        onAdd({
          type: 'business_knowledge',
          data: {
            title: formData.title || '',
            content: formData.content || '',
            category: formData.category || '',
            tags: Array.isArray(formData.tags)
              ? formData.tags
              : formData.tags?.split(',').map((s: string) => s.trim()) || [],
            entityId: dataSourceId, // 关联数据源
          },
        });
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-lg bg-surface-primary p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">
            添加{tabs.find((t) => t.id === type)?.label}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">关闭</span>
          </button>
        </div>

        {type === 'semantic_model' && semanticModelImportMode === null ? (
          // 选择导入方式
          <div className="space-y-4">
            <div className="text-sm text-text-secondary mb-4">
              请选择添加语义模型的方式：
            </div>
            <div className="grid grid-cols-1 gap-4">
              <button
                type="button"
                onClick={() => setSemanticModelImportMode('file')}
                className="flex items-start gap-4 rounded-lg border-2 border-border-light bg-surface-secondary p-4 hover:border-primary hover:bg-surface-hover transition-colors text-left"
              >
                <FileText className="h-6 w-6 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-text-primary mb-1">从文件导入</div>
                  <div className="text-sm text-text-secondary">
                    上传 JSON/YAML 格式的语义模型文件，可以修改标题和语义模型类型
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSemanticModelImportMode('database')}
                className="flex items-start gap-4 rounded-lg border-2 border-border-light bg-surface-secondary p-4 hover:border-primary hover:bg-surface-hover transition-colors text-left"
              >
                <Database className="h-6 w-6 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-text-primary mb-1">连接数据库一键生成</div>
                  <div className="text-sm text-text-secondary">
                    自动连接数据库并生成语义模型，支持 MySQL 和 PostgreSQL
                  </div>
                </div>
              </button>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="暂不可用"
                className="flex items-start gap-4 rounded-lg border-2 border-border-light bg-surface-secondary p-4 text-left opacity-50 cursor-not-allowed grayscale"
              >
                <Bot className="h-6 w-6 text-text-tertiary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-text-tertiary mb-1">
                    Agent调用生成语义模型
                    <span className="ml-2 text-xs font-normal">（暂不可用）</span>
                  </div>
                  <div className="text-sm text-text-tertiary">
                    使用AI Agent基于模板系统生成高质量的语义模型，支持自定义需求描述
                  </div>
                </div>
              </button>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                onClick={onClose}
                className="btn btn-secondary rounded-lg px-4 py-2"
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {type === 'semantic_model' && semanticModelImportMode === 'file' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-base font-medium text-text-primary">从文件导入</h4>
                  <button
                    type="button"
                    onClick={() => {
                      setSemanticModelImportMode(null);
                      setFileContent('');
                      setFileName('');
                      setFormData({});
                    }}
                    className="text-sm text-text-secondary hover:text-text-primary"
                  >
                    返回
                  </button>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    上传文件 (JSON/YAML) *
                  </label>
                  <input
                    type="file"
                    accept=".json,.yaml,.yml"
                    onChange={handleFileUpload}
                    className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                    aria-label="上传语义模型文件"
                  />
                  <p className="mt-1 text-xs text-text-tertiary">
                    支持 JSON 或 YAML 格式的语义模型文件
                  </p>
                </div>
                {fileContent && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        标题
                      </label>
                      <input
                        type="text"
                        value={formData.title || ''}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                        placeholder="输入标题（可选）"
                        aria-label="标题"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        语义模型类型
                      </label>
                      <input
                        type="text"
                        value={formData.model_type || ''}
                        onChange={(e) => setFormData({ ...formData, model_type: e.target.value })}
                        className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                        placeholder="例如：分析语义模型、业务语义模型等（可选）"
                        aria-label="语义模型类型"
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {type === 'semantic_model' && semanticModelImportMode === 'database' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-base font-medium text-text-primary">连接数据库一键生成</h4>
                  <button
                    type="button"
                    onClick={() => {
                      setSemanticModelImportMode(null);
                      setGeneratedSemanticModel(null);
                    }}
                    className="text-sm text-text-secondary hover:text-text-primary"
                  >
                    返回
                  </button>
                </div>
                {!generatedSemanticModel ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        选择数据源 *
                      </label>
                      <select
                        value={dataSourceId}
                        className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                        disabled
                        title="数据源选择"
                        aria-label="数据源选择"
                      >
                        {dataSources.map((ds: DataSource) => (
                          <option key={ds._id} value={ds._id}>
                            {ds.name} ({ds.type.toUpperCase()} - {ds.database})
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-text-tertiary">
                        将使用当前选中的数据源生成语义模型
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        Schema类型 *
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-start gap-3 rounded-lg border border-border-light bg-surface-secondary p-3 cursor-pointer hover:bg-surface-hover transition-colors">
                          <input
                            type="radio"
                            name="schemaType"
                            value="light"
                            checked={schemaType === 'light'}
                            onChange={(e) => setSchemaType(e.target.value as 'light' | 'meta')}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <div className="font-medium text-text-primary mb-1">Light Schema（推荐用于Agent/LLM）</div>
                            <div className="text-xs text-text-secondary">
                              轻量、稳定、抗幻觉。只包含name、role、description和aggregation枚举，不包含SQL表达式和数据类型细节。适合给LLM/Agent理解使用。
                            </div>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-lg border border-border-light bg-surface-secondary p-3 cursor-pointer hover:bg-surface-hover transition-colors">
                          <input
                            type="radio"
                            name="schemaType"
                            value="meta"
                            checked={schemaType === 'meta'}
                            onChange={(e) => setSchemaType(e.target.value as 'light' | 'meta')}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <div className="font-medium text-text-primary mb-1">MSchema（完整可执行）</div>
                            <div className="text-xs text-text-secondary">
                              完整、可执行、包含SQL表达式、数据类型和join关系。适合系统/执行引擎使用，可直接生成SQL。
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={() => handleGenerateFromDatabase(dataSourceId)}
                      disabled={generating || !dataSourceId}
                      className="btn btn-primary w-full"
                    >
                      {generating ? (
                        <>
                          <Spinner className="h-4 w-4 mr-2" />
                          生成中...
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4 mr-2" />
                          生成语义模型
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg border border-border-light bg-surface-secondary p-4 mb-4">
                      <div className="text-sm text-text-primary mb-2">
                        <strong>生成成功！</strong> 数据库：{generatedSemanticModel.database}，包含 {generatedSemanticModel.tableCount} 张表
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        标题 *
                      </label>
                      <input
                        type="text"
                        value={formData.title !== undefined ? formData.title : (generatedSemanticModel.database || '')}
                        onChange={(e) => {
                          setFormData({ ...formData, title: e.target.value });
                        }}
                        className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                        placeholder="输入标题"
                        aria-label="标题"
                      />
                      <p className="mt-1 text-xs text-text-tertiary">
                        当前Schema类型：{generatedSemanticModel.schemaType === 'light' ? 'Light Schema（轻量，适合LLM/Agent）' : 'MSchema（完整可执行，适合系统引擎）'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        语义模型类型
                      </label>
                      <input
                        type="text"
                        value={formData.model_type !== undefined ? formData.model_type : ''}
                        onChange={(e) => setFormData({ ...formData, model_type: e.target.value })}
                        className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                        placeholder="例如：分析语义模型、业务语义模型等（可选）"
                        aria-label="语义模型类型"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => handleAddGeneratedSemanticModel(formData.title, formData.model_type)}
                        disabled={isLoading}
                        className="btn btn-primary flex-1"
                      >
                        {isLoading ? (
                          <>
                            <Spinner className="h-4 w-4 mr-2" />
                            添加中...
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-2" />
                            添加到知识库
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          setGeneratedSemanticModel(null);
                          setFormData({});
                        }}
                        className="btn btn-secondary"
                      >
                        重新生成
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            {type === 'semantic_model' && semanticModelImportMode === 'agent' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-base font-medium text-text-primary">Agent调用生成语义模型</h4>
                  <button
                    type="button"
                    onClick={() => {
                      setSemanticModelImportMode(null);
                      setSelectedAgentId('');
                      setAgentRequirement('');
                    }}
                    className="text-sm text-text-secondary hover:text-text-primary"
                  >
                    返回
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      选择Agent *
                    </label>
                    <select
                      value={selectedAgentId}
                      onChange={(e) => setSelectedAgentId(e.target.value)}
                      className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                      title="选择Agent"
                      aria-label="选择Agent"
                    >
                      <option value="">请选择Agent</option>
                    </select>
                    <p className="mt-1 text-xs text-text-tertiary">
                      Agent 生成语义模型暂不可用，请使用文件上传或手动配置。
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      需求描述（可选）
                    </label>
                    <textarea
                      value={agentRequirement}
                      onChange={(e) => setAgentRequirement(e.target.value)}
                      className="block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                      rows={4}
                      placeholder="描述你的语义模型需求，例如：&#10;- 领域：电商&#10;- 主要实体：用户、订单、商品&#10;- 分析需求：用户行为分析、销售统计等"
                      aria-label="需求描述"
                    />
                    <p className="mt-1 text-xs text-text-tertiary">
                      描述语义模型的领域、实体和分析需求，Agent将基于模板系统生成高质量的语义模型
                    </p>
                  </div>

                  <div className="rounded-lg border border-border-light bg-surface-secondary p-4 mb-4">
                    <div className="text-sm text-text-primary mb-2">
                      <strong>使用说明：</strong>
                    </div>
                    <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
                      <li>Agent调用生成语义模型需要在对话环境中进行</li>
                      <li>点击"开始生成"将打开新对话，Agent将使用语义模型模板系统生成规范的语义模型文档</li>
                      <li>生成完成后，可以将结果复制并手动添加到知识库</li>
                    </ul>
                  </div>

                  <Button
                    type="button"
                    onClick={handleStartAgentGeneration}
                    disabled={!selectedAgentId}
                    className="btn btn-primary w-full"
                  >
                    <Bot className="h-4 w-4 mr-2" />
                    开始生成
                  </Button>
                </div>
              </>
            )}

          {type === 'qa_pair' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary">问题 *</label>
                <input
                  type="text"
                  value={formData.question || ''}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入问题"
                  aria-label="问题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">答案 *</label>
                <textarea
                  value={formData.answer || ''}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  rows={4}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入答案"
                  aria-label="答案"
                />
              </div>
            </>
          )}

          {type === 'synonym' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary">名词 *</label>
                <input
                  type="text"
                  value={formData.noun || ''}
                  onChange={(e) => setFormData({ ...formData, noun: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入名词"
                  aria-label="名词"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">同义词 *</label>
                <input
                  type="text"
                  value={formData.synonyms || ''}
                  onChange={(e) => setFormData({ ...formData, synonyms: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  placeholder="用逗号分隔，例如：订购, 下单, 购买"
                  required
                />
                <p className="mt-1 text-xs text-text-tertiary">多个同义词用逗号分隔</p>
              </div>
            </>
          )}

          {type === 'business_knowledge' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary">
                  上传文档（可选）
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.md"
                    aria-label="上传文档"
                    title="上传文档"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setUploadedFile(file);
                        // 自动设置标题为文件名（如果标题为空）
                        if (!formData.title) {
                          setFormData({ ...formData, title: file.name.replace(/\.[^/.]+$/, '') });
                        }
                        // 上传文件并向量化
                        const uploadFormData = new FormData();
                        uploadFormData.append('file', file);
                        uploadFormData.append('endpoint', EModelEndpoint.agents);
                        uploadFormData.append('endpointType', EModelEndpoint.agents);
                        uploadFormData.append('tool_resource', EToolResources.file_search);
                        uploadFormData.append('entity_id', dataSourceId);
                        uploadFileMutation.mutate(uploadFormData);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary hover:bg-surface-hover"
                  >
                    <Upload className="h-4 w-4" />
                    {uploadedFile ? uploadedFile.name : '选择文档'}
                  </button>
                  {uploadedFile && (
                    <span className="text-xs text-text-secondary">
                      {uploadFileMutation.isLoading ? '上传中...' : uploadedFileId ? '✅ 已上传，可直接提交' : ''}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  支持 PDF、Word、TXT、Markdown 等格式，文件将自动向量化
                  {uploadedFileId && (
                    <span className="block mt-1 text-green-600 dark:text-green-400">
                      ✓ 文件已上传，可直接点击"添加"按钮提交
                    </span>
                  )}
                </p>
              </div>
              {!uploadedFileId && (
                <div className="text-sm text-text-secondary">或手动输入：</div>
              )}
              {!uploadedFileId && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-primary">标题 *</label>
                    <input
                      type="text"
                      value={formData.title || ''}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                      required
                      placeholder="输入标题"
                      aria-label="标题"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary">内容 *</label>
                    <textarea
                      value={formData.content || ''}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      rows={6}
                      className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                      required
                      placeholder="输入内容"
                      aria-label="内容"
                    />
                  </div>
                </>
              )}
              {uploadedFileId && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-primary">标题（可选）</label>
                    <input
                      type="text"
                      value={formData.title || ''}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                      placeholder={`默认: ${uploadedFile?.name || '文档'}`}
                      aria-label="标题"
                    />
                    <p className="mt-1 text-xs text-text-tertiary">
                      留空将使用文件名作为标题
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary">内容（可选）</label>
                    <textarea
                      value={formData.content || ''}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      rows={6}
                      className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                      placeholder="文档已上传，内容可选填写"
                      aria-label="内容"
                    />
                    <p className="mt-1 text-xs text-text-tertiary">
                      文档内容已从上传的文件中提取，此处可填写补充说明
                    </p>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-text-primary">分类</label>
                <input
                  type="text"
                  value={formData.category || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  placeholder="例如：流程说明、业务规则等"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">标签</label>
                <input
                  type="text"
                  value={formData.tags || ''}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  placeholder="用逗号分隔，例如：订单, 流程, 业务"
                />
                <p className="mt-1 text-xs text-text-tertiary">多个标签用逗号分隔</p>
              </div>
            </>
          )}

          {type !== 'semantic_model' || (semanticModelImportMode === 'file' && fileContent) || (semanticModelImportMode !== 'database' && semanticModelImportMode !== null) ? (
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                onClick={onClose}
                className="btn btn-secondary rounded-lg px-4 py-2"
              >
                取消
              </Button>
              {(type !== 'semantic_model' || semanticModelImportMode === 'file') && (
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="btn btn-primary rounded-lg px-4 py-2"
                >
                  {isLoading ? '添加中...' : '添加'}
                </Button>
              )}
            </div>
          ) : null}
          </form>
        )}
      </div>
    </div>
  );
}

interface ViewKnowledgeModalProps {
  entry: KnowledgeEntry;
  onClose: () => void;
}

function ViewKnowledgeModal({ entry, onClose }: ViewKnowledgeModalProps) {
  const { user } = useAuthContext();
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isMetadataExpanded, setIsMetadataExpanded] = useState(false);
  const [isSemanticDescriptionExpanded, setIsSemanticDescriptionExpanded] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const isSemanticModel = entry.type === 'semantic_model';
  // 支持 fileId 和 file_id 两种格式
  const fileId = entry.metadata?.fileId || entry.metadata?.file_id;
  const isBusinessKnowledgeWithFile = entry.type === 'business_knowledge' && fileId;
  
  // 获取文件内容
  const { refetch: downloadFile } = useFileDownload(user?.id, fileId);
  
  // 当 entry 变化时重置文件内容
  React.useEffect(() => {
    setFileContent(null);
    setIsLoadingFile(false);
  }, [entry._id]);

  React.useEffect(() => {
    if (isBusinessKnowledgeWithFile && fileId && !fileContent && !isLoadingFile) {
      setIsLoadingFile(true);
      downloadFile().then((result) => {
        if (result.data) {
          // 读取blob内容
          fetch(result.data)
            .then(res => res.blob())
            .then(blob => {
              // 尝试读取文本内容，支持更多文件类型
              const reader = new FileReader();
              reader.onload = (e) => {
                const text = e.target?.result as string;
                setFileContent(text);
                setIsLoadingFile(false);
              };
              reader.onerror = () => {
                // 如果读取失败，检查文件类型
                if (blob.type.startsWith('text/') || blob.type === 'application/json' || blob.type === '') {
                  // 对于空类型或文本类型，尝试直接读取
                  blob.text().then(text => {
                    setFileContent(text);
                    setIsLoadingFile(false);
                  }).catch(() => {
                    setFileContent(`[文件类型: ${blob.type || '未知'}] 文件大小: ${(blob.size / 1024).toFixed(2)} KB\n\n无法读取文件内容，请下载后查看。`);
                    setIsLoadingFile(false);
                  });
                } else {
                  setFileContent(`[文件类型: ${blob.type || '未知'}] 文件大小: ${(blob.size / 1024).toFixed(2)} KB\n\n此文件类型不支持预览，请下载后查看。`);
                  setIsLoadingFile(false);
                }
              };
              // 尝试读取为文本
              reader.readAsText(blob);
            })
            .catch((error) => {
              console.error('读取文件blob失败:', error);
              setFileContent('无法加载文件内容');
              setIsLoadingFile(false);
            });
        } else {
          setIsLoadingFile(false);
        }
      }).catch((error) => {
        console.error('文件下载失败:', error);
        setFileContent('无法加载文件内容，请检查文件是否存在');
        setIsLoadingFile(false);
      });
    }
  }, [isBusinessKnowledgeWithFile, fileId, fileContent, isLoadingFile, downloadFile]);

  const formatMetadata = (metadata: Record<string, any>): string => {
    try {
      // 对于语义模型，排除 semantic_description（因为它有独立的展示区域）
      const metadataToDisplay = { ...metadata };
      if (isSemanticModel && metadataToDisplay.semantic_description) {
        delete metadataToDisplay.semantic_description;
      }
      return JSON.stringify(metadataToDisplay, null, 2);
    } catch {
      return String(metadata);
    }
  };

  const formatContent = (content: string): string => {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-lg bg-surface-primary p-6 shadow-lg overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">查看详情</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">类型</label>
            <div className="rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary">
              {tabs.find((t) => t.id === entry.type)?.label || entry.type}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">标题</label>
            <div className="rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary">
              {entry.title}
            </div>
          </div>

          {/* 语义模型说明（仅对数据库级别的语义模型显示） */}
          {isSemanticModel && entry.metadata?.is_database_level && entry.metadata?.semantic_description && (
            <div>
              <button
                type="button"
                onClick={() => setIsSemanticDescriptionExpanded(!isSemanticDescriptionExpanded)}
                className="mb-2 flex w-full items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-4 py-3 transition-colors hover:bg-surface-hover"
                aria-label={isSemanticDescriptionExpanded ? '收起语义模型说明' : '展开语义模型说明'}
              >
                <div className="flex items-center gap-2">
                  {isSemanticDescriptionExpanded ? (
                    <ChevronDown className="h-4 w-4 text-text-secondary" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-text-secondary" />
                  )}
                  <span className="text-sm font-medium text-text-primary">语义模型说明</span>
                </div>
                <span className="text-xs text-text-tertiary">
                  {isSemanticDescriptionExpanded ? '点击收起' : '点击展开'}
                </span>
              </button>
              {isSemanticDescriptionExpanded && (
                <div className="rounded-lg border border-border-light bg-surface-secondary px-4 py-3">
                  <div className="max-h-96 overflow-auto text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                    <div className="text-text-primary">
                      {entry.metadata.semantic_description.split('\n').map((line, index) => {
                        // 检测 emoji 开头的行（表标题）
                        if (/^[1-9]️⃣/.test(line.trim())) {
                          return (
                            <div key={index} className="font-semibold text-base mt-4 mb-2 text-text-primary">
                              {line}
                            </div>
                          );
                        }
                        // 检测 "核心语义："、"可直接识别" 等标题
                        if (line.trim().endsWith('：') || line.trim().endsWith(':')) {
                          return (
                            <div key={index} className="font-medium mt-3 mb-1 text-text-primary">
                              {line}
                            </div>
                          );
                        }
                        // 检测列表项
                        if (line.trim().startsWith('-')) {
                          return (
                            <div key={index} className="ml-4 text-text-secondary">
                              {line}
                            </div>
                          );
                        }
                        // 检测分隔线
                        if (line.trim() === '---') {
                          return <hr key={index} className="my-4 border-border-light" />;
                        }
                        // 普通文本
                        if (line.trim()) {
                          return (
                            <div key={index} className="mb-1 text-text-secondary">
                              {line}
                            </div>
                          );
                        }
                        // 空行
                        return <br key={index} />;
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            {isSemanticModel ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsContentExpanded(!isContentExpanded)}
                  className="mb-2 flex w-full items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-4 py-3 transition-colors hover:bg-surface-hover"
                  aria-label={isContentExpanded ? '收起内容' : '展开内容'}
                >
                  <div className="flex items-center gap-2">
                    {isContentExpanded ? (
                      <ChevronDown className="h-4 w-4 text-text-secondary" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-text-secondary" />
                    )}
                    <span className="text-sm font-medium text-text-primary">内容</span>
                  </div>
                  <span className="text-xs text-text-tertiary">
                    {isContentExpanded ? '点击收起' : '点击展开'}
                  </span>
                </button>
                {isContentExpanded && (
                  <div className="rounded-lg border border-border-light bg-surface-secondary px-4 py-3">
                    <div className="max-h-96 overflow-auto text-sm text-text-primary font-mono whitespace-pre-wrap">
                      {formatContent(entry.content)}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  内容
                  {isBusinessKnowledgeWithFile && (entry.metadata?.filename || entry.metadata?.file_id) && (
                    <span className="ml-2 text-xs text-text-tertiary">
                      (文件: {entry.metadata?.filename || '已上传文件'})
                    </span>
                  )}
                </label>
                <div className="rounded-lg border border-border-light bg-surface-secondary px-4 py-3">
                  {isBusinessKnowledgeWithFile ? (
                    <>
                      {isLoadingFile ? (
                        <div className="flex items-center justify-center py-8">
                          <Spinner className="h-5 w-5 text-text-secondary" />
                          <span className="ml-2 text-sm text-text-secondary">加载文件内容中...</span>
                        </div>
                      ) : fileContent ? (
                        <div className="max-h-96 overflow-auto text-sm text-text-primary font-mono whitespace-pre-wrap break-words">
                          {fileContent}
                        </div>
                      ) : (
                        <div className="text-sm text-text-secondary">
                          <p>正在加载文件内容...</p>
                          <p className="mt-2 text-xs text-text-tertiary">
                            文件ID: {fileId}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="max-h-64 overflow-auto text-sm text-text-primary font-mono whitespace-pre-wrap break-words">
                      {entry.content}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div>
              {isSemanticModel ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsMetadataExpanded(!isMetadataExpanded)}
                    className="mb-2 flex w-full items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-4 py-3 transition-colors hover:bg-surface-hover"
                    aria-label={isMetadataExpanded ? '收起元数据' : '展开元数据'}
                  >
                    <div className="flex items-center gap-2">
                      {isMetadataExpanded ? (
                        <ChevronDown className="h-4 w-4 text-text-secondary" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-text-secondary" />
                      )}
                      <span className="text-sm font-medium text-text-primary">元数据</span>
                    </div>
                    <span className="text-xs text-text-tertiary">
                      {isMetadataExpanded ? '点击收起' : '点击展开'}
                    </span>
                  </button>
                  {isMetadataExpanded && (
                    <div className="rounded-lg border border-border-light bg-surface-secondary px-4 py-3">
                      <div className="max-h-96 overflow-auto text-sm text-text-primary font-mono whitespace-pre-wrap">
                        {formatMetadata(entry.metadata)}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-text-primary mb-1">元数据</label>
                  <div className="rounded-lg border border-border-light bg-surface-secondary px-4 py-3">
                    <div className="max-h-64 overflow-auto text-sm text-text-primary font-mono whitespace-pre-wrap">
                      {formatMetadata(entry.metadata)}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {entry.createdAt && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">创建时间</label>
              <div className="rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary">
                {new Date(entry.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
          )}

          {entry.updatedAt && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">更新时间</label>
              <div className="rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary">
                {new Date(entry.updatedAt).toLocaleString('zh-CN')}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-4">
            <Button
              type="button"
              onClick={onClose}
              className="btn btn-secondary rounded-lg px-4 py-2"
            >
              关闭
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditKnowledgeModalProps {
  entry: KnowledgeEntry;
  dataSourceId: string;
  onClose: () => void;
  onUpdate: (payload: { type: 'qa_pair' | 'synonym' | 'business_knowledge'; data: Record<string, any> }) => void;
  isLoading: boolean;
}

function EditKnowledgeModal({ entry, dataSourceId, onClose, onUpdate, isLoading }: EditKnowledgeModalProps) {
  const { showToast } = useToastContext();
  const [formData, setFormData] = useState<Record<string, any>>({});

  // 初始化表单数据
  React.useEffect(() => {
    if (entry.type === 'qa_pair') {
      setFormData({
        question: entry.metadata?.question || '',
        answer: entry.metadata?.answer || '',
      });
    } else if (entry.type === 'synonym') {
      setFormData({
        noun: entry.metadata?.noun || '',
        synonyms: Array.isArray(entry.metadata?.synonyms)
          ? entry.metadata.synonyms.join(', ')
          : entry.metadata?.synonyms || '',
      });
    } else if (entry.type === 'business_knowledge') {
      setFormData({
        title: entry.title || '',
        content: entry.content || '',
        category: entry.metadata?.category || '',
        tags: Array.isArray(entry.metadata?.tags)
          ? entry.metadata.tags.join(', ')
          : entry.metadata?.tags || '',
      });
    }
  }, [entry]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (entry.type === 'qa_pair') {
      if (!formData.question || !formData.answer) {
        showToast({
          message: '请填写问题和答案',
          status: 'error',
        });
        return;
      }
      onUpdate({
        type: 'qa_pair',
        data: {
          question: formData.question || '',
          answer: formData.answer || '',
        },
      });
    } else if (entry.type === 'synonym') {
      if (!formData.noun || !formData.synonyms) {
        showToast({
          message: '请填写名词和同义词',
          status: 'error',
        });
        return;
      }
      onUpdate({
        type: 'synonym',
        data: {
          noun: formData.noun || '',
          synonyms: Array.isArray(formData.synonyms)
            ? formData.synonyms
            : formData.synonyms?.split(',').map((s: string) => s.trim()) || [],
        },
      });
    } else if (entry.type === 'business_knowledge') {
      if (!formData.title || !formData.content) {
        showToast({
          message: '请填写标题和内容',
          status: 'error',
        });
        return;
      }
      onUpdate({
        type: 'business_knowledge',
        data: {
          title: formData.title || '',
          content: formData.content || '',
          category: formData.category || '',
          tags: Array.isArray(formData.tags)
            ? formData.tags
            : formData.tags?.split(',').map((s: string) => s.trim()) || [],
        },
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-lg bg-surface-primary p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">
            编辑{tabs.find((t) => t.id === entry.type)?.label}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {entry.type === 'qa_pair' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary">问题 *</label>
                <input
                  type="text"
                  value={formData.question || ''}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入问题"
                  aria-label="问题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">答案 *</label>
                <textarea
                  value={formData.answer || ''}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  rows={4}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入答案"
                  aria-label="答案"
                />
              </div>
            </>
          )}

          {entry.type === 'synonym' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary">名词 *</label>
                <input
                  type="text"
                  value={formData.noun || ''}
                  onChange={(e) => setFormData({ ...formData, noun: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入名词"
                  aria-label="名词"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">同义词 *</label>
                <input
                  type="text"
                  value={formData.synonyms || ''}
                  onChange={(e) => setFormData({ ...formData, synonyms: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  placeholder="用逗号分隔，例如：订购, 下单, 购买"
                  required
                  aria-label="同义词"
                />
                <p className="mt-1 text-xs text-text-tertiary">多个同义词用逗号分隔</p>
              </div>
            </>
          )}

          {entry.type === 'business_knowledge' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary">标题 *</label>
                <input
                  type="text"
                  value={formData.title || ''}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入标题"
                  aria-label="标题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">内容 *</label>
                <textarea
                  value={formData.content || ''}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={6}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  required
                  placeholder="输入内容"
                  aria-label="内容"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">分类</label>
                <input
                  type="text"
                  value={formData.category || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  placeholder="输入分类"
                  aria-label="分类"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary">标签</label>
                <input
                  type="text"
                  value={formData.tags || ''}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="mt-1 block w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
                  placeholder="用逗号分隔，例如：重要, 常用, 基础"
                  aria-label="标签"
                />
                <p className="mt-1 text-xs text-text-tertiary">多个标签用逗号分隔</p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              onClick={onClose}
              className="btn btn-secondary rounded-lg px-4 py-2"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary rounded-lg px-4 py-2"
            >
              {isLoading ? '更新中...' : '更新'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface BatchAddKnowledgeModalProps {
  type: 'qa_pair' | 'synonym';
  dataSourceId: string;
  onClose: () => void;
  onAdd: (payload: AddKnowledgeRequest) => void;
  isLoading: boolean;
}

function BatchAddKnowledgeModal({ type, dataSourceId, onClose, onAdd, isLoading }: BatchAddKnowledgeModalProps) {
  const { showToast } = useToastContext();
  const [addMode, setAddMode] = useState<'manual' | 'text' | 'file'>('text');
  const [items, setItems] = useState<Array<Record<string, string>>>([]);
  const [textInput, setTextInput] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 解析文本格式的QA对
  const parseQATextInput = (text: string): Array<Record<string, string>> => {
    const parsed: Array<Record<string, string>> = [];
    // 按空行或连续换行分割成多个QA对
    const qaBlocks = text.split(/\n\s*\n/).filter(block => block.trim());
    
    // 如果没有空行分隔，尝试按Q：或Q:来分割
    const hasQMarkers = /[Qq][：:]/.test(text);
    if (qaBlocks.length === 1 && hasQMarkers) {
      // 按Q：或Q:分割
      const qaMatches = text.split(/(?=[Qq][：:])/);
      qaMatches.forEach((block) => {
        const trimmed = block.trim();
        if (!trimmed) return;
        
        // 检查是否以Q:或Q：开头
        const qMatch = trimmed.match(/^[Qq][：:]\s*(.+?)(?=\n[Aa][：:]|\n\s*$)/s);
        if (qMatch) {
          const question = qMatch[1].trim();
          // 查找对应的A：或A:
          const aMatch = trimmed.match(/[Aa][：:]\s*(.+)$/s);
          if (aMatch) {
            const answer = aMatch[1].trim();
            if (question && answer) {
              parsed.push({ question, answer });
            }
          }
        }
      });
    } else {
      // 有空行分隔的情况
      qaBlocks.forEach((block) => {
        const lines = block.split('\n').map(line => line.trim()).filter(line => line);
        let question = '';
        let answer = '';
        let answerLines: string[] = [];
        let foundQ = false;
        let foundA = false;
        
        lines.forEach((line) => {
          // 检查是否以Q:或Q：开头
          const qMatch = line.match(/^[Qq][：:]\s*(.+)$/);
          if (qMatch) {
            question = qMatch[1].trim();
            foundQ = true;
            foundA = false; // 重置A标记
            answerLines = [];
            return;
          }
          
          // 检查是否以A:或A：开头
          const aMatch = line.match(/^[Aa][：:]\s*(.+)$/);
          if (aMatch) {
            answerLines = [aMatch[1].trim()];
            foundA = true;
            return;
          }
          
          // 如果已经找到A标记，后续行都是答案的一部分
          if (foundA && line) {
            answerLines.push(line);
          } else if (foundQ && !foundA && line) {
            // 如果找到了Q但还没找到A，这行可能是答案的开始
            answerLines.push(line);
            foundA = true;
          } else if (!foundQ && line) {
            // 如果还没找到Q，这行可能是问题
            question = line;
            foundQ = true;
          }
        });
        
        answer = answerLines.join('\n').trim();
        
        if (question && answer) {
          parsed.push({ question, answer });
        }
      });
    }
    
    return parsed;
  };

  // 解析文本格式的同义词
  const parseTextInput = (text: string): Array<Record<string, string>> => {
    const lines = text.split('\n').filter(line => line.trim());
    const parsed: Array<Record<string, string>> = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // 支持格式1: 主词：同义词1 同义词2 同义词3（冒号+空格）
      // 支持格式2: 主词：同义词1,同义词2,同义词3（冒号+逗号）
      // 支持格式3: 主词,同义词1,同义词2,同义词3（纯逗号）
      // 支持格式4: 主词 同义词1 同义词2 同义词3（纯空格）
      let noun = '';
      let synonyms = '';

      // 检查是否包含冒号（中英文）
      if (trimmed.includes('：') || trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf('：') !== -1 ? trimmed.indexOf('：') : trimmed.indexOf(':');
        noun = trimmed.substring(0, colonIndex).trim();
        const synonymsPart = trimmed.substring(colonIndex + 1).trim();
        
        // 如果包含逗号，按逗号分割；否则按空格分割
        if (synonymsPart.includes(',') || synonymsPart.includes('，')) {
          synonyms = synonymsPart.replace(/[，,]/g, ',').split(',').map(s => s.trim()).filter(s => s).join(', ');
        } else {
          synonyms = synonymsPart.split(/\s+/).filter(s => s).join(', ');
        }
      } else {
        // 没有冒号，检查是否包含逗号
        if (trimmed.includes(',') || trimmed.includes('，')) {
          // 按逗号分割（第一个是主词，后面是同义词）
          const parts = trimmed.split(/[,，]/).map(s => s.trim()).filter(s => s);
          if (parts.length >= 2) {
            noun = parts[0];
            synonyms = parts.slice(1).join(', ');
          } else {
            // 如果只有一个部分，可能是格式错误
            return;
          }
        } else {
          // 纯空格分割（第一个是主词，后面是同义词）
          const parts = trimmed.split(/\s+/).filter(s => s);
          if (parts.length >= 2) {
            noun = parts[0];
            synonyms = parts.slice(1).join(', ');
          } else {
            // 如果只有一个部分，可能是格式错误
            return;
          }
        }
      }

      if (noun && synonyms) {
        parsed.push({ noun, synonyms });
      }
    });

    return parsed;
  };

  const handleTextInputChange = (text: string) => {
    setTextInput(text);
    if (text.trim()) {
      if (type === 'synonym') {
        const parsed = parseTextInput(text);
        setItems(parsed);
      } else if (type === 'qa_pair') {
        const parsed = parseQATextInput(text);
        setItems(parsed);
      }
    } else {
      setItems([]);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      
      if (type === 'synonym') {
        // 解析文件内容
        const parsed = parseTextInput(content);
        if (parsed.length > 0) {
          setItems(parsed);
          setTextInput(content);
          showToast({
            message: `成功解析 ${parsed.length} 条同义词`,
            status: 'success',
          });
        } else {
          showToast({
            message: '文件格式不正确，请检查格式',
            status: 'error',
          });
        }
      } else if (type === 'qa_pair') {
        // 解析QA对文件内容
        const parsed = parseQATextInput(content);
        if (parsed.length > 0) {
          setItems(parsed);
          setTextInput(content);
          showToast({
            message: `成功解析 ${parsed.length} 条QA对`,
            status: 'success',
          });
        } else {
          showToast({
            message: '文件格式不正确，请检查格式',
            status: 'error',
          });
        }
      }
    };
    reader.readAsText(file);
  };

  const handleAddItem = () => {
    if (type === 'qa_pair') {
      setItems([...items, { question: '', answer: '' }]);
    } else {
      setItems([...items, { noun: '', synonyms: '' }]);
    }
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (addMode === 'text') {
      // 文本输入模式，重新解析
      if (!textInput.trim()) {
        showToast({
          message: `请输入${type === 'qa_pair' ? 'QA对' : '同义词'}内容`,
          status: 'error',
        });
        return;
      }
      let parsed: Array<Record<string, string>> = [];
      if (type === 'synonym') {
        parsed = parseTextInput(textInput);
      } else if (type === 'qa_pair') {
        parsed = parseQATextInput(textInput);
      }
      if (parsed.length === 0) {
        showToast({
          message: '格式不正确，请检查输入格式',
          status: 'error',
        });
        return;
      }
      setItems(parsed);
    }

    if (addMode === 'file' && type !== 'synonym') {
      showToast({
        message: '文件解析功能开发中，请使用手动输入模式',
        status: 'info',
      });
      return;
    }

    if (items.length === 0) {
      showToast({
        message: '请至少添加一条记录',
        status: 'error',
      });
      return;
    }

    // 验证并提交（逐个添加）
    let successCount = 0;
    items.forEach((item, index) => {
      if (type === 'qa_pair') {
        if (item.question && item.answer) {
          onAdd({
            type: 'qa_pair',
            data: {
              question: item.question,
              answer: item.answer,
              entityId: dataSourceId,
            },
          });
          successCount++;
        }
      } else {
        if (item.noun && item.synonyms) {
          // 解析同义词，支持逗号和空格分隔
          const synonymsArray = item.synonyms
            .split(/[,，\s]+/)
            .map((s: string) => s.trim())
            .filter((s: string) => s);
          
          if (synonymsArray.length > 0) {
            onAdd({
              type: 'synonym',
              data: {
                noun: item.noun,
                synonyms: synonymsArray,
                entityId: dataSourceId,
              },
            });
            successCount++;
          }
        }
      }
    });

    if (successCount > 0) {
      showToast({
        message: `成功提交 ${successCount} 条${type === 'qa_pair' ? 'QA对' : '同义词'}，正在添加...`,
        status: 'success',
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-lg bg-surface-primary p-6 shadow-lg overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">
            批量添加{type === 'qa_pair' ? 'QA对' : '同义词'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 添加方式选择 */}
          <div className="flex gap-4 border-b border-border-light pb-4">
            <button
              type="button"
              onClick={() => {
                setAddMode('text');
                setTextInput('');
                setItems([]);
              }}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors border-2',
                addMode === 'text'
                  ? 'border-primary text-text-primary bg-surface-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover bg-surface-secondary'
              )}
            >
              文本输入
            </button>
            <button
              type="button"
              onClick={() => {
                setAddMode('manual');
                setItems([]);
                setTextInput('');
              }}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors border-2',
                addMode === 'manual'
                  ? 'border-primary text-text-primary bg-surface-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover bg-surface-secondary'
              )}
            >
              逐条添加
            </button>
            <button
              type="button"
              onClick={() => {
                setAddMode('file');
                setItems([]);
                setTextInput('');
                fileInputRef.current?.click();
              }}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors border-2',
                addMode === 'file'
                  ? 'border-primary text-text-primary bg-surface-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover bg-surface-secondary'
              )}
            >
              文件解析
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json"
            onChange={handleFileUpload}
            className="hidden"
            aria-label="上传文件"
            title="上传文件"
          />

          {addMode === 'text' ? (
            <>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    批量输入{type === 'qa_pair' ? 'QA对' : '同义词'}
                  </label>
                  {type === 'qa_pair' ? (
                    <>
                      <p className="mb-3 text-xs text-text-tertiary">
                        使用 Q：和 A：分割问题和答案，每对QA之间用空行分隔
                      </p>
                      <textarea
                        value={textInput}
                        onChange={(e) => handleTextInputChange(e.target.value)}
                        rows={12}
                        className="w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary font-mono"
                        placeholder="例如：&#10;Q：什么是RAG？&#10;A：RAG是检索增强生成技术&#10;&#10;Q：如何使用语义模型？&#10;A：语义模型可以帮助理解数据库结构"
                        aria-label="批量输入QA对"
                      />
                    </>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-text-tertiary">
                        用逗号或者空格分割同义词，每行一条
                      </p>
                      <textarea
                        value={textInput}
                        onChange={(e) => handleTextInputChange(e.target.value)}
                        rows={12}
                        className="w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary font-mono"
                        placeholder="例如：&#10;订购：下单 购买 采购&#10;销售：售卖 出售 卖出&#10;客户，用户，消费者&#10;产品 商品"
                        aria-label="批量输入同义词"
                      />
                    </>
                  )}
                </div>
                {items.length > 0 && (
                  <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
                    <p className="text-sm font-medium text-text-primary mb-2">
                      预览（共 {items.length} 条）：
                    </p>
                    <div className="max-h-48 overflow-auto space-y-2">
                      {items.map((item, index) => (
                        <div key={index} className="text-xs text-text-secondary bg-surface-primary p-2 rounded">
                          {type === 'qa_pair' ? (
                            <>
                              <div className="mb-1">
                                <span className="font-medium text-text-primary">Q：</span>
                                {item.question}
                              </div>
                              <div>
                                <span className="font-medium text-text-primary">A：</span>
                                {item.answer}
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="font-medium text-text-primary">{item.noun}</span>
                              {'：'}
                              {item.synonyms}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : addMode === 'manual' ? (
            <>
              <div className="flex justify-between items-center">
                <p className="text-sm text-text-secondary">
                  已添加 {items.length} 条记录
                </p>
                <Button
                  type="button"
                  onClick={handleAddItem}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  添加一条
                </Button>
              </div>

              <div className="space-y-3 max-h-96 overflow-auto">
                {items.map((item, index) => (
                  <div key={index} className="border border-border-light rounded-lg p-4 bg-surface-secondary">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-text-primary">
                        第 {index + 1} 条
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="text-text-secondary hover:text-red-500"
                        title="删除"
                        aria-label="删除"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {type === 'qa_pair' ? (
                      <>
                        <div className="mb-2">
                          <label className="block text-xs font-medium text-text-primary mb-1">
                            问题 *
                          </label>
                          <input
                            type="text"
                            value={item.question || ''}
                            onChange={(e) => handleItemChange(index, 'question', e.target.value)}
                            className="w-full rounded border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                            placeholder="输入问题"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-primary mb-1">
                            答案 *
                          </label>
                          <textarea
                            value={item.answer || ''}
                            onChange={(e) => handleItemChange(index, 'answer', e.target.value)}
                            rows={2}
                            className="w-full rounded border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                            placeholder="输入答案"
                            required
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mb-2">
                          <label className="block text-xs font-medium text-text-primary mb-1">
                            名词 *
                          </label>
                          <input
                            type="text"
                            value={item.noun || ''}
                            onChange={(e) => handleItemChange(index, 'noun', e.target.value)}
                            className="w-full rounded border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                            placeholder="输入名词"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-primary mb-1">
                            同义词 *（用逗号分隔）
                          </label>
                          <input
                            type="text"
                            value={item.synonyms || ''}
                            onChange={(e) => handleItemChange(index, 'synonyms', e.target.value)}
                            className="w-full rounded border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                            placeholder="例如：订购, 下单, 购买"
                            required
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-center py-8 text-text-secondary">
                    <p className="text-sm">点击"添加一条"按钮开始添加</p>
                  </div>
                )}
              </div>
            </>
          ) : addMode === 'file' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  上传文件（.txt格式）
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary hover:bg-surface-hover"
                  >
                    <FileUp className="h-4 w-4" />
                    {fileContent ? '重新选择文件' : '选择文件'}
                  </button>
                  {fileContent && (
                    <span className="text-xs text-text-secondary">
                      已选择文件，共解析 {items.length} 条
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-text-tertiary">
                  {type === 'qa_pair' 
                    ? '文件格式：使用 Q：和 A：分割问题和答案，每对QA之间用空行分隔'
                    : '文件格式：每行一条，需要逗号或者空格分割同义词'}
                </p>
              </div>
              {items.length > 0 && (
                <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
                  <p className="text-sm font-medium text-text-primary mb-2">
                    预览（共 {items.length} 条）：
                  </p>
                  <div className="max-h-48 overflow-auto space-y-2">
                    {items.map((item, index) => (
                      <div key={index} className="text-xs text-text-secondary bg-surface-primary p-2 rounded">
                        {type === 'qa_pair' ? (
                          <>
                            <div className="mb-1">
                              <span className="font-medium text-text-primary">Q：</span>
                              {item.question}
                            </div>
                            <div>
                              <span className="font-medium text-text-primary">A：</span>
                              {item.answer}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-text-primary">{item.noun}</span>
                            {'：'}
                            {item.synonyms}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-4 border-t border-border-light">
            <Button
              type="button"
              onClick={onClose}
              className="btn btn-secondary rounded-lg px-4 py-2"
            >
              取消
            </Button>
            {((addMode === 'manual' && items.length > 0) || (addMode === 'text' && items.length > 0) || (addMode === 'file' && items.length > 0)) && (
              <Button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary rounded-lg px-4 py-2"
              >
                {isLoading ? '添加中...' : `添加 ${items.length} 条`}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

interface RAGTestModalProps {
  dataSourceId: string;
  onClose: () => void;
}

function RAGTestModal({ dataSourceId, onClose }: RAGTestModalProps) {
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<any>(null);

  const handleTest = async () => {
    if (!query.trim()) {
      showToast({
        message: '请输入查询内容',
        status: 'error',
      });
      return;
    }

    if (!token) {
      showToast({
        message: '未登录，请先登录',
        status: 'error',
      });
      return;
    }

    setIsLoading(true);
    setResults([]);
    setMetadata(null);

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      const response = await fetch('/api/rag/query', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          query: query.trim(),
          options: {
            entityId: dataSourceId,
            topK: 10,
            useReranking: true,
          },
        }),
      });

      if (!response.ok) {
        // 检查响应内容类型
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        if (isJson) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (e) {
            // JSON 解析失败
          }
        } else {
          // 如果不是 JSON，读取文本内容
          const text = await response.text().catch(() => '');
          errorMessage = text || errorMessage;
        }
        
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
      }

      const data = await response.json();
      const allResults = data.results || [];
      
      // 调试：打印相似度分布
      if (allResults.length > 0) {
        const scores = allResults.map(r => r.score || r.similarity || 0);
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        console.log('[RAG测试] 相似度分布:', {
          总数: allResults.length,
          最低: (minScore * 100).toFixed(1) + '%',
          最高: (maxScore * 100).toFixed(1) + '%',
          平均: (avgScore * 100).toFixed(1) + '%',
          分布: scores.map(s => (s * 100).toFixed(1) + '%').join(', '),
        });
      }
      
      setResults(allResults);
      setMetadata(data.metadata || null);

      if (allResults.length > 0) {
        const scoreRange = allResults.length > 1 
          ? `相似度范围: ${(Math.min(...allResults.map(r => r.score || r.similarity || 0)) * 100).toFixed(1)}% - ${(Math.max(...allResults.map(r => r.score || r.similarity || 0)) * 100).toFixed(1)}%`
          : '';
        showToast({
          message: `成功检索到 ${allResults.length} 条结果${scoreRange ? `，${scoreRange}` : ''}`,
          status: 'success',
        });
      } else {
        showToast({
          message: '未检索到相关结果',
          status: 'info',
        });
      }
    } catch (error: any) {
      console.error('RAG查询失败:', error);
      showToast({
        message: `RAG查询失败: ${error.message || '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      semantic_model: '语义模型',
      qa_pair: 'QA对',
      synonym: '同义词',
      business_knowledge: '业务知识',
      file: '文件',
    };
    return typeMap[type] || type;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-lg bg-surface-primary p-6 shadow-lg overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">RAG测试</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              查询内容
            </label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              className="w-full rounded border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary"
              placeholder="输入要查询的问题或关键词..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleTest();
                }
              }}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={onClose}
              className="btn btn-secondary rounded-lg px-4 py-2"
            >
              关闭
            </Button>
            <Button
              type="button"
              onClick={handleTest}
              disabled={isLoading || !query.trim()}
              className="btn btn-primary rounded-lg px-4 py-2"
            >
              {isLoading ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  查询中...
                </>
              ) : (
                '测试查询'
              )}
            </Button>
          </div>

          {metadata && (
            <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
              <p className="text-xs text-text-secondary">
                检索数量: {metadata.retrievalCount || 0} | 
                重排: {metadata.reranked ? '是' : '否'} | 
                增强重排: {metadata.enhancedReranking ? '是' : '否'}
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-text-primary">
                检索结果 ({results.length} 条)
              </h4>
              <div className="space-y-2 max-h-96 overflow-auto">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-border-light bg-surface-secondary p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium px-2 py-1 rounded bg-primary/20 text-primary">
                          {getTypeLabel(result.type)}
                        </span>
                        {(result.score !== undefined || result.similarity !== undefined) && (
                          <span className="text-xs text-text-tertiary">
                            相似度: {((result.score || result.similarity || 0) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    {result.title && (
                      <h5 className="text-sm font-medium text-text-primary mb-1">
                        {result.title}
                      </h5>
                    )}
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {result.content}
                    </p>
                    {result.metadata && Object.keys(result.metadata).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(result.metadata)
                          .filter(([key]) => key !== 'file_id' && key !== 'filename')
                          .slice(0, 3)
                          .map(([key, value]) => (
                            <span
                              key={key}
                              className="rounded bg-surface-primary px-2 py-1 text-xs text-text-secondary"
                            >
                              {key}: {String(value)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && results.length === 0 && query && (
            <div className="text-center py-8 text-text-secondary">
              <p className="text-sm">暂无检索结果</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
