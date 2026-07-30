import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Switch,
  useToastContext,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@because/client';
import { dataService } from '@because/data-provider';
import {
  ChevronDown,
  ChevronRight,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Database,
} from 'lucide-react';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';

type BrchLv = 1 | 2 | 3 | 4;

interface OrgUnit {
  orgCode: string;
  orgName?: string;
  parentOrgCode?: string | null;
  brchLv?: number | null;
  enabled?: boolean;
  dataScope?: string | null;
  source?: string;
  children?: OrgUnit[];
}

interface DataSourceOption {
  _id: string;
  name: string;
  type?: string;
  status?: string;
}

interface ColumnCheck {
  tableName: string;
  columns: { name: string; type: string }[];
  valid: boolean;
  message: string;
}

const REQUIRED_ORG_COLUMNS = ['data_dt', 'brchno', 'brchna', 'brchup', 'brchlv'];

const BRCH_LV_OPTIONS: { value: BrchLv; label: string; scope: string }[] = [
  { value: 1, label: '1 全行（查所有）', scope: 'ALL' },
  { value: 2, label: '2 本级+下级', scope: 'SELF_AND_DESCENDANTS' },
  { value: 3, label: '3 管理行本级+下级', scope: 'SELF_AND_DESCENDANTS' },
  { value: 4, label: '4 仅本级', scope: 'SELF' },
];

function getApiBase() {
  const baseEl = document.querySelector('base');
  const baseHref = baseEl?.getAttribute('href') || '/';
  return baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
}

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

function qualifiedTable(schema: string | null, table: string) {
  if (!table) return '';
  if (!schema) return table;
  if (table.includes('.')) return table;
  return `${schema}.${table}`;
}

function filterOrgTreeByQueryAndLevel(
  roots: OrgUnit[],
  opts: { q?: string; brchLv?: '' | string },
): { tree: OrgUnit[]; expandKeys: Set<string>; matchCount: number } {
  const q = String(opts.q || '')
    .trim()
    .toLowerCase();
  const lvFilter = opts.brchLv ? Number(opts.brchLv) : null;
  const expandKeys = new Set<string>();
  let matchCount = 0;

  const walk = (nodes: OrgUnit[]): OrgUnit[] => {
    const out: OrgUnit[] = [];
    for (const node of nodes) {
      const filteredChildren = walk(node.children || []);
      const textHit =
        !q ||
        `${node.orgCode} ${node.orgName || ''}`.toLowerCase().includes(q);
      const lvHit = lvFilter == null || Number(node.brchLv) === lvFilter;
      const selfMatch = textHit && lvHit;
      if (selfMatch) matchCount += 1;
      if (selfMatch || filteredChildren.length > 0) {
        if (filteredChildren.length > 0) expandKeys.add(node.orgCode);
        out.push({ ...node, children: filteredChildren });
      }
    }
    return out;
  };

  if (!q && lvFilter == null) {
    return { tree: roots, expandKeys, matchCount: 0 };
  }
  return { tree: walk(roots), expandKeys, matchCount };
}

function defaultExpandKeys(roots: OrgUnit[]): Set<string> {
  const keys = new Set<string>();
  for (const root of roots) {
    keys.add(root.orgCode);
    for (const child of root.children || []) {
      keys.add(child.orgCode);
    }
  }
  return keys;
}

