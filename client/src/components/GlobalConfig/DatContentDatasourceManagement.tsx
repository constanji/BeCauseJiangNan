import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Button, useToastContext } from "@because/client";
import { useAuthContext } from "~/hooks";
import { useListAgentsQuery } from "~/data-provider";
import { useListDataSourcesQuery } from "~/data-provider/DataSources";
import { PermissionBits } from "@because/data-provider";
import type { DataSource } from "@because/data-provider";
import { cn } from "~/utils";
import { getDatApiBaseUrl } from "~/utils/datApi";
import {
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Database,
  X,
  CheckCircle,
  XCircle,
  ChevronDown,
  Check,
  Eye,
  Rocket,
  Layers,
  Search,
  FileText,
  Trash,
  Info,
  Sparkles,
  Star,
} from "lucide-react";

interface DatProject {
  _id: string;
  name: string;
}

interface DatDatasource {
  _id: string;
  projectId: string;
  name: string;
  description?: string;
  provider: string;
  configuration: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    [key: string]: any;
  };
  agentNames: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DatGlobalConfig {
  default_project_id?: string | null;
  default_datasource_id?: string | null;
}

interface LightSchemaColumn {
  name: string;
  type: string;
  description?: string;
  sampleValues?: string[];
}

interface LightSchemaForeignKey {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

interface LightSchema {
  tableName: string;
  tableDescription?: string;
  columns: LightSchemaColumn[];
  primaryKeys?: string[];
  foreignKeys?: LightSchemaForeignKey[];
  indices?: string[];
}

interface DatasourcePrompt {
  _id: string;
  datasourceId: string;
  projectId: string;
  label: string;
  description?: string;
  content: string;
  icon?: string;
  iconColor?: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const FIELD_CLASS =
  "w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** 平台数据源 type → DAT provider（DAT 无 gaussdb 适配器时回落到 postgresql） */
const mapPlatformTypeToProvider = (type?: string): string => {
  if (type === "mysql") return "mysql";
  if (type === "postgresql" || type === "gaussdb") return "postgresql";
  return "mysql";
};

const defaultPortForProvider = (provider: string): number =>
  provider === "postgresql" ? 5432 : 3306;

const getDefaultDatasource = (
  projectId = "",
): Omit<DatDatasource, "_id" | "createdAt" | "updatedAt"> => ({
  projectId,
  name: "",
  description: "",
  provider: "mysql",
  configuration: {
    host: "localhost",
    port: 3306,
    database: "",
    username: "",
    password: "",
  },
  agentNames: [],
  enabled: true,
});

const PROVIDER_OPTIONS = [
  { label: "MySQL", value: "mysql" },
  { label: "PostgreSQL", value: "postgresql" },
];

export default function DatasourceManagement() {
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const [datasources, setDatasources] = useState<DatDatasource[]>([]);
  const [projects, setProjects] = useState<DatProject[]>([]);
  const [defaultDatasourceId, setDefaultDatasourceId] = useState<string | null>(
    null,
  );
  const [isSettingDefaultId, setIsSettingDefaultId] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [editingDatasource, setEditingDatasource] =
    useState<Partial<DatDatasource> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedPlatformDsId, setSelectedPlatformDsId] = useState("");
  const [isApplyingPlatformDs, setIsApplyingPlatformDs] = useState(false);

  // Multi-select state
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch Agents using the hook
  const { data: agentsData } = useListAgentsQuery({
    requiredPermission: PermissionBits.VIEW,
  });

  const agents = useMemo(() => agentsData?.data || [], [agentsData]);

  // 平台已配置的数据源（全局配置 → 数据源管理）
  const { data: platformDsResponse } = useListDataSourcesQuery();
  const platformDataSources = useMemo(
    () =>
      (platformDsResponse?.data || []).filter(
        (ds) => !ds.status || ds.status === "active",
      ),
    [platformDsResponse],
  );

  // Datasource detail view state
  const [viewingDatasource, setViewingDatasource] =
    useState<DatDatasource | null>(null);
  const [schemas, setSchemas] = useState<LightSchema[]>([]);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(
    null,
  );
  const [tableSearch, setTableSearch] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<"schema" | "overview" | "prompts" | "pdfs">(
    "schema",
  );

  // ====== Table Selection Modal State ======
  const [tableSelectMode, setTableSelectMode] = useState<"schema" | "cells">("schema");
  const [tableSelectVisible, setTableSelectVisible] = useState(false);
  const [tableSelectLoading, setTableSelectLoading] = useState(false);
  const [allTables, setAllTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [tableSelectSearch, setTableSelectSearch] = useState("");
  const [cellGeneratedTables, setCellGeneratedTables] = useState<Set<string>>(new Set());

  // DB schema/namespace state for multi-schema datasources
  const [dbSchemas, setDbSchemas] = useState<string[]>([]);
  const [selectedDbSchema, setSelectedDbSchema] = useState<string | null>(null);

  const generatedTableNames = useMemo(() => {
    return new Set(schemas.map((s) => s.tableName));
  }, [schemas]);

  const activeGeneratedSet = useMemo(() => {
    return tableSelectMode === "cells" ? cellGeneratedTables : generatedTableNames;
  }, [tableSelectMode, cellGeneratedTables, generatedTableNames]);

  const shouldQualifyTables = useMemo(() => dbSchemas.length > 1, [dbSchemas]);

  const qualifyTable = useCallback(
    (tableName: string, schema?: string | null) => {
      if (!shouldQualifyTables) return tableName;
      const effectiveSchema = schema ?? selectedDbSchema;
      return effectiveSchema ? `${effectiveSchema}.${tableName}` : tableName;
    },
    [shouldQualifyTables, selectedDbSchema]
  );

  const filteredAllTables = useMemo(() => {
    if (!tableSelectSearch) return allTables;
    const kw = tableSelectSearch.toLowerCase();
    return allTables.filter((t) => t.toLowerCase().includes(kw));
  }, [allTables, tableSelectSearch]);

  const allSelectedInFilter = useMemo(() => {
    if (filteredAllTables.length === 0) return false;
    return filteredAllTables.every((t) =>
      selectedTables.includes(qualifyTable(t))
    );
  }, [filteredAllTables, selectedTables, qualifyTable]);

  const indeterminateInFilter = useMemo(() => {
    const matched = filteredAllTables.filter((t) =>
      selectedTables.includes(qualifyTable(t))
    );
    return matched.length > 0 && matched.length < filteredAllTables.length;
  }, [filteredAllTables, selectedTables, qualifyTable]);

  const toggleSelectAllFiltered = useCallback(
    (checked: boolean) => {
      if (checked) {
        const merged = new Set([
          ...selectedTables,
          ...filteredAllTables.map((t) => qualifyTable(t)),
        ]);
        setSelectedTables(Array.from(merged));
      } else {
        const qualifiedFiltered = new Set(filteredAllTables.map((t) => qualifyTable(t)));
        setSelectedTables(selectedTables.filter((t) => !qualifiedFiltered.has(t)));
      }
    },
    [selectedTables, filteredAllTables, qualifyTable]
  );

  const toggleTableSelection = useCallback(
    (tableName: string) => {
      const qualified = qualifyTable(tableName);
      setSelectedTables((prev) => {
        if (prev.includes(qualified)) {
          return prev.filter((t) => t !== qualified);
        } else {
          return [...prev, qualified];
        }
      });
    },
    [qualifyTable]
  );

  // Prompts management state
  const [prompts, setPrompts] = useState<DatasourcePrompt[]>([]);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Partial<DatasourcePrompt> | null>(null);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Filtered schemas based on search
  const filteredSchemas = useMemo(() => {
    if (!tableSearch) return schemas;
    return schemas.filter(
      (s) =>
        s.tableName.toLowerCase().includes(tableSearch.toLowerCase()) ||
        (s.tableDescription &&
          s.tableDescription.toLowerCase().includes(tableSearch.toLowerCase())),
    );
  }, [schemas, tableSearch]);

  // Selected schema
  const selectedSchema = useMemo(() => {
    return schemas.find((s) => s.tableName === selectedTableName);
  }, [schemas, selectedTableName]);

  const getApiBase = useCallback(() => {
    const baseEl = document.querySelector("base");
    const baseHref = baseEl?.getAttribute("href") || "/";
    return baseHref.endsWith("/") ? baseHref.slice(0, -1) : baseHref;
  }, []);

  const getHeaders = useCallback((): HeadersInit => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/dat-projects`, {
        method: "GET",
        headers: getHeaders(),
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
    }
  }, [getApiBase, getHeaders]);

  const fetchGlobalConfig = useCallback(async () => {
    try {
      const response = await fetch(`${getDatApiBaseUrl()}/api/v1/config/global`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "获取默认配置失败");
      }
      const data: DatGlobalConfig = await response.json();
      setDefaultDatasourceId(data.default_datasource_id || null);
    } catch (error) {
      console.warn("Error fetching global config:", error);
    }
  }, []);

  const fetchDatasources = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${getApiBase()}/api/dat-datasources`, {
        method: "GET",
        headers: getHeaders(),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "获取数据源列表失败" }));
        throw new Error(error.error || "获取数据源列表失败");
      }