/** 对齐 DAT「机构信息」树行：深度缩进 + 操作贴内容 + 行内 brchLv */
function OrgTreeNodeView({
  node,
  depth,
  expanded,
  onToggle,
  highlightQuery,
  onUpdateBrchLv,
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: OrgUnit;
  depth: number;
  expanded: Set<string>;
  onToggle: (code: string) => void;
  highlightQuery: string;
  onUpdateBrchLv: (node: OrgUnit, newLv: number) => void;
  onAddChild: (node: OrgUnit) => void;
  onEdit: (node: OrgUnit) => void;
  onDelete: (node: OrgUnit) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const isOpen = expanded.has(node.orgCode);
  const q = highlightQuery.trim().toLowerCase();
  const selfHit =
    !!q && `${node.orgCode} ${node.orgName || ''}`.toLowerCase().includes(q);

  return (
    <li className="flex flex-col">
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded py-1 pr-1.5 transition-colors cursor-pointer select-none',
          'hover:bg-sky-500/15 hover:ring-1 hover:ring-inset hover:ring-sky-500/30',
          selfHit && 'bg-sky-500/10',
          depth === 0 && 'font-medium',
        )}
        style={{ paddingLeft: 6 + depth * 18 }}
        onClick={() => hasChildren && onToggle(node.orgCode)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 rounded p-0 text-text-tertiary hover:text-text-primary"
            aria-label={isOpen ? '折叠' : '展开'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.orgCode);
            }}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="inline-block w-3.5 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-[13px] text-text-secondary group-hover:text-text-primary">
          {node.orgCode}
        </span>
        <span className="min-w-0 truncate text-[13px] text-text-primary">
          {node.orgName || ''}
        </span>
        {hasChildren ? (
          <span className="shrink-0 text-[11px] text-text-tertiary">
            {node.children!.length}
          </span>
        ) : null}
        <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Select
            value={node.brchLv != null ? String(node.brchLv) : undefined}
            onValueChange={(v) => onUpdateBrchLv(node, Number(v))}
          >
            <SelectTrigger
              className={cn(
                'h-6 w-[158px] text-xs',
                'border border-gray-300 bg-white text-gray-900',
                'dark:border-gray-600 dark:bg-gray-700 dark:text-white',
              )}
            >
              <SelectValue placeholder="未设置级别" />
            </SelectTrigger>
            <SelectContent className="border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
              {BRCH_LV_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {node.enabled === false ? (
            <span className="rounded bg-red-500/10 px-1.5 text-[11px] leading-5 text-red-500">
              已禁用
            </span>
          ) : null}
          <button
            type="button"
            className="rounded p-1 text-text-tertiary hover:bg-surface-hover hover:text-blue-500"
            title="添加子机构"
            onClick={() => onAddChild(node)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-tertiary hover:bg-surface-hover hover:text-blue-500"
            title="编辑"
            onClick={() => onEdit(node)}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-tertiary hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {hasChildren && isOpen ? (
        <ul className="flex flex-col gap-px">
          {node.children!.map((child) => (
            <OrgTreeNodeView
              key={child.orgCode}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              highlightQuery={highlightQuery}
              onUpdateBrchLv={onUpdateBrchLv}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const FIELD_CLASS =
  'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400';

export default function OrgPermissionManagement() {
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [enforcementEnabled, setEnforcementEnabled] = useState(false);
  const [savingSqlEnforcement, setSavingSqlEnforcement] = useState(false);
  const [sqlEnforcementEnabled, setSqlEnforcementEnabled] = useState(false);
  const [tree, setTree] = useState<OrgUnit[]>([]);
  const [unitCount, setUnitCount] = useState(0);
  const [dataSources, setDataSources] = useState<DataSourceOption[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'' | string>('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<OrgUnit | null>(null);
  const [form, setForm] = useState({
    orgCode: '',
    orgName: '',
    parentOrgCode: '',
    brchLv: '' as '' | string,
    enabled: true,
  });

  const [tableImportOpen, setTableImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<'datasource' | 'table' | 'result'>('datasource');
  const [importDataSourceId, setImportDataSourceId] = useState('');
  const [dbConnected, setDbConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [columnCheck, setColumnCheck] = useState<ColumnCheck | null>(null);
  const [validatingColumns, setValidatingColumns] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; dataDt?: string | null } | null>(
    null,
  );

  const authHeaders = useCallback((): HeadersInit => {
    const headers: HeadersInit = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }, [token]);

  const derivedScopeLabel = useMemo(() => {
    const lv = form.brchLv ? Number(form.brchLv) : null;
    return BRCH_LV_OPTIONS.find((o) => o.value === lv)?.label || '-';
  }, [form.brchLv]);

  const { tree: filteredTree, expandKeys: filterExpandKeys, matchCount } = useMemo(
    () => filterOrgTreeByQueryAndLevel(tree, { q: activeSearch, brchLv: levelFilter }),
    [tree, activeSearch, levelFilter],
  );

  const hasActiveFilter = Boolean(activeSearch.trim() || levelFilter);

  useEffect(() => {
    setExpanded(defaultExpandKeys(tree));
  }, [tree]);

  useEffect(() => {
    if (filterExpandKeys.size === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const k of filterExpandKeys) next.add(k);
      return next;
    });
  }, [filterExpandKeys]);

  const onToggle = useCallback((code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const applySearch = () => {
    setActiveSearch(searchInput.trim());
  };

  const updateBrchLvInTree = (nodes: OrgUnit[], orgCode: string, newLv: number): OrgUnit[] => {
    const scope = BRCH_LV_OPTIONS.find((o) => o.value === newLv)?.scope || null;
    return nodes.map((n) => {
      if (n.orgCode === orgCode) {
        return { ...n, brchLv: newLv, dataScope: scope };
      }
      if (n.children?.length) {
        return { ...n, children: updateBrchLvInTree(n.children, orgCode, newLv) };
      }
      return n;
    });
  };

  const handleUpdateBrchLv = async (node: OrgUnit, newLv: number) => {
    const prevTree = tree;
    setTree((t) => updateBrchLvInTree(t, node.orgCode, newLv));
    try {
      const apiBase = getApiBase();
      const res = await fetch(
        `${apiBase}/api/org-permission/units/${encodeURIComponent(node.orgCode)}`,
        {
          method: 'PUT',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ brchLv: newLv }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      showToast({
        message: `${node.orgCode} 级别已更新为 ${BRCH_LV_OPTIONS.find((o) => o.value === newLv)?.label || newLv}`,
        status: 'success',
      });
    } catch (error: any) {
      setTree(prevTree);
      showToast({ message: `更新级别失败: ${error.message}`, status: 'error' });
    }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const apiBase = getApiBase();
      const headers = { ...authHeaders(), 'Content-Type': 'application/json' };
      const [settingsRes, unitsRes, dsRes] = await Promise.all([
        fetch(`${apiBase}/api/org-permission/settings`, { headers, credentials: 'include' }),
        fetch(`${apiBase}/api/org-permission/units?tree=1`, { headers, credentials: 'include' }),
        fetch(`${apiBase}/api/config/data-sources`, { headers, credentials: 'include' }),
      ]);

      if (!settingsRes.ok) throw new Error(`settings ${settingsRes.status}`);
      if (!unitsRes.ok) throw new Error(`units ${unitsRes.status}`);

      const settingsJson = await settingsRes.json();
      const unitsJson = await unitsRes.json();
      setEnforcementEnabled(Boolean(settingsJson?.settings?.enforcementEnabled));
      setSqlEnforcementEnabled(Boolean(settingsJson?.settings?.sqlEnforcementEnabled));
      setTree(unitsJson?.tree || []);
      setUnitCount(Array.isArray(unitsJson?.units) ? unitsJson.units.length : 0);

      if (dsRes.ok) {
        const dsJson = await dsRes.json();
        const list = dsJson?.data || dsJson?.dataSources || dsJson?.datasources || [];
        setDataSources(Array.isArray(list) ? list : []);
      }
    } catch (error: any) {
      showToast({ message: `加载失败: ${error.message}`, status: 'error' });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveSettings = async (checked: boolean) => {
    setSavingSettings(true);
    const prev = enforcementEnabled;
    setEnforcementEnabled(checked);
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/org-permission/settings`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enforcementEnabled: checked }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast({
        message: checked ? '已开启机构权限拦截' : '已关闭机构权限拦截（回归软透传）',
        status: 'success',
      });
    } catch (error: any) {
      setEnforcementEnabled(prev);
      showToast({ message: `保存失败: ${error.message}`, status: 'error' });
    } finally {
      setSavingSettings(false);
    }
  };

  /**
   * 独立开关：控制 Because-jn 的 sql-executor 是否按机构权限强制校验/改写 SQL
   * （越权的 org_code 字面量直接拒绝执行；IN(...) 列表按可访问范围收窄）。
   * 与「机构权限拦截」（MCP 门禁）互相独立，可分别开关。
   */
  const saveSqlEnforcement = async (checked: boolean) => {
    setSavingSqlEnforcement(true);
    const prev = sqlEnforcementEnabled;
    setSqlEnforcementEnabled(checked);
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/org-permission/settings`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sqlEnforcementEnabled: checked }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast({
        message: checked
          ? '已开启 SQL 强制校验/改写（sql-executor 将按机构权限拦截越权 SQL）'
          : '已关闭 SQL 强制校验/改写',
        status: 'success',
      });
    } catch (error: any) {
      setSqlEnforcementEnabled(prev);
      showToast({ message: `保存失败: ${error.message}`, status: 'error' });
    } finally {
      setSavingSqlEnforcement(false);
    }
  };

  const openCreate = (parent?: OrgUnit) => {
    setEditing(null);
    setForm({
      orgCode: '',
      orgName: '',
      parentOrgCode: parent?.orgCode || '',
      brchLv: '',
      enabled: true,
    });
    setEditOpen(true);
  };

  const openEdit = (node: OrgUnit) => {
    setEditing(node);
    setForm({
      orgCode: node.orgCode,
      orgName: node.orgName || '',
      parentOrgCode: node.parentOrgCode || '',
      brchLv: node.brchLv != null ? String(node.brchLv) : '',
      enabled: node.enabled !== false,
    });
    setEditOpen(true);
  };

  const saveUnit = async () => {
    try {
      const apiBase = getApiBase();
      const payload = {
        orgCode: form.orgCode.trim(),
        orgName: form.orgName.trim(),
        parentOrgCode: form.parentOrgCode.trim() || null,
        brchLv: form.brchLv ? Number(form.brchLv) : null,
        enabled: form.enabled,
      };
      if (!payload.orgCode) {
        showToast({ message: '机构编码必填', status: 'error' });
        return;
      }
      const url = editing
        ? `${apiBase}/api/org-permission/units/${encodeURIComponent(editing.orgCode)}`
        : `${apiBase}/api/org-permission/units`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setEditOpen(false);
      showToast({ message: editing ? '已更新机构' : '已创建机构', status: 'success' });
      await loadAll();
    } catch (error: any) {
      showToast({ message: `保存失败: ${error.message}`, status: 'error' });
    }
  };

  const deleteUnit = async (node: OrgUnit) => {
    const cascade = window.confirm(
      `删除机构 ${node.orgCode}？\n确定=仅删本节点；取消后可再选级联。\n\n点「确定」后若还有子节点会再次询问是否级联。`,
    );
    if (!cascade) return;
    let withCascade = false;
    if (node.children?.length) {
      withCascade = window.confirm('检测到子机构，是否级联删除全部后代？');
    }
    try {
      const apiBase = getApiBase();
      const res = await fetch(
        `${apiBase}/api/org-permission/units/${encodeURIComponent(node.orgCode)}?cascade=${withCascade ? '1' : '0'}`,
        { method: 'DELETE', headers: authHeaders(), credentials: 'include' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
      showToast({ message: '已删除', status: 'success' });
      await loadAll();
    } catch (error: any) {
      showToast({ message: `删除失败: ${error.message}`, status: 'error' });
    }
  };

  const clearAll = async () => {
    if (!window.confirm('确认清空全部机构清单？此操作不可恢复。')) return;
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/org-permission/units`, {
        method: 'DELETE',
        headers: authHeaders(),
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
      showToast({ message: `已清空 ${json.deletedCount || 0} 条`, status: 'success' });
      await loadAll();
    } catch (error: any) {
      showToast({ message: `清空失败: ${error.message}`, status: 'error' });
    }
  };

  const resetImportModal = () => {
    setImportStep('datasource');
    setImportDataSourceId('');
    setDbConnected(false);
    setSchemas([]);
    setSelectedSchema('');
    setTables([]);
    setSelectedTable('');
    setColumnCheck(null);
    setImportResult(null);
    setConnecting(false);
    setLoadingSchemas(false);
    setLoadingTables(false);
    setValidatingColumns(false);
    setImporting(false);
  };

  const openTableImport = () => {
    resetImportModal();
    setTableImportOpen(true);
  };

  const loadSchemas = async (dsId: string) => {
    setLoadingSchemas(true);
    setDbConnected(false);
    setSchemas([]);
    setSelectedSchema('');
    setTables([]);
    setSelectedTable('');
    setColumnCheck(null);
    try {
      const res = await dataService.listDataSourceSchemas(dsId);
      if (!res?.success) {
        throw new Error((res as any)?.error || '获取 schema 列表失败');
      }
      const raw =
        res?.data?.schemas?.map((s) => s.schemaName).filter(Boolean) ||
        (res as any)?.schemas?.map((s: any) => s.schemaName || s).filter(Boolean) ||
        [];
      const sorted = preferSortNames(raw, ['cmdata']);
      setSchemas(sorted);
      const defaultSchema =
        sorted.find((s) => s.toLowerCase() === 'cmdata') || sorted[0] || '';
      setSelectedSchema(defaultSchema);
      setDbConnected(true);
      if (defaultSchema) {
        await loadTables(dsId, defaultSchema);
      }
    } catch (err: any) {
      showToast({ message: `连接失败: ${formatRequestError(err, '未知错误')}`, status: 'error' });
      setDbConnected(false);
    } finally {
      setLoadingSchemas(false);
    }
  };

  const loadTables = async (dsId: string, schema: string) => {
    if (!schema) {
      setTables([]);
      setSelectedTable('');
      return;
    }
    setLoadingTables(true);
    setSelectedTable('');
    setColumnCheck(null);
    try {
      const res = await dataService.listDataSourceSchemaTables(dsId, schema);
      if (!res?.success) {
        throw new Error((res as any)?.error || '获取表列表失败');
      }
      const raw = res?.data?.tables || (res as any)?.tables || [];
      const sorted = preferSortNames(raw, ['c_par_brch_level']);
      setTables(sorted);
      const defaultTable =
        sorted.find((t) => t.toLowerCase() === 'c_par_brch_level') || sorted[0] || '';
      setSelectedTable(defaultTable);
      if (defaultTable) {
        await validateTableColumns(dsId, schema, defaultTable);
      }
    } catch (err: any) {
      showToast({ message: `加载表列表失败: ${formatRequestError(err, '未知错误')}`, status: 'error' });
      setTables([]);
      setSelectedTable('');
    } finally {
      setLoadingTables(false);
    }
  };

  const validateTableColumns = async (dsId: string, schema: string, table: string) => {
    if (!dsId || !table) {
      setColumnCheck(null);
      return;
    }
    setValidatingColumns(true);
    setColumnCheck(null);
    try {
      const qualified = qualifiedTable(schema, table);
      const res = await dataService.getDataSourceSchema({
        id: dsId,
        schemaName: schema || undefined,
        tableNames: [table.includes('.') ? table.split('.').pop()! : table],
      });
      if (!res?.success) {
        throw new Error((res as any)?.error || '读取表结构失败');
      }
      const schemaMap = res?.data?.schema || (res as any)?.schema || {};
      const tableKey =
        Object.keys(schemaMap).find(
          (k) =>
            k === table ||
            k.endsWith(`.${table}`) ||
            k.split('.').pop() === table ||
            k.toLowerCase() === table.toLowerCase(),
        ) || Object.keys(schemaMap)[0];
      const colsRaw = tableKey ? schemaMap[tableKey]?.columns || [] : [];
      const columns = colsRaw.map((c: any) => ({
        name: String(c.column_name || c.name || ''),
        type: String(c.data_type || c.type || ''),
      }));
      const colNames = columns.map((c) => c.name.toLowerCase());
      const missing = REQUIRED_ORG_COLUMNS.filter((r) => !colNames.includes(r));
      const valid = missing.length === 0;
      setColumnCheck({
        tableName: qualified,
        columns,
        valid,
        message: valid
          ? `表 ${qualified} 包含 ${columns.length} 列，符合 c_par_brch_level 规范`
          : `表结构不符合 c_par_brch_level 规范，缺少必填列: ${missing.join(', ')}`,
      });
    } catch (err: any) {
      showToast({ message: `校验表结构失败: ${formatRequestError(err, '未知错误')}`, status: 'error' });
      setColumnCheck({
        tableName: qualifiedTable(schema, table),
        columns: [],
        valid: false,
        message: formatRequestError(err, '校验失败'),
      });
    } finally {
      setValidatingColumns(false);
    }
  };

  const handleConnectDb = async () => {
    if (!importDataSourceId) {
      showToast({ message: '请先选择数据源', status: 'warning' });
      return;
    }
    setConnecting(true);
    try {
      await loadSchemas(importDataSourceId);
    } finally {
      setConnecting(false);
    }
  };

  const onImportDsChange = (dsId: string) => {
    setImportDataSourceId(dsId);
    setDbConnected(false);
    setSchemas([]);
    setSelectedSchema('');
    setTables([]);
    setSelectedTable('');
    setColumnCheck(null);
    setImportResult(null);
  };

  const onSchemaChange = async (schema: string) => {
    setSelectedSchema(schema);
    if (importDataSourceId && schema) {
      await loadTables(importDataSourceId, schema);
    }
  };

  const onTableChange = async (table: string) => {
    setSelectedTable(table);
    if (importDataSourceId && table) {
      await validateTableColumns(importDataSourceId, selectedSchema, table);
    } else {
      setColumnCheck(null);
    }
  };

  const importFromTable = async () => {
    if (!importDataSourceId || !selectedTable) {
      showToast({ message: '请选择数据源和表', status: 'warning' });
      return;
    }
    if (!columnCheck?.valid) {
      showToast({ message: '表结构校验未通过，无法导入', status: 'warning' });
      return;
    }
    setImporting(true);
    try {
      const apiBase = getApiBase();
      const tableName = qualifiedTable(selectedSchema, selectedTable);
      const res = await fetch(`${apiBase}/api/org-permission/units/import-table`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dataSourceId: importDataSourceId,
          tableName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
      setImportResult({ imported: json.imported, dataDt: json.dataDt });
      setImportStep('result');
      showToast({
        message: `从表导入成功：${json.imported} 条（原始 ${json.rawCount} 行）`,
        status: 'success',
      });
      await loadAll();
    } catch (error: any) {
      showToast({ message: `导入失败: ${error.message}`, status: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const importFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const apiBase = getApiBase();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${apiBase}/api/org-permission/units/import-excel`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
      showToast({
        message: `Excel 导入成功：${json.imported} 条（原始 ${json.rawCount} 行）`,
        status: 'success',
      });
      await loadAll();
    } catch (error: any) {
      showToast({ message: `Excel 导入失败: ${error.message}`, status: 'error' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="rounded-lg border border-border-light bg-surface-primary p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">机构权限拦截</h3>
            <p className="mt-1 text-xs text-text-secondary">
              开启后，声明了 orgCode 注入的 MCP 工具在调用前会校验机构编码是否在册，并按权限级别
              （全行 / 本级+下级 / 仅本级）确认可访问范围非空。关闭时等同当前软透传，不拦截。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-text-tertiary">{enforcementEnabled ? '已开启' : '已关闭'}</span>
            <Switch
              checked={enforcementEnabled}
              disabled={savingSettings || loading}
              onCheckedChange={saveSettings}
              aria-label="机构权限拦截开关"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-light bg-surface-primary p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">SQL 强制校验/改写</h3>
            <p className="mt-1 text-xs text-text-secondary">
              开启后，Because-jn 的 sql-executor 会按当前用户机构权限（全行 / 本级+下级 / 仅本级）
              校验 SQL 中的 org_code：越权的字面量直接拒绝执行，IN(...) 列表按可访问范围收窄，
              未显式过滤但引用了 org_code 列的查询会自动补上范围限制。关闭时 SQL 原样执行，不做拦截。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-text-tertiary">{sqlEnforcementEnabled ? '已开启' : '已关闭'}</span>
            <Switch
              checked={sqlEnforcementEnabled}
              disabled={savingSqlEnforcement || loading}
              onCheckedChange={saveSqlEnforcement}
              aria-label="SQL 强制校验/改写开关"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder="按机构编码 / 名称过滤..."
            className="w-56 rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400"
          />
        </div>
        <Button size="sm" variant="outline" onClick={applySearch} disabled={loading}>
          检索
        </Button>
        <Select
          value={levelFilter || 'all'}
          onValueChange={(v) => setLevelFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger
            className={cn(
              'h-8 w-[170px] text-xs',
              'border border-gray-300 bg-white text-gray-900',
              'dark:border-gray-600 dark:bg-gray-700 dark:text-white',
            )}
          >
            <SelectValue placeholder="全部层级" />
          </SelectTrigger>
          <SelectContent className="border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
            <SelectItem value="all">全部层级</SelectItem>
            {BRCH_LV_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilter && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearchInput('');
              setActiveSearch('');
              setLevelFilter('');
            }}
          >
            清除筛选
          </Button>
        )}
        <span className="mx-1 hidden h-4 w-px bg-border-light sm:inline-block" />
        <Button size="sm" variant="outline" onClick={() => openCreate()} disabled={loading}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          新增机构
        </Button>
        <Button size="sm" variant="outline" onClick={openTableImport} disabled={loading || importing}>
          <Database className="h-3.5 w-3.5 mr-1" />
          从数据源表导入
        </Button>
        <label className="inline-flex cursor-pointer">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={loading || importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFromExcel(file);
              e.target.value = '';
            }}
          />
          <span
            className={cn(
              'inline-flex items-center rounded-md border border-border-medium bg-surface-primary px-3 py-1.5 text-sm text-text-primary',
              (loading || importing) && 'opacity-50 pointer-events-none',
            )}
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            Excel 导入
          </span>
        </label>
        <Button size="sm" variant="outline" onClick={loadAll} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} />
          刷新
        </Button>
        <Button size="sm" variant="destructive" onClick={clearAll} disabled={loading || unitCount === 0}>
          清空
        </Button>
        <span className="text-xs text-text-tertiary ml-auto">
          共 {unitCount} 个机构
          {hasActiveFilter ? ` · 命中 ${matchCount} 个` : ''}
        </span>
      </div>

      <div className="text-[11px] text-text-tertiary">
        从表导入：先选 JN 数据源并「连接数据库」加载 schema（优先 cmdata）与表（优先 c_par_brch_level），再按 DAT
        规范校验必填列后覆盖导入。Excel 为兜底。行内可直接改权限级别；增删改按钮紧跟机构名称。
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border-light bg-surface-primary p-2">
        {loading ? (
          <div className="text-sm text-text-secondary p-2">加载中…</div>
        ) : filteredTree.length === 0 && tree.length > 0 && hasActiveFilter ? (
          <div className="text-sm text-text-secondary p-2">无匹配机构</div>
        ) : tree.length === 0 ? (
          <div className="text-sm text-text-secondary p-2">暂无机构，请手动新增或导入。</div>
        ) : (
          <ul className="flex flex-col gap-px">
            {filteredTree.map((node) => (
              <OrgTreeNodeView
                key={node.orgCode}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={onToggle}
                highlightQuery={activeSearch}
                onUpdateBrchLv={handleUpdateBrchLv}
                onAddChild={openCreate}
                onEdit={openEdit}
                onDelete={deleteUnit}
              />
            ))}
          </ul>
        )}
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border-light bg-surface-primary p-4 shadow-xl">
            <h4 className="mb-3 text-sm font-semibold text-text-primary">
              {editing ? '编辑机构' : '新增机构'}
            </h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-secondary">机构编码 *</label>
                <input
                  className={cn(FIELD_CLASS, editing && 'opacity-70')}
                  value={form.orgCode}
                  disabled={Boolean(editing)}
                  onChange={(e) => setForm((f) => ({ ...f, orgCode: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary">机构名称</label>
                <input
                  className={FIELD_CLASS}
                  value={form.orgName}
                  onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary">上级机构编码</label>
                <input
                  className={FIELD_CLASS}
                  value={form.parentOrgCode}
                  onChange={(e) => setForm((f) => ({ ...f, parentOrgCode: e.target.value }))}
                  placeholder="根节点留空"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary">权限级别 brchLv</label>
                <select
                  className={FIELD_CLASS}
                  value={form.brchLv}
                  onChange={(e) => setForm((f) => ({ ...f, brchLv: e.target.value }))}
                >
                  <option value="">选择级别</option>
                  {BRCH_LV_OPTIONS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-text-tertiary">权限含义：{derivedScopeLabel}</div>
              </div>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                启用
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={saveUnit}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {tableImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-border-light bg-surface-primary shadow-xl">
            <div className="flex items-center justify-between border-b border-border-light p-4">
              <h4 className="text-sm font-semibold text-text-primary">从数据源表导入机构</h4>
              <button
                type="button"
                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                onClick={() => {
                  setTableImportOpen(false);
                  resetImportModal();
                }}
              >
                ✕
              </button>
            </div>

            <div className="flex items-center border-b border-border-light px-4 py-3">
              {[
                { key: 'datasource', label: '选择数据源并连接', step: 0 },
                { key: 'table', label: '选择表并校验', step: 1 },
                { key: 'result', label: '导入完成', step: 2 },
              ].map((s) => {
                const currentStep =
                  importStep === 'datasource' ? 0 : importStep === 'table' ? 1 : 2;
                return (
                  <div key={s.key} className="flex items-center">
                    <div
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                        s.step < currentStep
                          ? 'bg-green-500 text-white'
                          : s.step === currentStep
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
                      )}
                    >
                      {s.step < currentStep ? '✓' : s.step + 1}
                    </div>
                    <span
                      className={cn(
                        'ml-2 text-xs',
                        s.step === currentStep ? 'font-medium text-text-primary' : 'text-text-tertiary',
                      )}
                    >
                      {s.label}
                    </span>
                    {s.step < 2 && <div className="mx-2 h-px w-8 bg-border-light" />}
                  </div>
                );
              })}
            </div>

            {importStep === 'datasource' && (
              <div className="space-y-3 p-4">
                <div>
                  <label className="text-xs text-text-secondary">JN 数据源</label>
                  <select
                    className={FIELD_CLASS}
                    value={importDataSourceId}
                    onChange={(e) => onImportDsChange(e.target.value)}
                  >
                    <option value="">请选择数据源</option>
                    {dataSources.map((ds) => (
                      <option key={ds._id} value={ds._id}>
                        {ds.name} ({ds.type || '-'})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleConnectDb}
                    disabled={!importDataSourceId || connecting || loadingSchemas || loadingTables}
                  >
                    {connecting || loadingSchemas || loadingTables ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="mr-1 h-3.5 w-3.5" />
                    )}
                    {connecting || loadingSchemas || loadingTables
                      ? '连接中…'
                      : dbConnected
                        ? '重新连接'
                        : '连接数据库'}
                  </Button>
                  {dbConnected && (
                    <span className="text-xs text-green-500">
                      已连接 · schema {schemas.length} 个
                      {selectedSchema ? ` · 当前 ${selectedSchema}` : ''}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary">
                  点击「连接数据库」后会拉取 schema（优先 cmdata）与表列表，再进入选表校验。
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTableImportOpen(false);
                      resetImportModal();
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setImportStep('table')}
                    disabled={!dbConnected || (!selectedSchema && schemas.length > 0)}
                  >
                    下一步
                  </Button>
                </div>
              </div>
            )}

            {importStep === 'table' && (
              <div className="space-y-3 p-4">
                {loadingSchemas || loadingTables || validatingColumns ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在加载…
                  </div>
                ) : (
                  <>
                    {schemas.length > 0 && (
                      <div>
                        <label className="text-xs text-text-secondary">数据库 Schema</label>
                        <select
                          className={FIELD_CLASS}
                          value={selectedSchema}
                          onChange={(e) => onSchemaChange(e.target.value)}
                        >
                          <option value="">请选择 Schema</option>
                          {schemas.map((schema) => (
                            <option key={schema} value={schema}>
                              {schema}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-text-secondary">表</label>
                      <select
                        className={FIELD_CLASS}
                        value={selectedTable}
                        onChange={(e) => onTableChange(e.target.value)}
                        disabled={schemas.length > 0 && !selectedSchema}
                      >
                        <option value="">请选择表（如 c_par_brch_level）</option>
                        {tables.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {columnCheck && (
                  <div>
                    <div
                      className={cn(
                        'rounded-md p-3 text-sm',
                        columnCheck.valid
                          ? 'border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
                      )}
                    >
                      <p className="font-medium">
                        {columnCheck.valid ? 'Schema 校验通过' : 'Schema 校验失败'}
                      </p>
                      <p className="mt-1 text-xs opacity-80">{columnCheck.message}</p>
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">
                      必填列: data_dt / brchno / brchna / brchup / brchlv
                    </p>
                    {columnCheck.columns.length > 0 && (
                      <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                        {columnCheck.columns.map((c) => (
                          <span
                            key={c.name}
                            className="inline-flex items-center rounded bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary"
                          >
                            {c.name}{' '}
                            <span className="ml-1 text-text-tertiary">({c.type})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setImportStep('datasource')}>
                    上一步
                  </Button>
                  <Button
                    size="sm"
                    onClick={importFromTable}
                    disabled={!columnCheck?.valid || importing}
                  >
                    {importing ? '导入中…' : '开始导入'}
                  </Button>
                </div>
              </div>
            )}

            {importStep === 'result' && importResult && (
              <div className="space-y-4 p-4">
                <div className="flex flex-col items-center py-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-green-500">
                    ✓
                  </div>
                  <p className="mt-2 text-sm font-medium text-text-primary">导入成功</p>
                  <p className="text-xs text-text-tertiary">已覆盖写入平台机构权限清单</p>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-md border border-border-light bg-surface-secondary/40 p-3 text-sm">
                  <div>
                    <span className="text-text-tertiary">导入节点数：</span>
                    <span className="font-semibold text-green-500">{importResult.imported}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">数据日期 (dataDt)：</span>
                    <span className="font-mono text-text-primary">{importResult.dataDt || '-'}</span>
                  </div>
                </div>
                <div className="text-center">
                  <Button
                    size="sm"
                    onClick={() => {
                      setTableImportOpen(false);
                      resetImportModal();
                    }}
                  >
                    关闭
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