      const data = await response.json();
      setDatasources(data.datasources || []);
    } catch (error) {
      console.error("Error fetching datasources:", error);
      showToast({
        message: `获取数据源列表失败: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [getApiBase, getHeaders, showToast]);

  useEffect(() => {
    fetchProjects();
    fetchDatasources();
    fetchGlobalConfig();
  }, [fetchProjects, fetchDatasources, fetchGlobalConfig]);

  // ============ DAT API Functions ============

  // Fetch Light Schemas for a datasource
  const fetchLightSchemas = useCallback(
    async (projectId: string, datasourceId: string) => {
      try {
        setIsLoadingSchema(true);
        const response = await fetch(
          `${getDatApiBaseUrl()}/api/v1/content-store/light-schema/list?projectId=${projectId}&datasourceId=${datasourceId}`,
        );
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setSchemas(data || []);
        if (data && data.length > 0 && !selectedTableName) {
          setSelectedTableName(data[0].tableName);
        }
      } catch (error) {
        console.error("Failed to load schemas:", error);
        setSchemas([]);
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [selectedTableName],
  );

  // ====== Table Selection Dialog Logic ======
  const loadTablesForSelectedSchema = useCallback(
    async (schemaArg: string | null) => {
      if (!viewingDatasource?.projectId) return;
      setTableSelectLoading(true);
      try {
        let url = `${getDatApiBaseUrl()}/api/v1/content-store/datasource/tables?projectId=${viewingDatasource.projectId}&datasourceId=${viewingDatasource._id}`;
        if (schemaArg) {
          url += `&schema=${encodeURIComponent(schemaArg)}`;
        }
        const tablesRes = await fetch(url);
        if (!tablesRes.ok) {
          throw new Error(`获取数据表失败 status: ${tablesRes.status}`);
        }
        const tables: string[] = await tablesRes.json();
        setAllTables(tables || []);

        const already =
          tableSelectMode === "cells" ? cellGeneratedTables : generatedTableNames;
        const qualified = (tables || []).map((t) => qualifyTable(t, schemaArg));
        const remaining = qualified.filter((q) => !already.has(q));
        setSelectedTables((prev) => {
          const others = prev.filter((p) => !qualified.includes(p));
          return [...others, ...(remaining.length > 0 ? remaining : qualified)];
        });
      } catch (error) {
        showToast({
          message: `加载表列表失败: ${error instanceof Error ? error.message : "未知错误"}`,
          status: "error",
        });
        setAllTables([]);
      } finally {
        setTableSelectLoading(false);
      }
    },
    [viewingDatasource, tableSelectMode, cellGeneratedTables, generatedTableNames, qualifyTable, showToast]
  );

  const onDbSchemaChange = useCallback(
    (schema: string) => {
      setSelectedDbSchema(schema || null);
      setAllTables([]);
      setSelectedTables([]);
      if (schema) {
        loadTablesForSelectedSchema(schema);
      }
    },
    [loadTablesForSelectedSchema]
  );

  const openTableSelector = useCallback(
    async (mode: "schema" | "cells") => {
      if (!viewingDatasource?.projectId) {
        showToast({ message: "数据源尚未关联项目", status: "warning" });
        return;
      }
      setTableSelectMode(mode);
      setTableSelectVisible(true);
      setTableSelectSearch("");
      setDbSchemas([]);
      setSelectedDbSchema(null);
      setTableSelectLoading(true);

      try {
        const schemasRes = await fetch(
          `${getDatApiBaseUrl()}/api/v1/content-store/datasource/schemas?projectId=${viewingDatasource.projectId}&datasourceId=${viewingDatasource._id}`
        );
        if (!schemasRes.ok) {
          throw new Error(`获取 Schema 列表失败 status: ${schemasRes.status}`);
        }
        const schemasList: string[] = await schemasRes.json();
        setDbSchemas(schemasList || []);

        if (mode === "cells") {
          try {
            const cellTabsRes = await fetch(
              `${getDatApiBaseUrl()}/api/v1/content-store/cells/tables?projectId=${viewingDatasource.projectId}&datasourceId=${viewingDatasource._id}`
            );
            if (cellTabsRes.ok) {
              const cellTabs: string[] = await cellTabsRes.json();
              setCellGeneratedTables(new Set(cellTabs || []));
            } else {
              setCellGeneratedTables(new Set());
            }
          } catch (e) {
            setCellGeneratedTables(new Set());
            console.warn("Failed to load cell tables:", e);
          }
        }

        if (!schemasList || schemasList.length === 0) {
          await loadTablesForSelectedSchema(null);
        } else if (schemasList.length === 1) {
          const onlySchema = schemasList[0];
          setSelectedDbSchema(onlySchema);
          await loadTablesForSelectedSchema(onlySchema);
        } else {
          // multiple schemas: wait for user selection
          setAllTables([]);
          setSelectedTables([]);
          setTableSelectLoading(false);
        }
      } catch (error) {
        showToast({
          message: `加载 Schema 列表失败: ${error instanceof Error ? error.message : "未知错误"}`,
          status: "error",
        });
        setTableSelectVisible(false);
      } finally {
        // tableSelectLoading is already managed by loadTablesForSelectedSchema or set to false above
      }
    },
    [viewingDatasource, loadTablesForSelectedSchema, showToast]
  );

  const handleGenerateSchema = useCallback(() => {
    openTableSelector("schema");
  }, [openTableSelector]);

  const handleVectorizeCells = useCallback(() => {
    openTableSelector("cells");
  }, [openTableSelector]);

  const confirmTableSelection = useCallback(async () => {
    if (!viewingDatasource) return;
    if (selectedTables.length === 0) {
      showToast({ message: "请至少选择一张表", status: "warning" });
      return;
    }

    const projectId = viewingDatasource.projectId;
    const datasourceId = viewingDatasource._id;
    const qualifiedAllTables = allTables.map((t) => qualifyTable(t));
    const isAll = selectedTables.length === qualifiedAllTables.length;
    const payloadTables = isAll ? null : [...selectedTables];

    setIsProcessing(true);
    try {
      if (tableSelectMode === "schema") {
        const response = await fetch(
          `${getDatApiBaseUrl()}/api/v1/content-store/light-schema/generate?projectId=${projectId}&datasourceId=${datasourceId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              concurrencyLimit: 5,
              tableNames: payloadTables,
              runInSeparateTask: true,
            }),
          }
        );
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `HTTP error! status: ${response.status}`);
        }
        const result = await response.text();
        showToast({
          message: result || "生成 Light Schema 成功",
          status: "success",
        });
        await fetchLightSchemas(projectId, datasourceId);
      } else {
        const response = await fetch(
          `${getDatApiBaseUrl()}/api/v1/content-store/cells/vectorize?projectId=${projectId}&datasourceId=${datasourceId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              batchSize: 100,
              tableNames: payloadTables,
            }),
          }
        );
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `HTTP error! status: ${response.status}`);
        }
        const result = await response.text();
        showToast({
          message: result || "向量化单元格成功",
          status: "success",
        });
      }
      setTableSelectVisible(false);
    } catch (error) {
      showToast({
        message: `${tableSelectMode === "schema" ? "生成 Light Schema 失败" : "向量化失败"}: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [
    viewingDatasource,
    selectedTables,
    allTables,
    tableSelectMode,
    fetchLightSchemas,
    showToast,
  ]);

  // Clear Preprocessing Data
  const handleClearPreprocessing = useCallback(async () => {
    if (!viewingDatasource?.projectId) return;
    if (!confirm("确定要清空所有预处理数据吗？此操作不可恢复！")) return;

    try {
      const response = await fetch(
        `${getDatApiBaseUrl()}/api/v1/content-store/preprocessing/clear?projectId=${viewingDatasource.projectId}&datasourceId=${viewingDatasource._id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP error! status: ${response.status}`);
      }
      const result = await response.text();
      showToast({ message: result || "清空预处理数据成功", status: "success" });
      setSchemas([]);
      setSelectedTableName(null);

      // 清除缓存
      if (viewingDatasource._id) {
        localStorage.removeItem(`DAT_LIGHT_SCHEMA_${viewingDatasource._id}`);
      }
    } catch (error) {
      showToast({
        message: `清空失败: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    }
  }, [viewingDatasource, showToast]);

  // ============ Prompts Management Functions ============

  // Fetch prompts for a datasource
  const fetchPrompts = useCallback(
    async (datasourceId: string) => {
      setIsLoadingPrompts(true);
      try {
        const response = await fetch(
          `${getApiBase()}/api/datasource-prompts?datasourceId=${datasourceId}&includeDisabled=true`,
          {
            method: "GET",
            headers: getHeaders(),
            credentials: "include",
          }
        );
        if (response.ok) {
          const data = await response.json();
          setPrompts(data.prompts || []);
        } else {
          setPrompts([]);
        }
      } catch (error) {
        console.error("Error fetching prompts:", error);
        setPrompts([]);
      } finally {
        setIsLoadingPrompts(false);
      }
    },
    [getApiBase, getHeaders]
  );

  // Save prompt (create or update)
  const savePrompt = useCallback(async () => {
    if (!editingPrompt || !viewingDatasource) return;

    if (!editingPrompt.content?.trim()) {
      showToast({ message: "请填写提示内容", status: "error" });
      return;
    }

    // Auto-fill label from content since the UI no longer requests a manual title.
    const autoLabel = editingPrompt.content.slice(0, 50) + (editingPrompt.content.length > 50 ? '...' : '');
    const modifiedPromptForSave = {
      ...editingPrompt,
      label: autoLabel,
      icon: "BulbOutlined", // Default generic icon just in case DB schema requires it
      iconColor: "#1890FF"
    };

    setIsSavingPrompt(true);
    try {
      const isEdit = !!(editingPrompt as DatasourcePrompt)._id;
      const url = isEdit
        ? `${getApiBase()}/api/datasource-prompts/${(editingPrompt as DatasourcePrompt)._id}`
        : `${getApiBase()}/api/datasource-prompts`;

      const body = {
        ...modifiedPromptForSave,
        datasourceId: viewingDatasource._id,
        projectId: viewingDatasource.projectId,
      };

      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: getHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "保存失败" }));
        throw new Error(error.error || "保存失败");
      }

      showToast({
        message: isEdit ? "提示词更新成功" : "提示词创建成功",
        status: "success",
      });

      setEditingPrompt(null);
      fetchPrompts(viewingDatasource._id);
    } catch (error) {
      console.error("Error saving prompt:", error);
      showToast({
        message: `保存失败: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    } finally {
      setIsSavingPrompt(false);
    }
  }, [editingPrompt, viewingDatasource, getApiBase, getHeaders, showToast, fetchPrompts]);

  // Delete prompt
  const deletePrompt = useCallback(
    async (promptId: string) => {
      if (!viewingDatasource) return;
      if (!confirm("确定要删除这个提示词吗？")) return;

      try {
        const response = await fetch(
          `${getApiBase()}/api/datasource-prompts/${promptId}`,
          {
            method: "DELETE",
            headers: getHeaders(),
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error("删除失败");
        }

        showToast({ message: "提示词删除成功", status: "success" });
        fetchPrompts(viewingDatasource._id);
      } catch (error) {
        console.error("Error deleting prompt:", error);
        showToast({
          message: `删除失败: ${error instanceof Error ? error.message : "未知错误"}`,
          status: "error",
        });
      }
    },
    [viewingDatasource, getApiBase, getHeaders, showToast, fetchPrompts]
  );

  // Open datasource detail view
  const openDatasourceDetail = useCallback(
    (ds: DatDatasource) => {
      setViewingDatasource(ds);
      setActiveDetailTab("schema");
      setSchemas([]);
      setSelectedTableName(null);
      setTableSearch("");
      setPrompts([]);
      setEditingPrompt(null);
      if (ds.projectId) {
        fetchLightSchemas(ds.projectId, ds._id);
      }
      fetchPrompts(ds._id);
    },
    [fetchLightSchemas, fetchPrompts],
  );

  // Close datasource detail view
  const closeDatasourceDetail = useCallback(() => {
    setViewingDatasource(null);
    setSchemas([]);
    setSelectedTableName(null);
    setTableSearch("");
    setPrompts([]);
    setEditingPrompt(null);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        agentDropdownRef.current &&
        !agentDropdownRef.current.contains(event.target as Node)
      ) {
        setIsAgentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const saveDatasource = async () => {
    if (!editingDatasource) return;

    if (!editingDatasource.projectId) {
      showToast({ message: "请选择所属项目", status: "error" });
      return;
    }
    if (!editingDatasource.name?.trim()) {
      showToast({ message: "请输入数据源名称", status: "error" });
      return;
    }

    setIsSaving(true);
    try {
      const isEdit = !!(editingDatasource as DatDatasource)._id;
      const url = isEdit
        ? `${getApiBase()}/api/dat-datasources/${(editingDatasource as DatDatasource)._id}`
        : `${getApiBase()}/api/dat-datasources`;

      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: getHeaders(),
        credentials: "include",
        body: JSON.stringify(editingDatasource),
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "保存失败" }));
        throw new Error(error.error || "保存失败");
      }

      showToast({
        message: isEdit ? "数据源更新成功" : "数据源创建成功",
        status: "success",
      });

      setEditingDatasource(null);
      fetchDatasources();
    } catch (error) {
      console.error("Error saving datasource:", error);
      showToast({
        message: `保存失败: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDatasource = async (datasource: DatDatasource) => {
    if (
      !confirm(
        `确定要删除数据源 "${datasource.name}" 吗？此操作将同时删除关联的语义模型。`,
      )
    ) {
      return;
    }

    setDeletingId(datasource._id);
    try {
      const response = await fetch(
        `${getApiBase()}/api/dat-datasources/${datasource._id}`,
        {
          method: "DELETE",
          headers: getHeaders(),
          credentials: "include",
        },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "删除失败" }));
        throw new Error(error.error || "删除失败");
      }

      showToast({ message: "数据源删除成功", status: "success" });
      setDatasources((prev) => prev.filter((p) => p._id !== datasource._id));
      if (defaultDatasourceId === datasource._id) {
        setDefaultDatasourceId(null);
      }
    } catch (error) {
      console.error("Error deleting datasource:", error);
      showToast({
        message: `删除失败: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const setDefaultDatasource = useCallback(
    async (datasource: DatDatasource) => {
      const projectIdToSet = datasource.projectId;
      if (!projectIdToSet) {
        showToast({ message: "无法获取项目ID，请确保数据源关联了项目", status: "error" });
        return;
      }

      setIsSettingDefaultId(datasource._id);
      try {
        const response = await fetch(`${getDatApiBaseUrl()}/api/v1/config/global`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            default_project_id: projectIdToSet,
            default_datasource_id: datasource._id,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "设置默认数据源失败");
        }

        setDefaultDatasourceId(datasource._id);
        showToast({
          message: `已将 "${datasource.name}" 设为默认数据源`,
          status: "success",
        });
      } catch (error) {
        console.error("Error setting default datasource:", error);
        showToast({
          message: `设置默认数据源失败: ${error instanceof Error ? error.message : "未知错误"}`,
          status: "error",
        });
      } finally {
        setIsSettingDefaultId(null);
      }
    },
    [showToast],
  );

  const updateEditing = (key: keyof DatDatasource, value: any) => {
    setEditingDatasource((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateConfig = (key: string, value: any) => {
    setEditingDatasource((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        configuration: {
          ...prev.configuration,
          [key]: value,
        },
      };
    });
  };

  const applyPlatformDataSource = async (platformId: string) => {
    setSelectedPlatformDsId(platformId);
    if (!platformId) return;

    const listed = platformDataSources.find((d) => d._id === platformId);
    setIsApplyingPlatformDs(true);
    try {
      const response = await fetch(
        `${getApiBase()}/api/config/data-sources/${platformId}?includePassword=true`,
        {
          method: "GET",
          headers: getHeaders(),
          credentials: "include",
        },
      );
      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "获取平台数据源失败" }));
        throw new Error(error.error || "获取平台数据源失败");
      }
      const payload = await response.json();
      const ds: DataSource & { password?: string } = payload.data || listed;
      if (!ds) throw new Error("平台数据源不存在");

      const provider = mapPlatformTypeToProvider(ds.type);
      setEditingDatasource((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          name: prev.name?.trim() ? prev.name : ds.name || prev.name,
          provider,
          configuration: {
            ...prev.configuration,
            host: ds.host || "",
            port: ds.port || defaultPortForProvider(provider),
            database: ds.database || "",
            username: ds.username || "",
            password: ds.password || "",
          },
        };
      });

      if (ds.type === "gaussdb") {
        showToast({
          message:
            "已填入连接信息。GaussDB 已映射为 PostgreSQL 驱动，请确认 DAT 侧可连通。",
          status: "warning",
        });
      } else if (!ds.password) {
        showToast({
          message: "已填入连接信息，但未能取得密码，请手动填写。",
          status: "warning",
        });
      } else {
        showToast({ message: "已从平台数据源填入连接配置", status: "success" });
      }
    } catch (error) {
      showToast({
        message: `回填失败: ${error instanceof Error ? error.message : "未知错误"}`,
        status: "error",
      });
    } finally {
      setIsApplyingPlatformDs(false);
    }
  };

  const toggleAgentSelection = async (agentName: string) => {
    if (!editingDatasource) return;

    const currentAgents = editingDatasource.agentNames || [];

    // If already selected, just remove it from current datasource
    if (currentAgents.includes(agentName)) {
      setEditingDatasource((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          agentNames: currentAgents.filter((n) => n !== agentName),
        };
      });
      return;
    }

    // Check if this agent is already bound to another datasource
    const currentDatasourceId = (editingDatasource as DatDatasource)._id;
    const boundDatasource = datasources.find(
      (ds) =>
        ds._id !== currentDatasourceId && ds.agentNames?.includes(agentName),
    );

    if (boundDatasource) {
      // Agent is already bound to another datasource, need to unbind first
      const confirmUnbind = confirm(
        `智能体 "${agentName}" 已绑定到数据源 "${boundDatasource.name}"。是否解除原有绑定并绑定到当前数据源？`,
      );

      if (!confirmUnbind) {
        return;
      }

      // Remove agent from the other datasource
      try {
        const updatedOtherDatasource = {
          ...boundDatasource,
          agentNames: boundDatasource.agentNames.filter((n) => n !== agentName),
        };

        const response = await fetch(
          `${getApiBase()}/api/dat-datasources/${boundDatasource._id}`,
          {
            method: "PUT",
            headers: getHeaders(),
            credentials: "include",
            body: JSON.stringify(updatedOtherDatasource),
          },
        );

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "解除绑定失败" }));
          throw new Error(error.error || "解除绑定失败");
        }

        // Update local datasources state
        setDatasources((prev) =>
          prev.map((ds) =>
            ds._id === boundDatasource._id
              ? {
                ...ds,
                agentNames: ds.agentNames.filter((n) => n !== agentName),
              }
              : ds,
          ),
        );

        showToast({
          message: `已从数据源 "${boundDatasource.name}" 解除智能体 "${agentName}" 的绑定`,
          status: "success",
        });
      } catch (error) {
        console.error("Error unbinding agent:", error);
        showToast({
          message: `解除绑定失败: ${error instanceof Error ? error.message : "未知错误"}`,
          status: "error",
        });
        return;
      }
    }

    // Add agent to current datasource
    setEditingDatasource((prev) => {
      if (!prev) return prev;
      return { ...prev, agentNames: [...(prev.agentNames || []), agentName] };
    });
  };

  const getProjectName = (projectId: string) => {
    const project = projects.find((p) => p._id === projectId);
    return project ? project.name : projectId;
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            数据源管理
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            管理数据库连接配置,并绑定到智能体
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={fetchDatasources}
            disabled={isLoading}
            className="btn btn-neutral border-token-border-light relative flex items-center gap-2 rounded-lg px-3 py-2"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            {isLoading ? "加载中..." : "刷新"}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setSelectedPlatformDsId("");
              setEditingDatasource(getDefaultDatasource());
            }}
            className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
          >
            <Plus className="h-4 w-4" />
            添加数据源
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-text-secondary">
            <p className="text-sm">加载中...</p>
          </div>
        ) : datasources.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
            <Database className="h-8 w-8" />
            <p className="text-sm">暂无数据源</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {datasources.map((ds) => (
              <div
                key={ds._id}
                className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded p-2 bg-surface-secondary text-blue-600">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-medium text-text-primary">
                        {ds.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
                          {getProjectName(ds.projectId)}
                        </span>
                        <span>{ds.provider}</span>
                        {defaultDatasourceId === ds._id && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                            <Star className="h-3 w-3 fill-current" />
                            默认
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDefaultDatasource(ds)}
                      disabled={defaultDatasourceId === ds._id || isSettingDefaultId === ds._id}
                      className={cn(
                        "rounded p-1.5 hover:bg-surface-hover",
                        defaultDatasourceId === ds._id
                          ? "text-yellow-500"
                          : "text-text-secondary",
                      )}
                      title={defaultDatasourceId === ds._id ? "默认数据源" : "设为默认"}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          defaultDatasourceId === ds._id && "fill-current",
                          isSettingDefaultId === ds._id && "animate-pulse",
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDatasourceDetail(ds)}
                      className="rounded p-1.5 text-text-secondary hover:bg-surface-hover"
                      title="查看详情"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPlatformDsId("");
                        setEditingDatasource(ds);
                      }}
                      className="rounded p-1.5 text-text-secondary hover:bg-surface-hover"
                      title="编辑"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDatasource(ds)}
                      disabled={deletingId === ds._id}
                      className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mb-4 h-10 text-sm text-text-secondary line-clamp-2">
                  {ds.description || "无描述"}
                </p>

                {/* Agents Tag List */}
                <div className="mb-3">
                  <div className="flex flex-wrap gap-1">
                    {ds.agentNames && ds.agentNames.length > 0 ? (
                      ds.agentNames.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-900/30 dark:text-blue-400"
                        >
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-text-tertiary italic">
                        未绑定智能体
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-text-tertiary">
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      ds.enabled ? "text-green-600" : "text-gray-400",
                    )}
                  >
                    {ds.enabled ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                    {ds.enabled ? "已启用" : "已禁用"}
                  </span>
                  <span>{formatDate(ds.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingDatasource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border-light bg-surface-primary shadow-lg">
            <div className="flex items-center justify-between border-b border-border-light p-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {(editingDatasource as DatDatasource)._id
                  ? "编辑数据源"
                  : "添加数据源"}
              </h3>
              <button
                type="button"
                onClick={() => setEditingDatasource(null)}
                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {/* Project Selection */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-text-primary">
                    所属项目 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editingDatasource.projectId || ""}
                    onChange={(e) => updateEditing("projectId", e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="" disabled>
                      请选择所属项目
                    </option>
                    {projects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Agent Binding (Multi-Select) */}
                {editingDatasource.projectId && (
                  <div className="relative" ref={agentDropdownRef}>
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      绑定智能体
                    </label>
                    <div
                      className="flex w-full cursor-pointer items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      onClick={() =>
                        setIsAgentDropdownOpen(!isAgentDropdownOpen)
                      }
                    >
                      <div className="flex flex-wrap gap-1">
                        {editingDatasource.agentNames &&
                          editingDatasource.agentNames.length > 0 ? (
                          editingDatasource.agentNames.map((name) => (
                            <span
                              key={name}
                              className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400">选择智能体...</span>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 text-gray-500" />
                    </div>

                    {/* Dropdown Menu */}
                    {isAgentDropdownOpen && (
                      <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border-light bg-surface-secondary text-text-primary shadow-lg">
                        {agents.length > 0 ? (
                          agents.map((agent: any) => {
                            const isSelected =
                              editingDatasource.agentNames?.includes(
                                agent.name,
                              );
                            return (
                              <div
                                key={agent.id}
                                className={cn(
                                  "flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-text-primary hover:bg-surface-hover",
                                  isSelected &&
                                  "bg-surface-active text-text-primary",
                                )}
                                onClick={() => toggleAgentSelection(agent.name)}
                              >
                                <div className="flex items-center gap-2">
                                  <span>{agent.name}</span>
                                  {agent.description && (
                                    <span className="max-w-[150px] truncate text-xs text-text-secondary">
                                      - {agent.description}
                                    </span>
                                  )}
                                </div>
                                {isSelected && <Check className="h-4 w-4 shrink-0 text-text-primary" />}
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-3 py-2 text-sm text-text-secondary">
                            暂无智能体
                          </div>
                        )}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-text-tertiary">
                      一个智能体只能绑定一个数据源。选择后将从其他数据源解绑。
                    </p>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-text-primary">
                    数据源名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editingDatasource.name || ""}
                    onChange={(e) => updateEditing("name", e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="请输入数据源名称"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-text-primary">
                    描述
                  </label>
                  <textarea
                    value={editingDatasource.description || ""}
                    onChange={(e) =>
                      updateEditing("description", e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    rows={2}
                    placeholder="请输入描述"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      数据库类型 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={editingDatasource.provider}
                      onChange={(e) =>
                        updateEditing("provider", e.target.value)
                      }
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    >
                      {PROVIDER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingDatasource.enabled}
                        onChange={(e) =>
                          updateEditing("enabled", e.target.checked)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      启用数据源
                    </label>
                  </div>
                </div>

                <div className="mt-4 border-t border-border-light pt-4">
                  <h4 className="mb-3 text-sm font-semibold text-text-primary">
                    连接配置
                  </h4>

                  {platformDataSources.length > 0 && (
                    <div className="mb-4 space-y-2 rounded-lg border border-border-light bg-surface-secondary/40 p-3">
                      <p className="text-xs text-text-secondary">
                        从平台已配置的数据源快速填入主机、端口、库名与账号密码（仍可手动修改下方字段）
                      </p>
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-text-primary">
                          平台数据源
                        </label>
                        <select
                          value={selectedPlatformDsId}
                          onChange={(e) => applyPlatformDataSource(e.target.value)}
                          disabled={isApplyingPlatformDs}
                          className={FIELD_CLASS}
                        >
                          <option value="">
                            {isApplyingPlatformDs
                              ? "填入中…"
                              : "手动填写 / 选择数据源"}
                          </option>
                          {platformDataSources.map((ds) => (
                            <option key={ds._id} value={ds._id}>
                              {ds.name}
                              {ds.type ? `（${ds.type}）` : ""}
                              {ds.host ? ` · ${ds.host}:${ds.port}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="mb-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-primary">
                        主机 (Host)
                      </label>
                      <input
                        type="text"
                        value={
                          editingDatasource.configuration?.host || "localhost"
                        }
                        onChange={(e) => updateConfig("host", e.target.value)}
                        className={FIELD_CLASS}
                        placeholder="localhost"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-primary">
                        端口 (Port)
                      </label>
                      <input
                        type="number"
                        value={editingDatasource.configuration?.port || 3306}
                        onChange={(e) =>
                          updateConfig("port", Number(e.target.value))
                        }
                        className={FIELD_CLASS}
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      数据库名 (Database)
                    </label>
                    <input
                      type="text"
                      value={editingDatasource.configuration?.database || ""}
                      onChange={(e) => updateConfig("database", e.target.value)}
                      className={FIELD_CLASS}
                      placeholder="database"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-primary">
                        用户名 (Username)
                      </label>
                      <input
                        type="text"
                        value={editingDatasource.configuration?.username || ""}
                        onChange={(e) =>
                          updateConfig("username", e.target.value)
                        }
                        className={FIELD_CLASS}
                        placeholder="username"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-primary">
                        密码 (Password)
                      </label>
                      <input
                        type="password"
                        value={editingDatasource.configuration?.password || ""}
                        onChange={(e) =>
                          updateConfig("password", e.target.value)
                        }
                        className={FIELD_CLASS}
                        placeholder="password"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-light bg-surface-primary p-4">
              <Button
                type="button"
                onClick={() => setEditingDatasource(null)}
                className="btn btn-neutral rounded-lg px-4 py-2"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={saveDatasource}
                disabled={isSaving}
                className="btn btn-primary rounded-lg px-4 py-2"
              >
                {isSaving ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Detail View Modal */}
      {viewingDatasource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-border-light bg-surface-primary shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-light p-4">
              <div className="flex items-center gap-3">
                <div className="rounded p-2 bg-blue-100 text-blue-600 dark:bg-blue-900/30">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-text-tertiary">
                    数据源 / 详情
                  </div>
                  <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                    {viewingDatasource.name}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                        viewingDatasource.enabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                      )}
                    >
                      {viewingDatasource.enabled ? "已启用" : "已禁用"}
                    </span>
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDatasourceDetail}
                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border-light px-4">
              <button
                type="button"
                onClick={() => setActiveDetailTab("schema")}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors",
                  activeDetailTab === "schema"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                )}
              >
                <Layers className="inline h-4 w-4 mr-1.5" />
                逻辑架构 (Light Schema)
              </button>
              <button
                type="button"
                onClick={() => setActiveDetailTab("overview")}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors",
                  activeDetailTab === "overview"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                )}
              >
                <Info className="inline h-4 w-4 mr-1.5" />
                概览与配置
              </button>
              <button
                type="button"
                onClick={() => setActiveDetailTab("prompts")}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors",
                  activeDetailTab === "prompts"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                )}
              >
                <Sparkles className="inline h-4 w-4 mr-1.5" />
                提示集
                {prompts.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    {prompts.length}
                  </span>
                )}
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              {activeDetailTab === "schema" ? (
                <div className="flex h-full">
                  {/* Schema Sidebar */}
                  <div className="w-72 border-r border-border-light bg-surface-secondary flex flex-col">
                    <div className="p-3 border-b border-border-light">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-text-primary">
                          数据表
                        </span>
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          {schemas.length}
                        </span>
                      </div>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                        <input
                          type="text"
                          value={tableSearch}
                          onChange={(e) => setTableSearch(e.target.value)}
                          placeholder="搜索表名或描述..."
                          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {isLoadingSchema ? (
                        <div className="flex flex-col items-center justify-center py-12">
                          <RefreshCw className="h-6 w-6 animate-spin text-blue-500 mb-3" />
                          <p className="text-sm text-text-tertiary">加载架构中...</p>
                        </div>
                      ) : filteredSchemas.length > 0 ? (
                        filteredSchemas.map((s) => (
                          <div
                            key={s.tableName}
                            onClick={() => setSelectedTableName(s.tableName)}
                            className={cn(
                              "px-3 py-2.5 cursor-pointer border-l-3 transition-colors",
                              selectedTableName === s.tableName
                                ? "bg-blue-50 border-l-blue-500 dark:bg-blue-900/20"
                                : "border-l-transparent hover:bg-surface-hover",
                            )}
                          >
                            <div className="font-medium text-sm text-text-primary truncate">
                              {s.tableName}
                            </div>
                            {s.tableDescription && (
                              <div className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                                {s.tableDescription}
                              </div>
                            )}
                          </div>
                        ))
                      ) : schemas.length === 0 ? (
                        <div className="p-6 text-center text-text-tertiary">
                          <Rocket className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                          <p className="text-sm">尚未生成架构描述</p>
                        </div>
                      ) : (
                        <div className="p-6 text-center text-text-tertiary">
                          <p className="text-sm">未找到匹配的表</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Schema Content */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {selectedSchema ? (
                      <>
                        <div className="px-4 py-3 border-b border-border-light bg-surface-secondary flex items-center gap-2">
                          <FileText className="h-4 w-4 text-text-secondary" />
                          <span className="font-medium text-text-primary">
                            {selectedSchema.tableName} 预览
                          </span>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <h2 className="text-lg font-semibold border-b pb-2 mb-4">
                              Table: {selectedSchema.tableName}
                            </h2>
                            <h3 className="text-sm font-medium text-text-secondary mt-4 mb-2">
                              Table description
                            </h3>
                            <p className="text-sm text-text-primary mb-4">
                              {selectedSchema.tableDescription ||
                                "No description available."}
                            </p>
                            <h3 className="text-sm font-medium text-text-secondary mt-4 mb-2">
                              Column information
                            </h3>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm border-collapse">
                                <thead>
                                  <tr className="bg-surface-secondary">
                                    <th className="border border-border-light px-3 py-2 text-left font-medium">
                                      column_name
                                    </th>
                                    <th className="border border-border-light px-3 py-2 text-left font-medium">
                                      column_type
                                    </th>
                                    <th className="border border-border-light px-3 py-2 text-left font-medium">
                                      column_description
                                    </th>
                                    <th className="border border-border-light px-3 py-2 text-left font-medium">
                                      value_examples
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedSchema.columns.map((col, idx) => (
                                    <tr
                                      key={col.name}
                                      className={
                                        idx % 2 === 0
                                          ? "bg-surface-primary"
                                          : "bg-surface-secondary/50"
                                      }
                                    >
                                      <td className="border border-border-light px-3 py-2 font-mono text-blue-600">
                                        {col.name}
                                      </td>
                                      <td className="border border-border-light px-3 py-2 text-text-secondary">
                                        {col.type}
                                      </td>
                                      <td className="border border-border-light px-3 py-2">
                                        {col.description || "-"}
                                      </td>
                                      <td className="border border-border-light px-3 py-2 text-xs font-mono text-text-tertiary">
                                        {col.sampleValues
                                          ? JSON.stringify(col.sampleValues)
                                          : "[]"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {selectedSchema.primaryKeys &&
                              selectedSchema.primaryKeys.length > 0 && (
                                <>
                                  <h3 className="text-sm font-medium text-text-secondary mt-4 mb-2">
                                    Primary keys
                                  </h3>
                                  <p className="text-sm">
                                    {selectedSchema.primaryKeys.join(", ")}
                                  </p>
                                </>
                              )}
                            {selectedSchema.foreignKeys &&
                              selectedSchema.foreignKeys.length > 0 && (
                                <>
                                  <h3 className="text-sm font-medium text-text-secondary mt-4 mb-2">
                                    Foreign keys
                                  </h3>
                                  <ul className="text-sm list-disc pl-5">
                                    {selectedSchema.foreignKeys.map(
                                      (fk, idx) => (
                                        <li key={idx}>
                                          {fk.columnName} → {fk.referencedTable}
                                          ({fk.referencedColumn})
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </>
                              )}
                            {selectedSchema.indices &&
                              selectedSchema.indices.length > 0 && (
                                <>
                                  <h3 className="text-sm font-medium text-text-secondary mt-4 mb-2">
                                    Indices
                                  </h3>
                                  <p className="text-sm">
                                    {selectedSchema.indices.join(", ")}
                                  </p>
                                </>
                              )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                          <Rocket className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                          <h3 className="text-lg font-medium text-text-secondary mb-2">
                            尚未生成架构描述
                          </h3>
                          <p className="text-sm text-text-tertiary max-w-md mb-4">
                            点击下方按钮，我们将利用 AI
                            自动分析您的数据库并生成极简架构 (Light Schema)。
                          </p>
                          <Button
                            type="button"
                            onClick={handleGenerateSchema}
                            disabled={
                              isProcessing || !viewingDatasource.projectId
                            }
                            className="btn btn-primary"
                          >
                            {isProcessing ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                生成中...
                              </>
                            ) : (
                              <>
                                <Rocket className="h-4 w-4 mr-2" />
                                立即生成 Light Schema
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : activeDetailTab === "overview" ? (
                <div className="p-6 overflow-auto h-full">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Basic Info Card */}
                    <div className="rounded-lg border border-border-light bg-surface-primary p-4">
                      <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        基本信息
                      </h4>
                      <dl className="space-y-2 text-sm">
                        <div className="flex">
                          <dt className="w-24 text-text-tertiary">名称</dt>
                          <dd className="text-text-primary">
                            {viewingDatasource.name}
                          </dd>
                        </div>
                        <div className="flex">
                          <dt className="w-24 text-text-tertiary">类型</dt>
                          <dd>
                            <span className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              {viewingDatasource.provider?.toUpperCase()}
                            </span>
                          </dd>
                        </div>
                        <div className="flex">
                          <dt className="w-24 text-text-tertiary">所属项目</dt>
                          <dd className="font-mono text-xs bg-surface-secondary px-1.5 py-0.5 rounded">
                            {getProjectName(viewingDatasource.projectId) ||
                              "未关联"}
                          </dd>
                        </div>
                        <div className="flex">
                          <dt className="w-24 text-text-tertiary">描述</dt>
                          <dd className="text-text-primary">
                            {viewingDatasource.description || "无"}
                          </dd>
                        </div>
                        <div className="flex">
                          <dt className="w-24 text-text-tertiary">创建时间</dt>
                          <dd className="text-text-primary">
                            {formatDate(viewingDatasource.createdAt)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Connection Config Card */}
                    <div className="rounded-lg border border-border-light bg-surface-primary p-4">
                      <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        连接配置
                      </h4>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <dt className="text-text-tertiary">主机</dt>
                          <dd className="text-text-primary">
                            {viewingDatasource.configuration?.host || "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-tertiary">端口</dt>
                          <dd className="text-text-primary">
                            {viewingDatasource.configuration?.port || "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-tertiary">数据库</dt>
                          <dd className="text-text-primary">
                            {viewingDatasource.configuration?.database || "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-tertiary">用户名</dt>
                          <dd className="text-text-primary">
                            {viewingDatasource.configuration?.username || "-"}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-text-tertiary">密码</dt>
                          <dd className="text-text-primary">••••••••</dd>
                        </div>
                      </dl>
                    </div>

                    {/* Preprocessing Control Card */}
                    <div className="lg:col-span-2 rounded-lg border border-border-light bg-surface-primary p-4">
                      <h4 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
                        <Rocket className="h-4 w-4" />
                        预处理控制
                      </h4>
                      <div className="space-y-4">
                        <div className="flex items-center gap-4 p-3 rounded-lg hover:bg-surface-hover transition-colors">
                          <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                            <Rocket className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h5 className="font-medium text-sm text-text-primary">
                              Light Schema
                            </h5>
                            <p className="text-xs text-text-tertiary">
                              替代语义模型，提供极简架构描述供 LLM 理解。
                            </p>
                          </div>
                          <Button
                            type="button"
                            onClick={handleGenerateSchema}
                            disabled={
                              isProcessing || !viewingDatasource.projectId
                            }
                            className="btn btn-neutral text-sm"
                          >
                            {isProcessing ? "处理中..." : "重生成"}
                          </Button>
                        </div>
                        <div className="flex items-center gap-4 p-3 rounded-lg hover:bg-surface-hover transition-colors">
                          <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                            <Layers className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h5 className="font-medium text-sm text-text-primary">
                              单元格向量化
                            </h5>
                            <p className="text-xs text-text-tertiary">
                              将数据库字段值存入向量库，辅助模糊匹配。
                            </p>
                          </div>
                          <Button
                            type="button"
                            onClick={handleVectorizeCells}
                            disabled={
                              isProcessing || !viewingDatasource.projectId
                            }
                            className="btn btn-neutral text-sm"
                          >
                            {isProcessing ? "处理中..." : "开始执行"}
                          </Button>
                        </div>
                        <div className="border-t border-border-light pt-4 mt-4">
                          <button
                            type="button"
                            onClick={handleClearPreprocessing}
                            disabled={!viewingDatasource.projectId}
                            className="w-full text-red-500 hover:text-red-600 text-sm py-2 flex items-center justify-center gap-1"
                          >
                            <Trash className="h-4 w-4" />
                            清空所有预处理数据
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Info Alert */}
                    <div className="lg:col-span-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-4">
                      <div className="flex gap-3">
                        <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <h5 className="font-medium text-sm text-blue-700 dark:text-blue-400">
                            Text-to-SQL 增强
                          </h5>
                          <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                            Light Schema 和单元格向量化是提升 SQL
                            生成准确率的关键步骤。AI
                            会根据这些信息精准定位表和字段。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : activeDetailTab === "prompts" ? (
                <div className="h-full p-6 overflow-auto">
                  {/* Prompts Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-sm font-semibold text-text-primary">
                        提示集管理
                      </h4>
                      <p className="text-xs text-text-tertiary mt-1">
                        配置快捷提示词,帮助用户快速开始对话(最多8个)
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setEditingPrompt({
                        label: "",
                        description: "",
                        content: "",
                        icon: "BulbOutlined",
                        iconColor: "#FFD700",
                        enabled: true,
                      })}
                      disabled={prompts.length >= 8}
                      className="btn btn-primary text-sm flex items-center gap-1"
                    >
                      <Plus className="h-4 w-4" />
                      添加提示词
                    </Button>
                  </div>

                  {/* Prompts List */}
                  {isLoadingPrompts ? (
                    <div className="flex items-center justify-center h-40">
                      <RefreshCw className="h-5 w-5 animate-spin text-text-tertiary" />
                    </div>
                  ) : prompts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-text-tertiary">
                      <Sparkles className="h-10 w-10 mb-3 text-gray-300" />
                      <p className="text-sm">暂无提示词</p>
                      <p className="text-xs mt-1">点击上方按钮添加提示词</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {prompts.map((prompt, index) => (
                        <div
                          key={prompt._id}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                            prompt.enabled
                              ? "border-border-light bg-surface-secondary hover:bg-surface-hover"
                              : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 opacity-60"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-text-primary line-clamp-2">
                                {prompt.content}
                              </span>
                              {!prompt.enabled && (
                                <span className="text-xs text-gray-400 flex-shrink-0">(已禁用)</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingPrompt(prompt)}
                              className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
                              title="编辑"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePrompt(prompt._id)}
                              className="p-1.5 rounded hover:bg-red-50 text-red-500 dark:hover:bg-red-900/20"
                              title="删除"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Edit Prompt Modal */}
                  {editingPrompt && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                      <div className="w-full max-w-lg rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                          <h3 className="text-lg font-semibold text-text-primary">
                            {(editingPrompt as DatasourcePrompt)._id ? "编辑提示词" : "添加提示词"}
                          </h3>
                          <button
                            type="button"
                            onClick={() => setEditingPrompt(null)}
                            className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="p-4 space-y-4">
                          {/* Content */}
                          <div>
                            <textarea
                              value={editingPrompt.content || ""}
                              onChange={(e) => setEditingPrompt(prev => prev ? { ...prev, content: e.target.value } : prev)}
                              maxLength={500}
                              rows={5}
                              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                              placeholder="输入提示内容，例如：请分析2024年Q3的销售数据趋势"
                            />
                            <p className="text-xs text-text-tertiary mt-1 text-right">
                              {(editingPrompt.content || "").length}/500
                            </p>
                          </div>

                          {/* Enabled */}
                          <div className="flex items-center gap-2 pt-2 border-t border-border-light">
                            <input
                              type="checkbox"
                              id="promptEnabled"
                              checked={editingPrompt.enabled !== false}
                              onChange={(e) => setEditingPrompt(prev => prev ? { ...prev, enabled: e.target.checked } : prev)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600"
                            />
                            <label htmlFor="promptEnabled" className="text-sm text-text-primary cursor-pointer">
                              启用此提示词
                            </label>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-border-light p-4">
                          <Button
                            type="button"
                            onClick={() => setEditingPrompt(null)}
                            className="btn btn-neutral rounded-lg px-4 py-2"
                          >
                            取消
                          </Button>
                          <Button
                            type="button"
                            onClick={savePrompt}
                            disabled={isSavingPrompt}
                            className="btn btn-primary rounded-lg px-4 py-2"
                          >
                            {isSavingPrompt ? "保存中..." : "保存"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ====== Table Selection Modal ====== */}
      {tableSelectVisible && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border-light bg-surface-primary shadow-lg flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-light p-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {tableSelectMode === "schema"
                  ? "选择要生成 Light Schema 的表"
                  : "选择要向量化单元格的表"}
              </h3>
              <button
                type="button"
                onClick={() => setTableSelectVisible(false)}
                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {tableSelectLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-text-tertiary" />
                </div>
              ) : (
                <>
                  {tableSelectMode === "schema" && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-3 flex gap-2">
                      <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h5 className="font-medium text-xs text-blue-700 dark:text-blue-400">
                          只覆盖选中的表
                        </h5>
                        <p className="text-xs text-blue-600 dark:text-blue-300 mt-0.5">
                          未选中的表不会受影响。默认勾选当前未生成过的表（增量更新）。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Search */}
                  {dbSchemas.length > 1 && (
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-text-secondary">
                        数据库 Schema
                      </label>
                      <div className="relative">
                        <select
                          value={selectedDbSchema || ""}
                          onChange={(e) => onDbSchemaChange(e.target.value)}
                          disabled={tableSelectLoading}
                          className="w-full appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none disabled:opacity-60"
                        >
                          <option value="">请选择 Schema</option>
                          {dbSchemas.map((schema) => (
                            <option key={schema} value={schema}>
                              {schema}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                    <input
                      type="text"
                      placeholder="搜索表名…"
                      value={tableSelectSearch}
                      onChange={(e) => setTableSelectSearch(e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-4 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none"
                    />
                  </div>

                  {/* Toolbar */}
                  <div className="flex items-center justify-between text-sm py-1 border-b border-border-light">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-text-secondary select-none">
                      <input
                        type="checkbox"
                        checked={allSelectedInFilter}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate = indeterminateInFilter;
                          }
                        }}
                        onChange={(e) => toggleSelectAllFiltered(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      全选当前列表 ({filteredAllTables.length})
                    </label>
                    <span className="text-xs text-text-tertiary">
                      已选 {selectedTables.length} / {allTables.length}
                    </span>
                  </div>

                  {/* List of tables */}
                  <div className="max-h-[30vh] overflow-y-auto space-y-2 pr-1">
                    {filteredAllTables.length === 0 ? (
                      <div className="text-center py-6 text-sm text-text-tertiary">
                        未匹配到表
                      </div>
                    ) : (
                      filteredAllTables.map((tableName) => {
                        const qualifiedName = qualifyTable(tableName);
                        const isSelected = selectedTables.includes(qualifiedName);
                        const isAlreadyGenerated = activeGeneratedSet.has(qualifiedName);
                        return (
                          <div
                            key={qualifiedName}
                            className="flex items-center justify-between p-2 rounded hover:bg-surface-hover transition-colors"
                          >
                            <label className="flex items-center gap-2 cursor-pointer text-sm text-text-primary flex-1 select-none">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleTableSelection(tableName)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="font-mono">{tableName}</span>
                            </label>
                            {isAlreadyGenerated && (
                              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                {tableSelectMode === "cells" ? "已向量化" : "已生成"}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border-light p-4">
              <Button
                type="button"
                onClick={() => setTableSelectVisible(false)}
                className="btn btn-neutral rounded-lg px-4 py-2"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={confirmTableSelection}
                disabled={isProcessing || tableSelectLoading}
                className="btn btn-primary rounded-lg px-4 py-2 flex items-center"
              >
                {isProcessing && (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                )}
                确认执行
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}