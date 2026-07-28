import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, useToastContext, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@because/client';
import { useGetModelsQuery } from '@because/data-provider/react-query';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import { getDatApiBaseUrl } from '~/utils/datApi';
import {
    RefreshCw,
    Plus,
    Edit2,
    Trash2,
    FolderOpen,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Server,
    Bot,
    Database,
    Search,
    X,
    FileText,
    Code,
    ArrowLeftRight,
    Upload,
    Inbox,
    Tag,
    Network,
    RotateCw,
} from 'lucide-react';
import { providerConfigs, ProviderType } from '~/constants/projectConfig';
import ProviderConfigForm from './components/ProviderConfigForm';
import type { PlatformEndpointOption } from './components/ProviderConfigForm';
import EmailSenderConfig from './components/EmailSenderConfig';
import McpServersConfig from './components/McpServersConfig';

interface OrgTreeNode {
    key: string;
    orgCode: string;
    orgName: string;
    brchLv: number | null;
    dataScope: string;
    managementOrg?: string | null;
    children: OrgTreeNode[];
}

const BRCH_LV_OPTIONS: { value: number; label: string }[] = [
    { value: 1, label: '1 全行（查所有）' },
    { value: 2, label: '2 本级+下级' },
    { value: 3, label: '3 管理行本级+下级' },
    { value: 4, label: '4 仅本级' },
];

// 单个树节点：自带展开/折叠 + brchLv 数据权限级别编辑 + 增删改操作
function OrgTreeNodeView({
    node,
    depth,
    onUpdateBrchLv,
    onAddChild,
    onEdit,
    onDelete,
}: {
    node: OrgTreeNode;
    depth: number;
    onUpdateBrchLv?: (node: OrgTreeNode, newLv: number) => void;
    onAddChild?: (node: OrgTreeNode) => void;
    onEdit?: (node: OrgTreeNode) => void;
    onDelete?: (node: OrgTreeNode) => void;
}) {
    const [expanded, setExpanded] = useState(depth < 2); // 默认展开前两层
    const hasChildren = node.children && node.children.length > 0;

    return (
        <li>
            <div
                className={cn(
                    'flex items-center gap-1 py-0.5 cursor-pointer select-none rounded hover:bg-surface-hover/50',
                    depth === 0 && 'font-medium'
                )}
                onClick={() => hasChildren && setExpanded(!expanded)}
            >
                {hasChildren ? (
                    expanded ? (
                        <ChevronDown className="h-3 w-3 text-text-tertiary shrink-0" />
                    ) : (
                        <ChevronRight className="h-3 w-3 text-text-tertiary shrink-0" />
                    )
                ) : (
                    <span className="w-3 shrink-0" />
                )}
                <span className="text-text-primary text-xs">{node.orgCode} {node.orgName}</span>
                {onUpdateBrchLv && (
                    <Select
                        value={node.brchLv != null ? String(node.brchLv) : undefined}
                        onValueChange={(v) => onUpdateBrchLv(node, Number(v))}
                    >
                        <SelectTrigger
                            className={cn(
                                'h-6 w-[170px] text-xs',
                                'border border-gray-300 bg-white text-gray-900',
                                'dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                            )}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <SelectValue placeholder="未设置" />
                        </SelectTrigger>
                        <SelectContent
                            className="border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {BRCH_LV_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={String(opt.value)}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {(onAddChild || onEdit || onDelete) && (
                    <span className="flex items-center gap-1 ml-1" onClick={(e) => e.stopPropagation()}>
                        {onAddChild && (
                            <button
                                type="button"
                                onClick={() => onAddChild(node)}
                                className="rounded p-1 text-text-tertiary hover:text-blue-500 hover:bg-surface-hover transition-colors"
                                title="添加子机构"
                            >
                                <Plus className="h-3 w-3" />
                            </button>
                        )}
                        {onEdit && (
                            <button
                                type="button"
                                onClick={() => onEdit(node)}
                                className="rounded p-1 text-text-tertiary hover:text-blue-500 hover:bg-surface-hover transition-colors"
                                title="编辑"
                            >
                                <Edit2 className="h-3 w-3" />
                            </button>
                        )}
                        {onDelete && (
                            <button
                                type="button"
                                onClick={() => onDelete(node)}
                                className="rounded p-1 text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                title="删除"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        )}
                    </span>
                )}
            </div>
            {hasChildren && expanded && (
                <ul className="border-l border-border-light pl-3 ml-1.5 space-y-0.5">
                    {node.children.map((child) => (
                        <OrgTreeNodeView
                            key={child.key}
                            node={child}
                            depth={depth + 1}
                            onUpdateBrchLv={onUpdateBrchLv}
                            onAddChild={onAddChild}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

// 树视图容器
function OrgTreeView({
    nodes,
    onUpdateBrchLv,
    onAddChild,
    onEdit,
    onDelete,
}: {
    nodes: OrgTreeNode[];
    onUpdateBrchLv?: (node: OrgTreeNode, newLv: number) => void;
    onAddChild?: (node: OrgTreeNode) => void;
    onEdit?: (node: OrgTreeNode) => void;
    onDelete?: (node: OrgTreeNode) => void;
}) {
    return (
        <ul className="space-y-0.5">
            {nodes.map((n) => (
                <OrgTreeNodeView
                    key={n.key}
                    node={n}
                    depth={0}
                    onUpdateBrchLv={onUpdateBrchLv}
                    onAddChild={onAddChild}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ))}
        </ul>
    );
}

// 将后端返回的驼峰命名字段转换为前端使用的下划线命名
// 后端可能返回 embeddingStore，但前端期望 embedding_store
const normalizeProject = (project: any): DatProject => {
    return {
        ...project,
        // 处理 embeddingStore -> embedding_store
        embedding_store: project.embedding_store || project.embeddingStore,
        // 处理 contentStore -> content_store
        content_store: project.content_store || project.contentStore,
        // 处理 semanticModels -> semantic_models (在 agents 中)
        agents: project.agents?.map((agent: any) => ({
            ...agent,
            semantic_models: agent.semantic_models || agent.semanticModels || [],
            semantic_model_tags: agent.semantic_model_tags || agent.semanticModelTags || [],
        })) || [],
    };
};

// 类型定义
interface LlmConfig {
    name: string;
    provider: string;
    configuration: Record<string, any>;
}

interface AgentConfig {
    name: string;
    description?: string;
    provider: string;
    configuration: Record<string, any>;
    semantic_models?: string[];
    semantic_model_tags?: string[];
}

interface ProviderConfigItem {
    provider: string;
    configuration: Record<string, any>;
}

interface DatProject {
    _id: string;
    version: number;
    name: string;
    description?: string;
    configuration?: Record<string, any>;
    db?: ProviderConfigItem;
    embedding: ProviderConfigItem;
    embedding_store: ProviderConfigItem;
    llms: LlmConfig[];
    reranking: ProviderConfigItem;
    content_store: ProviderConfigItem;
    agents: AgentConfig[];
    createdAt: string;
    updatedAt: string;
}

// Content Management Types
interface SqlPair {
    id: string;
    question: string;
    sql: string;
}

interface Synonym {
    id: string;
    word: string;
    synonyms: string[];
}

interface DocItem {
    id: string;
    content: string;
}

interface IndexEntry {
    id: string;
    indexNumber: string;
    standardName: string;
    aliases?: string[];
    source?: number | null;
    frequency?: string | null;
}

interface IndexUploadResult {
    upserted: number;
    skippedRows: number;
    errors: { rowNumber: number; message: string }[];
}

type ContentTabType = 'sql-pairs' | 'synonyms' | 'docs' | 'index-entries' | 'org-nodes';

// 默认项目数据
const getDefaultProject = (): Omit<
    DatProject,
    "_id" | "createdAt" | "updatedAt"
> => ({
    version: 1,
    name: "",
    description: "",
    configuration: {},
    llms: [
        {
            name: "default",
            provider: "openai",
            configuration: {
                "base-url": "https://api.openai.com/v1",
                "model-name": "",
                "api-key": "",
            },
        },
    ],
    agents: [
        {
            name: "default",
            description: "",
            provider: "default",
            configuration: {
                "default-llm": "default",
                language: "Simplified Chinese",
            },
            semantic_models: [],
            semantic_model_tags: [],
        },
    ],
    embedding: {
        provider: "bge-small-zh-v15-q",
        configuration: {},
    },
    embedding_store: {
        provider: "pgvector",
        configuration: {
            host: "pgvector",
            port: 5432,
            user: "dat",
            password: "dat123",
            database: "dat_embeddings",
            dimension: 512,
            "table-prefix": "dat_embeddings",
        },
    },
    content_store: {
        provider: "default",
        configuration: {
            "max-results": 5,
            "min-score": 0.6,
            "synonym.retrieval.max-results": 8,
            "synonym.retrieval.min-score": 0.4,
        },
    },
    reranking: {
        provider: "ms-marco-MiniLM-L6-v2-q",
        configuration: {},
    },
});

type TabType = 'basic' | 'llms' | 'agents' | 'embedding' | 'content';

export default function ProjectsManagement() {
    const { showToast } = useToastContext();
    const { token } = useAuthContext();
    const { data: modelsData } = useGetModelsQuery();
    const [projects, setProjects] = useState<DatProject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingProject, setEditingProject] = useState<Partial<DatProject> | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('basic');
    const [customEndpoints, setCustomEndpoints] = useState<
        { name: string; apiKey: string; baseURL: string; models?: { default?: string[]; fetch?: boolean } }[]
    >([]);

    // Content Management State
    const [contentManagementProject, setContentManagementProject] = useState<DatProject | null>(null);
    const [contentActiveTab, setContentActiveTab] = useState<ContentTabType>('sql-pairs');
    const [contentLoading, setContentLoading] = useState(false);

    // SQL Pairs
    const [sqlPairs, setSqlPairs] = useState<SqlPair[]>([]);
    const [sqlSearchQuery, setSqlSearchQuery] = useState('');
    const [sqlModalVisible, setSqlModalVisible] = useState(false);
    const [sqlForm, setSqlForm] = useState({ question: '', sql: '' });

    // Synonyms
    const [synonyms, setSynonyms] = useState<Synonym[]>([]);
    const [synSearchQuery, setSynSearchQuery] = useState('');
    const [synModalVisible, setSynModalVisible] = useState(false);
    const [synForm, setSynForm] = useState({ word: '', synonyms: '' });

    // Docs
    const [docs, setDocs] = useState<DocItem[]>([]);
    const [docSearchQuery, setDocSearchQuery] = useState('');
    const [docModalVisible, setDocModalVisible] = useState(false);
    const [docForm, setDocForm] = useState({ content: '' });
    const [uploading, setUploading] = useState(false);

    // Index Entries (指标库)
    const [indexEntries, setIndexEntries] = useState<IndexEntry[]>([]);
    const [indexSearchQuery, setIndexSearchQuery] = useState('');
    /** 已生效的筛选关键词（点「检索」后才写入；删除/刷新时用它保持筛选，而不是清空） */
    const [indexActiveFilter, setIndexActiveFilter] = useState('');
    const [indexModalVisible, setIndexModalVisible] = useState(false);
    const [indexEditingId, setIndexEditingId] = useState<string | null>(null);
    const [indexForm, setIndexForm] = useState<{
        indexNumber: string;
        standardName: string;
        aliases: string;
        source: number | undefined;
        frequency: string;
    }>({ indexNumber: '', standardName: '', aliases: '', source: undefined, frequency: '' });
    const [indexUploadModalVisible, setIndexUploadModalVisible] = useState(false);
    const [indexUploading, setIndexUploading] = useState(false);
    const [indexUploadResult, setIndexUploadResult] = useState<IndexUploadResult | null>(null);

    // Org Nodes (机构信息 — 数据源表驱动)
    const [orgNodesTree, setOrgNodesTree] = useState<OrgTreeNode[]>([]);
    const [orgSearchQuery, setOrgSearchQuery] = useState('');
    const [orgActiveFilter, setOrgActiveFilter] = useState('');
    const [orgNodesLoading, setOrgNodesLoading] = useState(false);

    // Org Nodes — 手动新增/编辑
    const [orgNodeModalVisible, setOrgNodeModalVisible] = useState(false);
    const [orgNodeEditingCode, setOrgNodeEditingCode] = useState<string | null>(null);
    const [orgNodeForm, setOrgNodeForm] = useState<{
        orgCode: string;
        orgName: string;
        parentOrgCode: string;
        brchLv: number | '';
    }>({ orgCode: '', orgName: '', parentOrgCode: '', brchLv: '' });
    const [orgNodeFormSubmitting, setOrgNodeFormSubmitting] = useState(false);

    // Org Nodes — Excel 导入
    const [orgExcelUploading, setOrgExcelUploading] = useState(false);

    // Org Nodes — 从数据源表导入
    const [orgTableImportModalVisible, setOrgTableImportModalVisible] = useState(false);
    const [orgTableImportStep, setOrgTableImportStep] = useState<'datasource' | 'table' | 'result'>('datasource');
    const [orgTableImportDatasources, setOrgTableImportDatasources] = useState<any[]>([]);
    const [orgTableImportSelectedDs, setOrgTableImportSelectedDs] = useState('');
    const [orgTableImportTables, setOrgTableImportTables] = useState<string[]>([]);
    const [orgTableImportSelectedTable, setOrgTableImportSelectedTable] = useState('');
    const [orgTableImportLoading, setOrgTableImportLoading] = useState(false);
    const [orgTableImportColumns, setOrgTableImportColumns] = useState<{
        tableName: string;
        columns: { name: string; type: string }[];
        valid: boolean;
        message: string;
    } | null>(null);
    const [orgTableImportResult, setOrgTableImportResult] = useState<{
        imported: number;
        dataDt: string;
    } | null>(null);

    // DB schema/namespace state for multi-schema datasources (org import)
    const [orgTableImportSchemas, setOrgTableImportSchemas] = useState<string[]>([]);
    const [orgTableImportSelectedSchema, setOrgTableImportSelectedSchema] = useState<string | null>(null);

    const qualifiedOrgTable = useCallback(
        (tableName: string) => {
            if (orgTableImportSchemas.length <= 1 || !orgTableImportSelectedSchema) return tableName;
            return `${orgTableImportSelectedSchema}.${tableName}`;
        },
        [orgTableImportSchemas.length, orgTableImportSelectedSchema]
    );

    // KPI Index Entries — 从数据源表导入
    const [kpiTableImportModalVisible, setKpiTableImportModalVisible] = useState(false);
    const [kpiTableImportStep, setKpiTableImportStep] = useState<'datasource' | 'table' | 'result'>('datasource');
    const [kpiTableImportDatasources, setKpiTableImportDatasources] = useState<any[]>([]);
    const [kpiTableImportSelectedDs, setKpiTableImportSelectedDs] = useState('');
    const [kpiTableImportTables, setKpiTableImportTables] = useState<string[]>([]);
    const [kpiTableImportSelectedTable, setKpiTableImportSelectedTable] = useState('');
    const [kpiTableImportLoading, setKpiTableImportLoading] = useState(false);
    const [kpiTableImportColumns, setKpiTableImportColumns] = useState<{
        tableName: string;
        columns: { name: string; type: string }[];
        valid: boolean;
        message: string;
    } | null>(null);
    const [kpiTableImportResult, setKpiTableImportResult] = useState<{
        upserted: number;
        totalEntries: number;
    } | null>(null);

    // DB schema/namespace state for multi-schema datasources (KPI import)
    const [kpiTableImportSchemas, setKpiTableImportSchemas] = useState<string[]>([]);
    const [kpiTableImportSelectedSchema, setKpiTableImportSelectedSchema] = useState<string | null>(null);

    const qualifiedKpiTable = useCallback(
        (tableName: string) => {
            if (kpiTableImportSchemas.length <= 1 || !kpiTableImportSelectedSchema) return tableName;
            return `${kpiTableImportSelectedSchema}.${tableName}`;
        },
        [kpiTableImportSchemas.length, kpiTableImportSelectedSchema]
    );

    // Org Nodes — 数据快照管理
    const [orgDataTimes, setOrgDataTimes] = useState<string[]>([]);
    const [orgActiveDataDt, setOrgActiveDataDt] = useState('');
    const [orgActiveDtIsManual, setOrgActiveDtIsManual] = useState(false);

    // 获取 API 基础路径
    const getApiBase = useCallback(() => {
        const baseEl = document.querySelector('base');
        const baseHref = baseEl?.getAttribute('href') || '/';
        return baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
    }, []);

    // 获取请求头
    const getHeaders = useCallback((): HeadersInit => {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }, [token]);

    // 获取项目列表
    const fetchProjects = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`${getApiBase()}/api/dat-projects`, {
                method: 'GET',
                headers: getHeaders(),
                credentials: 'include',
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: '获取项目列表失败' }));
                throw new Error(error.error || '获取项目列表失败');
            }

            const data = await response.json();
            // 对每个项目进行字段名规范化，处理驼峰命名到下划线命名的转换
            const normalizedProjects = (data.projects || []).map(normalizeProject);
            setProjects(normalizedProjects);
        } catch (error) {
            console.error('Error fetching projects:', error);
            showToast({
                message: `获取项目列表失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setIsLoading(false);
        }
    }, [getApiBase, getHeaders, showToast]);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    // 拉取平台自定义端点（含 baseURL / apiKey 模板），供 LLM 表单选择
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch(`${getApiBase()}/api/config/endpoints/custom`, {
                    method: 'GET',
                    headers: getHeaders(),
                    credentials: 'include',
                });
                if (!response.ok) return;
                const data = await response.json();
                if (!cancelled) {
                    setCustomEndpoints(Array.isArray(data.endpoints) ? data.endpoints : []);
                }
            } catch (err) {
                console.warn('Failed to load custom endpoints for DAT LLM picker', err);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [getApiBase, getHeaders]);

    const platformEndpoints: PlatformEndpointOption[] = useMemo(() => {
        return (customEndpoints || [])
            .filter((ep) => ep?.name && ep?.baseURL)
            .map((ep) => {
                const fromConfig = Array.isArray(ep.models?.default) ? ep.models.default : [];
                const fromQuery = Array.isArray(modelsData?.[ep.name]) ? modelsData[ep.name] : [];
                const models = Array.from(new Set([...fromConfig, ...fromQuery].filter(Boolean)));
                return {
                    name: ep.name,
                    baseURL: ep.baseURL,
                    apiKey: ep.apiKey || '',
                    models,
                };
            });
    }, [customEndpoints, modelsData]);

    // 保存项目
    const saveProject = async () => {
        if (!editingProject) return;

        if (!editingProject.name?.trim()) {
            showToast({ message: '请输入项目名称', status: 'error' });
            setActiveTab('basic');
            return;
        }

        setIsSaving(true);
        try {
            const isEdit = !!(editingProject as DatProject)._id;
            const url = isEdit
                ? `${getApiBase()}/api/dat-projects/${(editingProject as DatProject)._id}`
                : `${getApiBase()}/api/dat-projects`;

            // 新建项目时，用默认值兜底，确保 embedding_store / content_store 等完整配置一定会传给后端
            const payload = isEdit
                ? editingProject
                : { ...getDefaultProject(), ...editingProject };

            const response = await fetch(url, {
                method: isEdit ? 'PUT' : 'POST',
                headers: getHeaders(),
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: '保存失败' }));
                throw new Error(error.error || '保存失败');
            }

            showToast({
                message: isEdit ? '项目更新成功' : '项目创建成功',
                status: 'success',
            });

            setEditingProject(null);
            fetchProjects();
        } catch (error) {
            console.error('Error saving project:', error);
            showToast({
                message: `保存失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setIsSaving(false);
        }
    };

    // 删除项目
    const deleteProject = async (project: DatProject) => {
        if (!confirm(`确定要删除项目 "${project.name}" 吗？此操作不可撤销。`)) {
            return;
        }

        setDeletingId(project._id);
        try {
            const response = await fetch(`${getApiBase()}/api/dat-projects/${project._id}`, {
                method: 'DELETE',
                headers: getHeaders(),
                credentials: 'include',
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: '删除失败' }));
                throw new Error(error.error || '删除失败');
            }

            showToast({ message: '项目删除成功', status: 'success' });
            setProjects(prev => prev.filter(p => p._id !== project._id));
        } catch (error) {
            console.error('Error deleting project:', error);
            showToast({
                message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setDeletingId(null);
        }
    };

    // 切换展开/折叠
    const toggleExpand = (projectId: string) => {
        setExpandedProjects(prev => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
            }
            return next;
        });
    };

    // 获取 Provider 选项
    const getProviderOptions = (type: string) => {
        const configs = providerConfigs[type] || {};
        return Object.entries(configs).map(([key, value]) => ({
            value: key,
            label: value.label || key,
        }));
    };

    // 获取 Provider 配置定义
    const getProviderConfigDef = (type: string, provider: string) => {
        return providerConfigs[type]?.[provider] || { label: provider, fields: [] };
    };

    // LLM Options for Selects
    const llmOptions = useMemo(() => {
        if (!editingProject?.llms) return [];
        return editingProject.llms.map(llm => ({
            label: llm.name,
            value: llm.name,
        }));
    }, [editingProject?.llms]);

    // Handlers for dynamic form updates
    const updateEditingProject = (key: keyof DatProject, value: any) => {
        setEditingProject(prev => (prev ? { ...prev, [key]: value } : prev));
    };

    const updateLlm = (index: number, changes: Partial<LlmConfig>) => {
        if (!editingProject?.llms) return;
        const newLlms = [...editingProject.llms];
        newLlms[index] = { ...newLlms[index], ...changes };
        updateEditingProject('llms', newLlms);
    };

    const removeLlm = (index: number) => {
        if (!editingProject?.llms) return;
        if (editingProject.llms.length <= 1) {
            showToast({ message: '至少需要一个 LLM 配置', status: 'warning' });
            return;
        }
        const newLlms = [...editingProject.llms];
        newLlms.splice(index, 1);
        updateEditingProject('llms', newLlms);
    };

    const addLlm = () => {
        if (!editingProject?.llms) return;
        const newLlms = [
            ...editingProject.llms,
            {
                name: `llm_${editingProject.llms.length}`,
                provider: 'openai',
                configuration: { 'base-url': 'https://api.openai.com/v1' }
            }
        ];
        updateEditingProject('llms', newLlms);
    };

    const updateAgent = (index: number, changes: Partial<AgentConfig>) => {
        if (!editingProject?.agents) return;
        const newAgents = [...editingProject.agents];
        newAgents[index] = { ...newAgents[index], ...changes };
        updateEditingProject('agents', newAgents);
    };

    const removeAgent = (index: number) => {
        if (!editingProject?.agents) return;
        if (editingProject.agents.length <= 1) {
            showToast({ message: '至少需要一个 Agent 配置', status: 'warning' });
            return;
        }
        const newAgents = [...editingProject.agents];
        newAgents.splice(index, 1);
        updateEditingProject('agents', newAgents);
    };

    const addAgent = () => {
        if (!editingProject?.agents) return;
        const newAgents = [
            ...editingProject.agents,
            {
                name: `agent_${editingProject.agents.length}`,
                provider: 'default',
                configuration: {
                    'default-llm': 'default',
                    language: 'Simplified Chinese'
                },
                semantic_models: [],
                semantic_model_tags: []
            }
        ];
        updateEditingProject('agents', newAgents);
    };

    // 格式化日期
    const formatDate = (dateString: string) => {
        try {
            return new Date(dateString).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return dateString;
        }
    };

    // ============ Content Management API Functions ============

    /** DAT content-store 失败时给出可读原因（常见：项目无 db / 无数据源） */
    const readDatErrorMessage = async (response: Response, fallback: string) => {
        try {
            const data = await response.json();
            const raw =
                (typeof data?.message === 'string' && data.message) ||
                (typeof data?.error === 'string' && data.error) ||
                (typeof data?.detail === 'string' && data.detail) ||
                '';
            if (/url is null|database adapter|no db|Failed to initialize project runner/i.test(raw)) {
                return '内容库初始化失败：项目尚未配置业务数据库。请先在「DAT 数据源」里为该项目添加数据源后再打开内容管理。';
            }
            if (raw) return raw;
        } catch {
            /* ignore non-json body */
        }
        return `${fallback} (HTTP ${response.status})`;
    };

    // Open content management for a project
    const openContentManagement = (project: DatProject) => {
        setContentManagementProject(project);
        setContentActiveTab('sql-pairs');
        setSqlPairs([]);
        setSynonyms([]);
        setDocs([]);
        setIndexEntries([]);
        setIndexSearchQuery('');
        setIndexActiveFilter('');
        setIndexUploadResult(null);
        setOrgNodesTree([]);
        setOrgSearchQuery('');
        setOrgActiveFilter('');
        setOrgDataTimes([]);
        setOrgActiveDataDt('');
        setOrgActiveDtIsManual(false);
        setSqlSearchQuery('');
        setSynSearchQuery('');
        setDocSearchQuery('');
        loadSqlPairs(project._id);
    };

    // Close content management
    const closeContentManagement = () => {
        setContentManagementProject(null);
        setSqlPairs([]);
        setSynonyms([]);
        setDocs([]);
        setIndexEntries([]);
        setIndexSearchQuery('');
        setIndexActiveFilter('');
        setOrgNodesTree([]);
        setOrgSearchQuery('');
        setOrgActiveFilter('');
        setOrgDataTimes([]);
        setOrgActiveDataDt('');
        setOrgActiveDtIsManual(false);
    };

    // ---- SQL Pairs ----
    const loadSqlPairs = async (projectId: string) => {
        setContentLoading(true);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/sql-pairs?projectId=${projectId}`);
            if (response.ok) {
                const data = await response.json();
                setSqlPairs(data || []);
            } else {
                setSqlPairs([]);
                showToast({
                    message: await readDatErrorMessage(response, '加载 SQL 示例对失败'),
                    status: 'error',
                });
            }
        } catch (error) {
            console.error('Failed to load SQL pairs:', error);
            setSqlPairs([]);
            showToast({
                message: `加载 SQL 示例对失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setContentLoading(false);
        }
    };

    const searchSqlPairs = async () => {
        if (!contentManagementProject || !sqlSearchQuery.trim()) {
            if (contentManagementProject) loadSqlPairs(contentManagementProject._id);
            return;
        }
        setContentLoading(true);
        try {
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/content-store/sql-pairs/retrieve?projectId=${contentManagementProject._id}&query=${encodeURIComponent(sqlSearchQuery)}`
            );
            if (response.ok) {
                const data = await response.json();
                setSqlPairs(data || []);
                showToast({ message: `检索到 ${data?.length || 0} 个相关结果`, status: 'success' });
            }
        } catch (error) {
            showToast({ message: `检索失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        } finally {
            setContentLoading(false);
        }
    };

    const handleAddSqlPair = async () => {
        if (!contentManagementProject || !sqlForm.question || !sqlForm.sql) {
            showToast({ message: '请填写问题和SQL', status: 'warning' });
            return;
        }
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/sql-pairs?projectId=${contentManagementProject._id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sqlForm)
            });
            if (response.ok) {
                showToast({ message: '添加成功', status: 'success' });
                setSqlModalVisible(false);
                setSqlForm({ question: '', sql: '' });
                loadSqlPairs(contentManagementProject._id);
            } else {
                throw new Error('添加失败');
            }
        } catch (error) {
            showToast({ message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleRemoveSqlPair = async (id: string) => {
        if (!contentManagementProject) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/sql-pairs/${id}?projectId=${contentManagementProject._id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                showToast({ message: '删除成功', status: 'success' });
                loadSqlPairs(contentManagementProject._id);
            }
        } catch (error) {
            showToast({ message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleClearAllSqlPairs = async () => {
        if (!contentManagementProject) return;
        if (!confirm('确定要清空所有SQL示例对吗？此操作不可恢复！')) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/sql-pairs?projectId=${contentManagementProject._id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                showToast({ message: '清空成功', status: 'success' });
                setSqlPairs([]);
            }
        } catch (error) {
            showToast({ message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    // ---- Synonyms ----
    const loadSynonyms = async (projectId: string) => {
        setContentLoading(true);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/synonyms?projectId=${projectId}`);
            if (response.ok) {
                const data = await response.json();
                setSynonyms(data || []);
            } else {
                setSynonyms([]);
                showToast({
                    message: await readDatErrorMessage(response, '加载同义词失败'),
                    status: 'error',
                });
            }
        } catch (error) {
            console.error('Failed to load synonyms:', error);
            setSynonyms([]);
            showToast({
                message: `加载同义词失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setContentLoading(false);
        }
    };

    const searchSynonyms = async () => {
        if (!contentManagementProject || !synSearchQuery.trim()) {
            if (contentManagementProject) loadSynonyms(contentManagementProject._id);
            return;
        }
        setContentLoading(true);
        try {
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/content-store/synonyms/retrieve?projectId=${contentManagementProject._id}&query=${encodeURIComponent(synSearchQuery)}`
            );
            if (response.ok) {
                const data = await response.json();
                setSynonyms(data || []);
                showToast({ message: `检索到 ${data?.length || 0} 个相关结果`, status: 'success' });
            }
        } catch (error) {
            showToast({ message: `检索失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        } finally {
            setContentLoading(false);
        }
    };

    const handleAddSynonym = async () => {
        if (!contentManagementProject || !synForm.word || !synForm.synonyms) {
            showToast({ message: '请填写词和同义词', status: 'warning' });
            return;
        }
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/synonyms?projectId=${contentManagementProject._id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    word: synForm.word,
                    synonyms: synForm.synonyms.split(',').map(s => s.trim()).filter(Boolean)
                })
            });
            if (response.ok) {
                showToast({ message: '添加成功', status: 'success' });
                setSynModalVisible(false);
                setSynForm({ word: '', synonyms: '' });
                loadSynonyms(contentManagementProject._id);
            } else {
                throw new Error('添加失败');
            }
        } catch (error) {
            showToast({ message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleRemoveSynonym = async (id: string) => {
        if (!contentManagementProject) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/synonyms/${id}?projectId=${contentManagementProject._id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                showToast({ message: '删除成功', status: 'success' });
                loadSynonyms(contentManagementProject._id);
            }
        } catch (error) {
            showToast({ message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleClearAllSynonyms = async () => {
        if (!contentManagementProject) return;
        if (!confirm('确定要清空所有同义词吗？此操作不可恢复！')) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/synonyms?projectId=${contentManagementProject._id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                showToast({ message: '清空成功', status: 'success' });
                setSynonyms([]);
            }
        } catch (error) {
            showToast({ message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    // ---- Docs ----
    const loadDocs = async (projectId: string) => {
        setContentLoading(true);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/docs?projectId=${projectId}`);
            if (response.ok) {
                const data = await response.json();
                setDocs(data || []);
            } else {
                setDocs([]);
                showToast({
                    message: await readDatErrorMessage(response, '加载业务知识失败'),
                    status: 'error',
                });
            }
        } catch (error) {
            console.error('Failed to load docs:', error);
            setDocs([]);
            showToast({
                message: `加载业务知识失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setContentLoading(false);
        }
    };

    const searchDocs = async () => {
        if (!contentManagementProject || !docSearchQuery.trim()) {
            if (contentManagementProject) loadDocs(contentManagementProject._id);
            return;
        }
        setContentLoading(true);
        try {
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/content-store/docs/retrieve?projectId=${contentManagementProject._id}&query=${encodeURIComponent(docSearchQuery)}`
            );
            if (response.ok) {
                const data = await response.json();
                setDocs(data || []);
                showToast({ message: `检索到 ${data?.length || 0} 个相关结果`, status: 'success' });
            }
        } catch (error) {
            showToast({ message: `检索失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        } finally {
            setContentLoading(false);
        }
    };

    const handleAddDoc = async () => {
        if (!contentManagementProject || !docForm.content) {
            showToast({ message: '请填写知识内容', status: 'warning' });
            return;
        }
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/docs?projectId=${contentManagementProject._id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: docForm.content })
            });
            if (response.ok) {
                showToast({ message: '添加成功', status: 'success' });
                setDocModalVisible(false);
                setDocForm({ content: '' });
                loadDocs(contentManagementProject._id);
            } else {
                throw new Error('添加失败');
            }
        } catch (error) {
            showToast({ message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleRemoveDoc = async (id: string) => {
        if (!contentManagementProject) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/docs/${id}?projectId=${contentManagementProject._id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                showToast({ message: '删除成功', status: 'success' });
                loadDocs(contentManagementProject._id);
            }
        } catch (error) {
            showToast({ message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleClearAllDocs = async () => {
        if (!contentManagementProject) return;
        if (!confirm('确定要清空所有业务知识吗？此操作不可恢复！')) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/docs?projectId=${contentManagementProject._id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                showToast({ message: '清空成功', status: 'success' });
                setDocs([]);
            }
        } catch (error) {
            showToast({ message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!contentManagementProject || !e.target.files?.[0]) return;
        const file = e.target.files[0];
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/content-store/docs/upload?projectId=${contentManagementProject._id}`, {
                method: 'POST',
                body: formData
            });
            if (response.ok) {
                const result = await response.json();
                showToast({ message: `文件 "${result.filename}" 上传成功`, status: 'success' });
                loadDocs(contentManagementProject._id);
            } else {
                throw new Error('上传失败');
            }
        } catch (error) {
            showToast({ message: `上传失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    // Handle content tab change
    const handleContentTabChange = (tab: ContentTabType) => {
        setContentActiveTab(tab);
        if (!contentManagementProject) return;
        if (tab === 'sql-pairs') {
            loadSqlPairs(contentManagementProject._id);
        } else if (tab === 'synonyms') {
            loadSynonyms(contentManagementProject._id);
        } else if (tab === 'index-entries') {
            loadIndexEntries(contentManagementProject._id);
        } else if (tab === 'org-nodes') {
            loadOrgNodes(contentManagementProject._id);
        } else {
            loadDocs(contentManagementProject._id);
        }
    };

    // ============ Index Entries (指标库) ============
    const sourceLabel = (n: number | null | undefined) => {
        if (n == null) return '-';
        return ({ 1: '人行', 2: '银监', 3: '省联社' } as Record<number, string>)[n] || String(n);
    };

    const filterIndexEntries = (all: IndexEntry[], q: string): IndexEntry[] => {
        const keyword = q.trim();
        if (!keyword) return all;
        return all.filter(
            (e) =>
                (e.indexNumber || '').includes(keyword) ||
                (e.standardName || '').includes(keyword) ||
                (e.aliases || []).some((a) => (a || '').includes(keyword))
        );
    };

    /** 拉取全量后按已生效筛选条件过滤；删除/保存后调用，不会清空搜索框 */
    const refreshIndexEntries = async (projectId: string, opts?: { announce?: boolean; filter?: string }) => {
        const activeFilter = opts?.filter ?? indexActiveFilter;
        setContentLoading(true);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/index/entries?projectId=${projectId}`);
            if (!response.ok) throw new Error('加载失败');
            const all: IndexEntry[] = (await response.json()) || [];
            const filtered = filterIndexEntries(all, activeFilter);
            setIndexEntries(filtered);
            if (opts?.announce && activeFilter.trim()) {
                showToast({ message: `本地过滤到 ${filtered.length} 个结果`, status: 'success' });
            }
        } catch (error) {
            console.error('Failed to load index entries:', error);
            setIndexEntries([]);
            if (opts?.announce) {
                showToast({
                    message: `检索失败: ${error instanceof Error ? error.message : '未知错误'}`,
                    status: 'error',
                });
            }
        } finally {
            setContentLoading(false);
        }
    };

    const loadIndexEntries = async (projectId: string) => {
        await refreshIndexEntries(projectId);
    };

    // 后端 list 不带模糊检索，前端本地子串过滤
    const searchIndexEntries = async () => {
        if (!contentManagementProject) return;
        const nextFilter = indexSearchQuery.trim();
        setIndexActiveFilter(nextFilter);
        await refreshIndexEntries(contentManagementProject._id, { announce: true, filter: nextFilter });
    };

    const openAddIndexEntry = () => {
        setIndexEditingId(null);
        setIndexForm({ indexNumber: '', standardName: '', aliases: '', source: undefined, frequency: '' });
        setIndexModalVisible(true);
    };

    const openEditIndexEntry = (record: IndexEntry) => {
        setIndexEditingId(record.id);
        setIndexForm({
            indexNumber: record.indexNumber,
            standardName: record.standardName,
            aliases: (record.aliases || []).join('/'),
            source: record.source ?? undefined,
            frequency: record.frequency || '',
        });
        setIndexModalVisible(true);
    };

    const handleSaveIndexEntry = async () => {
        if (!contentManagementProject) return;
        const { indexNumber, standardName } = indexForm;
        if (!indexNumber.trim()) {
            showToast({ message: '请填写指标编码', status: 'warning' });
            return;
        }
        if (!standardName.trim()) {
            showToast({ message: '请填写指标名称', status: 'warning' });
            return;
        }
        const aliases = (indexForm.aliases || '')
            .split(/[/,;、，；]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s !== standardName.trim());
        try {
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/index/entries?projectId=${contentManagementProject._id}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        indexNumber: indexNumber.trim(),
                        standardName: standardName.trim(),
                        aliases,
                        source: indexForm.source,
                        frequency: (indexForm.frequency || '').trim() || null,
                    }),
                }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            showToast({ message: indexEditingId ? '更新成功' : '添加成功', status: 'success' });
            setIndexModalVisible(false);
            await refreshIndexEntries(contentManagementProject._id);
        } catch (error) {
            showToast({
                message: `${indexEditingId ? '更新' : '添加'}失败: ${error instanceof Error ? error.message : '未知错误'}`,
                status: 'error',
            });
        }
    };

    const handleRemoveIndexEntry = async (id: string) => {
        if (!contentManagementProject) return;
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/index/entries/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            showToast({ message: '删除成功', status: 'success' });
            // 保留搜索框与已生效筛选
            await refreshIndexEntries(contentManagementProject._id);
        } catch (error) {
            showToast({ message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleClearAllIndexEntries = async () => {
        if (!contentManagementProject) return;
        if (!confirm('确定要清空该项目下所有指标吗？此操作不可恢复！')) return;
        try {
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/index/entries/all?projectId=${contentManagementProject._id}`,
                { method: 'DELETE' }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            showToast({ message: '清空成功', status: 'success' });
            setIndexEntries([]);
        } catch (error) {
            showToast({ message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleUploadIndexEntryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!contentManagementProject || !e.target.files?.[0]) return;
        const file = e.target.files[0];
        setIndexUploading(true);
        setIndexUploadResult(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/index/entries/upload?projectId=${contentManagementProject._id}`,
                { method: 'POST', body: formData }
            );
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `HTTP ${response.status}`);
            }
            const result: IndexUploadResult = await response.json();
            setIndexUploadResult(result);
            const errCount = (result.errors || []).length;
            if (errCount === 0) {
                showToast({
                    message: `导入成功：写入 ${result.upserted} 条，跳过空行 ${result.skippedRows} 行`,
                    status: 'success',
                });
            } else {
                showToast({
                    message: `导入完成：写入 ${result.upserted} 条，跳过 ${result.skippedRows} 行，${errCount} 行错误（详见弹窗）`,
                    status: 'warning',
                });
            }
            await refreshIndexEntries(contentManagementProject._id);
        } catch (error) {
            showToast({ message: `上传失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        } finally {
            setIndexUploading(false);
            e.target.value = '';
        }
    };

    // ============ Org Nodes (机构信息 — 数据源表驱动) ============

    const toTreeNode = (node: any): OrgTreeNode => ({
        key: node.orgCode,
        orgCode: node.orgCode,
        orgName: node.orgName || '',
        brchLv: node.brchLv ?? null,
        dataScope: node.dataScope || 'SELF',
        managementOrg: node.managementOrg ?? null,
        children: (node.children || []).map(toTreeNode),
    });

    const filterOrgTree = (nodes: OrgTreeNode[], q: string): OrgTreeNode[] => {
        const keyword = q.trim();
        if (!keyword) return nodes;
        const walk = (list: OrgTreeNode[]): OrgTreeNode[] => {
            const result: OrgTreeNode[] = [];
            for (const n of list) {
                const children = walk(n.children || []);
                const selfMatch =
                    (n.orgCode || '').includes(keyword) || (n.orgName || '').includes(keyword);
                if (selfMatch || children.length > 0) {
                    result.push({ ...n, children });
                }
            }
            return result;
        };
        return walk(nodes);
    };

    const filteredOrgNodesTree = useMemo(
        () => filterOrgTree(orgNodesTree, orgActiveFilter),
        [orgNodesTree, orgActiveFilter]
    );

    const searchOrgNodes = () => {
        const nextFilter = orgSearchQuery.trim();
        setOrgActiveFilter(nextFilter);
        const filtered = filterOrgTree(orgNodesTree, nextFilter);
        if (nextFilter) {
            showToast({ message: `本地过滤到 ${filtered.length} 个根节点匹配`, status: 'success' });
        }
    };

    const loadOrgNodes = async (projectId: string) => {
        setOrgNodesLoading(true);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes?projectId=${projectId}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const tree = await response.json();
            setOrgNodesTree((tree || []).map(toTreeNode));
            // 同时加载数据快照
            loadOrgDataTimes(projectId);
        } catch {
            setOrgNodesTree([]);
        } finally {
            setOrgNodesLoading(false);
        }
    };

    const handleClearOrgNodes = async () => {
        if (!contentManagementProject) return;
        if (!confirm('将清空该项目下全部机构信息，清空后所有指标问数权限失效。是否继续？')) return;
        try {
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/org/nodes/all?projectId=${contentManagementProject._id}`,
                { method: 'DELETE' }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            showToast({ message: '清空成功', status: 'success' });
            await loadOrgNodes(contentManagementProject._id);
            await loadOrgDataTimes(contentManagementProject._id);
        } catch (error) {
            showToast({ message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' });
        }
    };

    // 修改单个机构的数据权限级别
    const updateOrgNodeBrchLvInTree = (nodes: OrgTreeNode[], orgCode: string, newLv: number): OrgTreeNode[] => {
        return nodes.map((n) => {
            if (n.orgCode === orgCode) {
                return { ...n, brchLv: newLv };
            }
            if (n.children?.length) {
                return { ...n, children: updateOrgNodeBrchLvInTree(n.children, orgCode, newLv) };
            }
            return n;
        });
    };

    const handleUpdateBrchLv = async (node: OrgTreeNode, newLv: number) => {
        if (!contentManagementProject) return;
        if (node.brchLv === newLv) return;
        try {
            const params = new URLSearchParams({
                projectId: contentManagementProject._id,
                orgCode: node.orgCode,
                brchLv: String(newLv),
            });
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes/brch-lv?${params}`, {
                method: 'PUT',
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            const lvLabel = BRCH_LV_OPTIONS.find((o) => o.value === newLv)?.label ?? String(newLv);
            showToast({
                message: `${node.orgCode} 数据权限已更新为 ${lvLabel}`,
                status: 'success',
            });
            // 仅更新本地节点，避免整树刷新导致展开状态丢失
            setOrgNodesTree((prev) => updateOrgNodeBrchLvInTree(prev, node.orgCode, newLv));
        } catch (e) {
            showToast({
                message: `修改失败: ${e instanceof Error ? e.message : '未知错误'}`,
                status: 'error',
            });
        }
    };

    // ─── 机构信息 — 手动增删改 ─────────────────────────────────────────────

    const orgNodeParentOptions = useMemo(() => {
        const walk = (nodes: OrgTreeNode[], result: { value: string; label: string }[]) => {
            for (const n of nodes || []) {
                result.push({ value: n.orgCode, label: `${n.orgCode} ${n.orgName}` });
                walk(n.children, result);
            }
            return result;
        };
        return walk(orgNodesTree, []);
    }, [orgNodesTree]);

    const resetOrgNodeForm = () => {
        setOrgNodeForm({ orgCode: '', orgName: '', parentOrgCode: '', brchLv: '' });
        setOrgNodeEditingCode(null);
    };

    const openAddOrgNode = (parentNode?: OrgTreeNode) => {
        resetOrgNodeForm();
        setOrgNodeForm((prev) => ({
            ...prev,
            parentOrgCode: parentNode?.orgCode || '',
            brchLv: 4,
        }));
        setOrgNodeModalVisible(true);
    };

    const openEditOrgNode = (node: OrgTreeNode) => {
        setOrgNodeEditingCode(node.orgCode);
        setOrgNodeForm({
            orgCode: node.orgCode,
            orgName: node.orgName || '',
            parentOrgCode: node.managementOrg || '',
            brchLv: node.brchLv ?? '',
        });
        setOrgNodeModalVisible(true);
    };

    const handleSaveOrgNode = async () => {
        if (!contentManagementProject) {
            showToast({ message: '请先选择项目', status: 'warning' });
            return;
        }
        const { orgCode, orgName, parentOrgCode, brchLv } = orgNodeForm;
        if (!orgCode.trim() || !orgName.trim() || brchLv === '') {
            showToast({ message: '请填写完整机构信息', status: 'warning' });
            return;
        }
        setOrgNodeFormSubmitting(true);
        try {
            const payload = {
                orgName: orgName.trim(),
                parentOrgCode: parentOrgCode.trim(),
                brchLv: Number(brchLv),
            };
            let response: Response;
            if (orgNodeEditingCode) {
                response = await fetch(
                    `${getDatApiBaseUrl()}/api/v1/org/nodes/${encodeURIComponent(orgNodeEditingCode)}`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: contentManagementProject._id, ...payload }),
                    }
                );
            } else {
                response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: contentManagementProject._id,
                        orgCode: orgCode.trim(),
                        ...payload,
                    }),
                });
            }
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            showToast({ message: orgNodeEditingCode ? '更新成功' : '新增成功', status: 'success' });
            setOrgNodeModalVisible(false);
            resetOrgNodeForm();
            await loadOrgNodes(contentManagementProject._id);
            await loadOrgDataTimes(contentManagementProject._id);
        } catch (e) {
            showToast({
                message: `${orgNodeEditingCode ? '更新' : '新增'}失败: ${e instanceof Error ? e.message : '未知错误'}`,
                status: 'error',
            });
        } finally {
            setOrgNodeFormSubmitting(false);
        }
    };

    const handleDeleteOrgNode = async (node: OrgTreeNode) => {
        if (!contentManagementProject) return;
        const hasChildren = (node.children || []).length > 0;
        const confirmed = window.confirm(
            hasChildren
                ? `该机构 ${node.orgCode} 存在子机构，删除将级联删除整个子树。此操作不可恢复！`
                : `确定删除机构 ${node.orgCode} 吗？此操作不可恢复！`
        );
        if (!confirmed) return;
        try {
            const params = new URLSearchParams({
                projectId: contentManagementProject._id,
                cascade: hasChildren ? 'true' : 'false',
            });
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/org/nodes/${encodeURIComponent(node.orgCode)}?${params}`,
                { method: 'DELETE' }
            );
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            showToast({ message: '删除成功', status: 'success' });
            await loadOrgNodes(contentManagementProject._id);
            await loadOrgDataTimes(contentManagementProject._id);
        } catch (e) {
            showToast({ message: `删除失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        }
    };

    const handleOrgImportFromExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!contentManagementProject || !e.target.files?.[0]) return;
        const file = e.target.files[0];
        setOrgExcelUploading(true);
        try {
            const formData = new FormData();
            formData.append('projectId', contentManagementProject._id);
            formData.append('file', file);
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes/import-excel`, {
                method: 'POST',
                body: formData,
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            showToast({
                message: `Excel 导入成功: ${body.imported} 个机构节点, dataDt=${body.dataDt}`,
                status: 'success',
            });
            await loadOrgNodes(contentManagementProject._id);
            await loadOrgDataTimes(contentManagementProject._id);
        } catch (e) {
            showToast({ message: `Excel 导入失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setOrgExcelUploading(false);
            e.target.value = '';
        }
    };

    // ─── 机构信息 — 从数据源表导入 ──────────────────────────────────────────

    const openOrgTableImportModal = async () => {
        if (!contentManagementProject) {
            showToast({ message: '请先选择项目', status: 'warning' });
            return;
        }
        setOrgTableImportModalVisible(true);
        setOrgTableImportStep('datasource');
        setOrgTableImportSelectedDs('');
        setOrgTableImportTables([]);
        setOrgTableImportSelectedTable('');
        setOrgTableImportColumns(null);
        setOrgTableImportResult(null);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/datasources?projectId=${contentManagementProject._id}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setOrgTableImportDatasources(data || []);
        } catch (e) {
            showToast({ message: `加载数据源列表失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        }
    };

    const onOrgTableImportDsChange = async (dsId: string) => {
        setOrgTableImportSelectedDs(dsId);
        setOrgTableImportSelectedTable('');
        setOrgTableImportColumns(null);
        setOrgTableImportSchemas([]);
        setOrgTableImportSelectedSchema(null);
        setOrgTableImportTables([]);
        if (!dsId) return;
        setOrgTableImportLoading(true);
        try {
            const schemasRes = await fetch(`${getDatApiBaseUrl()}/api/v1/datasources/${dsId}/schemas`);
            if (!schemasRes.ok) throw new Error(`HTTP ${schemasRes.status}`);
            const schemasList: string[] = await schemasRes.json();
            setOrgTableImportSchemas(schemasList || []);

            if (!schemasList || schemasList.length === 0) {
                const tablesRes = await fetch(`${getDatApiBaseUrl()}/api/v1/datasources/${dsId}/tables`);
                if (!tablesRes.ok) throw new Error(`HTTP ${tablesRes.status}`);
                const data = await tablesRes.json();
                setOrgTableImportTables(data || []);
            } else if (schemasList.length === 1) {
                const onlySchema = schemasList[0];
                setOrgTableImportSelectedSchema(onlySchema);
                const tablesRes = await fetch(
                    `${getDatApiBaseUrl()}/api/v1/datasources/${dsId}/schemas/${encodeURIComponent(onlySchema)}/tables`
                );
                if (!tablesRes.ok) throw new Error(`HTTP ${tablesRes.status}`);
                const data = await tablesRes.json();
                setOrgTableImportTables(data || []);
            } else {
                // multiple schemas: wait for user selection
                setOrgTableImportTables([]);
            }
        } catch (e) {
            showToast({ message: `加载 Schema 或表列表失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setOrgTableImportLoading(false);
        }
    };

    const onOrgTableImportSchemaChange = async (schema: string) => {
        setOrgTableImportSelectedSchema(schema || null);
        setOrgTableImportSelectedTable('');
        setOrgTableImportColumns(null);
        setOrgTableImportTables([]);
        if (!schema || !orgTableImportSelectedDs) return;
        setOrgTableImportLoading(true);
        try {
            const tablesRes = await fetch(
                `${getDatApiBaseUrl()}/api/v1/datasources/${orgTableImportSelectedDs}/schemas/${encodeURIComponent(schema)}/tables`
            );
            if (!tablesRes.ok) throw new Error(`HTTP ${tablesRes.status}`);
            const data = await tablesRes.json();
            setOrgTableImportTables(data || []);
        } catch (e) {
            showToast({ message: `加载表列表失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setOrgTableImportLoading(false);
        }
    };

    const onOrgTableImportTableChange = async (tableName: string) => {
        setOrgTableImportSelectedTable(tableName);
        setOrgTableImportColumns(null);
        if (!tableName || !orgTableImportSelectedDs) return;
        setOrgTableImportLoading(true);
        try {
            const qualifiedTable = qualifiedOrgTable(tableName);
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/datasources/${orgTableImportSelectedDs}/tables/${encodeURIComponent(qualifiedTable)}/columns`
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const columns: { name: string; type: string }[] = data.columns || [];
            const colNames = columns.map((c) => c.name.toLowerCase());
            const required = ['data_dt', 'brchno', 'brchna', 'brchup', 'brchlv'];
            const missing = required.filter((r) => !colNames.includes(r));
            const valid = missing.length === 0;
            setOrgTableImportColumns({
                tableName: data.tableName || qualifiedTable,
                columns,
                valid,
                message: valid
                    ? `表 ${qualifiedTable} 包含 ${columns.length} 列，符合 c_par_brch_level 规范`
                    : `表结构不符合 c_par_brch_level 规范，缺少必填列: ${missing.join(', ')}`,
            });
        } catch (e) {
            showToast({ message: `校验表结构失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setOrgTableImportLoading(false);
        }
    };

    const handleOrgImportFromTable = async () => {
        if (!contentManagementProject || !orgTableImportSelectedDs || !orgTableImportSelectedTable) {
            showToast({ message: '请选择数据源和表', status: 'warning' });
            return;
        }
        if (!orgTableImportColumns?.valid) {
            showToast({ message: '表结构校验未通过，无法导入', status: 'warning' });
            return;
        }
        setOrgTableImportLoading(true);
        try {
            const qualifiedTable = qualifiedOrgTable(orgTableImportSelectedTable);
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes/import-from-table`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: contentManagementProject._id,
                    datasourceId: orgTableImportSelectedDs,
                    tableName: qualifiedTable,
                }),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            setOrgTableImportResult(body);
            setOrgTableImportStep('result');
            showToast({
                message: `导入成功: ${body.imported} 个机构节点, dataDt=${body.dataDt}`,
                status: 'success',
            });
            loadOrgNodes(contentManagementProject._id);
        } catch (e) {
            showToast({ message: `导入失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setOrgTableImportLoading(false);
        }
    };

    // ─── 指标库 — 从数据源表导入 ──────────────────────────────────────────

    const openKpiTableImportModal = async () => {
        if (!contentManagementProject) {
            showToast({ message: '请先选择项目', status: 'warning' });
            return;
        }
        setKpiTableImportModalVisible(true);
        setKpiTableImportStep('datasource');
        setKpiTableImportSelectedDs('');
        setKpiTableImportTables([]);
        setKpiTableImportSelectedTable('');
        setKpiTableImportColumns(null);
        setKpiTableImportResult(null);
        setKpiTableImportSchemas([]);
        setKpiTableImportSelectedSchema(null);
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/datasources?projectId=${contentManagementProject._id}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setKpiTableImportDatasources(data || []);
        } catch (e) {
            showToast({ message: `加载数据源列表失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        }
    };

    const onKpiTableImportDsChange = async (dsId: string) => {
        setKpiTableImportSelectedDs(dsId);
        setKpiTableImportSelectedTable('');
        setKpiTableImportColumns(null);
        setKpiTableImportSchemas([]);
        setKpiTableImportSelectedSchema(null);
        setKpiTableImportTables([]);
        if (!dsId) return;
        setKpiTableImportLoading(true);
        try {
            const schemasRes = await fetch(`${getDatApiBaseUrl()}/api/v1/datasources/${dsId}/schemas`);
            if (!schemasRes.ok) throw new Error(`HTTP ${schemasRes.status}`);
            const schemasList: string[] = await schemasRes.json();
            setKpiTableImportSchemas(schemasList || []);

            if (!schemasList || schemasList.length === 0) {
                const tablesRes = await fetch(`${getDatApiBaseUrl()}/api/v1/datasources/${dsId}/tables`);
                if (!tablesRes.ok) throw new Error(`HTTP ${tablesRes.status}`);
                const data = await tablesRes.json();
                setKpiTableImportTables(data || []);
            } else if (schemasList.length === 1) {
                const onlySchema = schemasList[0];
                setKpiTableImportSelectedSchema(onlySchema);
                const tablesRes = await fetch(
                    `${getDatApiBaseUrl()}/api/v1/datasources/${dsId}/schemas/${encodeURIComponent(onlySchema)}/tables`
                );
                if (!tablesRes.ok) throw new Error(`HTTP ${tablesRes.status}`);
                const data = await tablesRes.json();
                setKpiTableImportTables(data || []);
            } else {
                // multiple schemas: wait for user selection
                setKpiTableImportTables([]);
            }
        } catch (e) {
            showToast({ message: `加载 Schema 或表列表失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setKpiTableImportLoading(false);
        }
    };

    const onKpiTableImportSchemaChange = async (schema: string) => {
        setKpiTableImportSelectedSchema(schema || null);
        setKpiTableImportSelectedTable('');
        setKpiTableImportColumns(null);
        setKpiTableImportTables([]);
        if (!schema || !kpiTableImportSelectedDs) return;
        setKpiTableImportLoading(true);
        try {
            const tablesRes = await fetch(
                `${getDatApiBaseUrl()}/api/v1/datasources/${kpiTableImportSelectedDs}/schemas/${encodeURIComponent(schema)}/tables`
            );
            if (!tablesRes.ok) throw new Error(`HTTP ${tablesRes.status}`);
            const data = await tablesRes.json();
            setKpiTableImportTables(data || []);
        } catch (e) {
            showToast({ message: `加载表列表失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setKpiTableImportLoading(false);
        }
    };

    const onKpiTableImportTableChange = async (tableName: string) => {
        setKpiTableImportSelectedTable(tableName);
        setKpiTableImportColumns(null);
        if (!tableName || !kpiTableImportSelectedDs) return;
        setKpiTableImportLoading(true);
        try {
            const qualifiedTable = qualifiedKpiTable(tableName);
            const response = await fetch(
                `${getDatApiBaseUrl()}/api/v1/datasources/${kpiTableImportSelectedDs}/tables/${encodeURIComponent(qualifiedTable)}/columns`
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setKpiTableImportColumns(data);
        } catch (e) {
            showToast({ message: `校验表结构失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setKpiTableImportLoading(false);
        }
    };

    const handleKpiImportFromTable = async () => {
        if (!contentManagementProject || !kpiTableImportSelectedDs || !kpiTableImportSelectedTable) {
            showToast({ message: '请选择数据源和表', status: 'warning' });
            return;
        }
        if (!kpiTableImportColumns?.valid) {
            showToast({ message: '表结构校验未通过，无法导入', status: 'warning' });
            return;
        }
        setKpiTableImportLoading(true);
        try {
            const qualifiedTable = qualifiedKpiTable(kpiTableImportSelectedTable);
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/index/entries/import-from-table`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: contentManagementProject._id,
                    datasourceId: kpiTableImportSelectedDs,
                    tableName: qualifiedTable,
                }),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            setKpiTableImportResult(body);
            setKpiTableImportStep('result');
            showToast({
                message: `导入成功: 写入 ${body.upserted} 条，展开 ${body.totalEntries} 条`,
                status: 'success',
            });
            await refreshIndexEntries(contentManagementProject._id);
        } catch (e) {
            showToast({ message: `导入失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        } finally {
            setKpiTableImportLoading(false);
        }
    };

    // ─── 机构信息 — 数据快照管理 ──────────────────────────────────────────

    const loadOrgDataTimes = async (projectId: string) => {
        try {
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes/datatimes?projectId=${projectId}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setOrgDataTimes(data || []);
            // 同时获取当前激活的快照
            const activeResp = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes/active-data-dt?projectId=${projectId}`);
            if (activeResp.ok) {
                const activeData = await activeResp.json();
                setOrgActiveDataDt(activeData.activeDataDt || '');
                setOrgActiveDtIsManual(activeData.isManual || false);
            }
        } catch {
            // 静默失败，datatimes 不是关键路径
            setOrgDataTimes([]);
            setOrgActiveDataDt('');
            setOrgActiveDtIsManual(false);
        }
    };

    const handleActivateOrgDataDt = async (dataDt: string | null) => {
        if (!contentManagementProject) return;
        try {
            const params = new URLSearchParams({ projectId: contentManagementProject._id });
            if (dataDt) params.append('dataDt', dataDt);
            const response = await fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes/activate-data-dt?${params}`, {
                method: 'PUT',
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.message || `HTTP ${response.status}`);
            }
            showToast({ message: body.message || '快照切换成功', status: 'success' });
            setOrgActiveDataDt(body.activeDataDt || '');
            setOrgActiveDtIsManual(body.isManual || false);
            loadOrgNodes(contentManagementProject._id);
        } catch (e) {
            showToast({ message: `切换快照失败: ${e instanceof Error ? e.message : '未知错误'}`, status: 'error' });
        }
    };

    return (
        <div className="flex h-full flex-col">
            {/* 头部 */}
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-text-primary">项目管理</h2>
                    <p className="mt-1 text-sm text-text-secondary">
                        管理 BecauseAI 项目配置，包括 LLM、Agent、嵌入模型、内容管理等
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        onClick={fetchProjects}
                        disabled={isLoading}
                        className="btn btn-neutral border-token-border-light relative flex items-center gap-2 rounded-lg px-3 py-2"
                    >
                        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                        {isLoading ? '加载中...' : '刷新'}
                    </Button>
                    <Button
                        type="button"
                        onClick={() => {
                            setEditingProject(getDefaultProject());
                            setActiveTab('basic');
                        }}
                        className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
                    >
                        <Plus className="h-4 w-4" />
                        创建项目
                    </Button>
                </div>
            </div>

            {/* 项目列表 */}
            <div className="flex-1 overflow-auto">
                {isLoading ? (
                    <div className="flex h-32 items-center justify-center text-text-secondary">
                        <p className="text-sm">加载中...</p>
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
                        <FolderOpen className="h-8 w-8" />
                        <p className="text-sm">暂无项目</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {projects.map(project => (
                            <div
                                key={project._id}
                                className="rounded-lg border border-border-light bg-surface-primary"
                            >
                                {/* 项目头部 */}
                                <div className="flex items-center justify-between p-4">
                                    <div
                                        className="flex flex-1 cursor-pointer items-center gap-3"
                                        onClick={() => toggleExpand(project._id)}
                                    >
                                        <FolderOpen className="h-5 w-5 text-text-secondary" />
                                        <div className="flex-1">
                                            <h3 className="font-medium text-text-primary">{project.name}</h3>
                                            {project.description && (
                                                <p className="mt-0.5 text-sm text-text-secondary line-clamp-1">
                                                    {project.description}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-text-tertiary">
                                            {project.llms && project.llms.length > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <Server className="h-3 w-3" />
                                                    {project.llms.length} LLM
                                                </span>
                                            )}
                                            {project.agents && project.agents.length > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <Bot className="h-3 w-3" />
                                                    {project.agents.length} Agent
                                                </span>
                                            )}
                                            {project.embedding && (
                                                <span className="flex items-center gap-1">
                                                    <Database className="h-3 w-3" />
                                                    {project.embedding.provider}
                                                </span>
                                            )}
                                        </div>
                                        {expandedProjects.has(project._id) ? (
                                            <ChevronUp className="h-4 w-4 text-text-secondary" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4 text-text-secondary" />
                                        )}
                                    </div>
                                    <div className="ml-4 flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => openContentManagement(project)}
                                            className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover"
                                            title="内容管理"
                                        >
                                            <FileText className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditingProject({ ...project });
                                                setActiveTab('basic');
                                            }}
                                            className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover"
                                            title="编辑"
                                        >
                                            <Edit2 className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => deleteProject(project)}
                                            disabled={deletingId === project._id}
                                            className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                            title="删除"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* 展开详情 */}
                                {expandedProjects.has(project._id) && (
                                    <div className="border-t border-border-light bg-surface-secondary p-4">
                                        {/* Simplified details view */}
                                        <div className="grid gap-4 text-sm md:grid-cols-2">
                                            <div>
                                                <span className="text-text-tertiary">版本:</span>{' '}
                                                <span className="text-text-primary">{project.version}</span>
                                            </div>
                                            <div>
                                                <span className="text-text-tertiary">更新时间:</span>{' '}
                                                <span className="text-text-primary">{formatDate(project.updatedAt)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 编辑/创建 Modal */}
            {editingProject && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
                    <div className="relative flex h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border-light bg-surface-primary shadow-lg overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">
                                {(editingProject as DatProject)._id ? '编辑项目' : '创建项目'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setEditingProject(null)}
                                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-border-light overflow-x-auto">
                            {[
                                { id: 'basic', label: '基本信息' },
                                { id: 'llms', label: '大模型 (LLM)' },
                                { id: 'agents', label: 'Agent 配置' },
                                { id: 'embedding', label: '嵌入配置' },
                                { id: 'content', label: '内容存储' },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as TabType)}
                                    className={cn(
                                        'px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                                        activeTab === tab.id
                                            ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                                            : 'border-transparent text-text-secondary hover:text-text-primary'
                                    )}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6 bg-surface-secondary/30">
                            {/* Basic Tab */}
                            {activeTab === 'basic' && (
                                <div className="space-y-4 max-w-xl">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-text-primary">
                                            项目名称 <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={editingProject.name || ''}
                                            onChange={(e) => updateEditingProject('name', e.target.value)}
                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            placeholder="请输入项目名称"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-text-primary">
                                            项目描述
                                        </label>
                                        <textarea
                                            value={editingProject.description || ''}
                                            onChange={(e) => updateEditingProject('description', e.target.value)}
                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            rows={3}
                                            placeholder="请输入项目描述"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-text-primary">版本号</label>
                                        <input
                                            type="number"
                                            value={editingProject.version || 1}
                                            onChange={(e) => updateEditingProject('version', parseInt(e.target.value) || 1)}
                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            min={1}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* LLMs Tab */}
                            {activeTab === 'llms' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-text-secondary">
                                            LLM 配置列表 ({editingProject.llms?.length || 0})
                                        </span>
                                        <Button size="sm" onClick={addLlm} className="flex items-center gap-1">
                                            <Plus className="h-3 w-3" /> 添加 LLM
                                        </Button>
                                    </div>

                                    <div className="space-y-4">
                                        {editingProject.llms?.map((llm, index) => (
                                            <div key={index} className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm">
                                                <div className="mb-4 flex items-center justify-between border-b border-border-light pb-2">
                                                    <h4 className="font-medium text-text-primary">
                                                        {llm.name || `LLM ${index + 1}`}
                                                    </h4>
                                                    <button
                                                        onClick={() => removeLlm(index)}
                                                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded p-1"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>

                                                <div className="grid gap-4 md:grid-cols-2">
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-text-primary">名称</label>
                                                        <input
                                                            type="text"
                                                            value={llm.name}
                                                            onChange={(e) => updateLlm(index, { name: e.target.value })}
                                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-text-primary">Provider</label>
                                                        <select
                                                            value={llm.provider}
                                                            onChange={(e) => updateLlm(index, { provider: e.target.value, configuration: {} })}
                                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        >
                                                            {getProviderOptions('llm').map(opt => (
                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>

                                                <div className="mt-4">
                                                    <ProviderConfigForm
                                                        config={getProviderConfigDef('llm', llm.provider)}
                                                        value={llm.configuration}
                                                        onChange={(newConfig) => updateLlm(index, { configuration: newConfig })}
                                                        llmOptions={llmOptions}
                                                        platformEndpoints={platformEndpoints}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Agents Tab */}
                            {activeTab === 'agents' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-text-secondary">
                                            Agent 配置列表 ({editingProject.agents?.length || 0})
                                        </span>
                                        <Button size="sm" onClick={addAgent} className="flex items-center gap-1">
                                            <Plus className="h-3 w-3" /> 添加 Agent
                                        </Button>
                                    </div>

                                    <div className="space-y-4">
                                        {editingProject.agents?.map((agent, index) => (
                                            <div key={index} className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm">
                                                <div className="mb-4 flex items-center justify-between border-b border-border-light pb-2">
                                                    <h4 className="font-medium text-text-primary">
                                                        {agent.name || `Agent ${index + 1}`}
                                                    </h4>
                                                    <button
                                                        onClick={() => removeAgent(index)}
                                                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded p-1"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>

                                                <div className="grid gap-4 md:grid-cols-3 mb-4">
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-text-primary">名称</label>
                                                        <input
                                                            type="text"
                                                            value={agent.name}
                                                            onChange={(e) => updateAgent(index, { name: e.target.value })}
                                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-text-primary">Provider</label>
                                                        <select
                                                            value={agent.provider}
                                                            onChange={(e) => updateAgent(index, { provider: e.target.value, configuration: {} })}
                                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        >
                                                            {getProviderOptions('agent').map(opt => (
                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-text-primary">描述</label>
                                                        <input
                                                            type="text"
                                                            value={agent.description || ''}
                                                            onChange={(e) => updateAgent(index, { description: e.target.value })}
                                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="mb-4">
                                                    <label className="mb-1 block text-sm font-medium text-text-primary">Semantic Models (逗号分隔)</label>
                                                    <input
                                                        type="text"
                                                        value={agent.semantic_models?.join(', ') || ''}
                                                        onChange={(e) => updateAgent(index, {
                                                            semantic_models: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                                        })}
                                                        placeholder="model1, model2"
                                                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                    />
                                                </div>

                                                <div className="border-t border-border-light pt-4">
                                                    <h5 className="mb-3 text-sm font-medium text-text-primary">配置参数</h5>
                                                    <ProviderConfigForm
                                                        config={getProviderConfigDef('agent', agent.provider)}
                                                        value={agent.configuration}
                                                        onChange={(newConfig) => updateAgent(index, { configuration: newConfig })}
                                                        llmOptions={llmOptions}
                                                    />
                                                </div>

                                                {agent.provider === 'agentic' && (
                                                    <div className="mt-6 space-y-4 border-t border-border-light pt-4">
                                                        <h5 className="text-sm font-medium text-text-primary">高级配置</h5>
                                                        <EmailSenderConfig
                                                            value={agent.configuration['email-sender']}
                                                            onChange={(val) => {
                                                                const newConfig = { ...agent.configuration, 'email-sender': val };
                                                                updateAgent(index, { configuration: newConfig });
                                                            }}
                                                        />
                                                        <McpServersConfig
                                                            value={agent.configuration['mcp-servers']}
                                                            onChange={(val) => {
                                                                const newConfig = { ...agent.configuration, 'mcp-servers': val };
                                                                updateAgent(index, { configuration: newConfig });
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Embedding Tab */}
                            {activeTab === 'embedding' && (
                                <div className="space-y-8 max-w-3xl">
                                    {/* Embedding Model */}
                                    <div className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm">
                                        <h4 className="mb-4 text-base font-medium text-text-primary border-b border-border-light pb-2">
                                            嵌入模型配置
                                        </h4>
                                        <div className="mb-4">
                                            <label className="mb-1 block text-sm font-medium text-text-primary">供应商</label>
                                            <select
                                                value={editingProject.embedding?.provider}
                                                onChange={(e) => updateEditingProject('embedding', { provider: e.target.value, configuration: {} })}
                                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            >
                                                {getProviderOptions('embedding').map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {editingProject.embedding && (
                                            <ProviderConfigForm
                                                config={getProviderConfigDef('embedding', editingProject.embedding.provider)}
                                                value={editingProject.embedding.configuration || {}}
                                                onChange={(newConfig) => updateEditingProject('embedding', { ...editingProject.embedding, configuration: newConfig })}
                                                llmOptions={llmOptions}
                                            />
                                        )}
                                    </div>

                                    {/* Embedding Store */}
                                    <div className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm">
                                        <h4 className="mb-4 text-base font-medium text-text-primary border-b border-border-light pb-2">
                                            嵌入存储模型配置
                                        </h4>
                                        <div className="mb-4">
                                            <label className="mb-1 block text-sm font-medium text-text-primary">供应商</label>
                                            <select
                                                value={editingProject.embedding_store?.provider}
                                                onChange={(e) => updateEditingProject('embedding_store', { provider: e.target.value, configuration: {} })}
                                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            >
                                                {getProviderOptions('embedding_store').map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {editingProject.embedding_store && (
                                            <ProviderConfigForm
                                                config={getProviderConfigDef('embedding_store', editingProject.embedding_store.provider)}
                                                value={editingProject.embedding_store.configuration || {}}
                                                onChange={(newConfig) => updateEditingProject('embedding_store', { ...editingProject.embedding_store, configuration: newConfig })}
                                                llmOptions={llmOptions}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Content & Reranking Tab */}
                            {activeTab === 'content' && (
                                <div className="space-y-8 max-w-3xl">
                                    {/* Content Store */}
                                    <div className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm">
                                        <h4 className="mb-4 text-base font-medium text-text-primary border-b border-border-light pb-2">
                                            内容存储配置
                                        </h4>
                                        <div className="mb-4">
                                            <label className="mb-1 block text-sm font-medium text-text-primary">Provider</label>
                                            <select
                                                value={editingProject.content_store?.provider}
                                                onChange={(e) => updateEditingProject('content_store', { provider: e.target.value, configuration: {} })}
                                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            >
                                                {getProviderOptions('content_store').map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {editingProject.content_store && (
                                            <ProviderConfigForm
                                                config={getProviderConfigDef('content_store', editingProject.content_store.provider)}
                                                value={editingProject.content_store.configuration || {}}
                                                onChange={(newConfig) => updateEditingProject('content_store', { ...editingProject.content_store, configuration: newConfig })}
                                                llmOptions={llmOptions}
                                            />
                                        )}
                                    </div>

                                    {/* Reranking */}
                                    <div className="rounded-lg border border-border-light bg-surface-primary p-4 shadow-sm">
                                        <h4 className="mb-4 text-base font-medium text-text-primary border-b border-border-light pb-2">
                                            重排序模型
                                        </h4>
                                        <div className="mb-4">
                                            <label className="mb-1 block text-sm font-medium text-text-primary">供应商</label>
                                            <select
                                                value={editingProject.reranking?.provider}
                                                onChange={(e) => updateEditingProject('reranking', { provider: e.target.value, configuration: {} })}
                                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            >
                                                <option value="">(无)</option>
                                                {getProviderOptions('reranking').map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {editingProject.reranking && editingProject.reranking.provider && (
                                            <ProviderConfigForm
                                                config={getProviderConfigDef('reranking', editingProject.reranking.provider)}
                                                value={editingProject.reranking.configuration || {}}
                                                onChange={(newConfig) => updateEditingProject('reranking', { ...editingProject.reranking, configuration: newConfig })}
                                                llmOptions={llmOptions}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 border-t border-border-light bg-surface-primary p-4">
                            <Button
                                type="button"
                                onClick={() => setEditingProject(null)}
                                className="btn btn-neutral rounded-lg px-4 py-2"
                            >
                                取消
                            </Button>
                            <Button
                                type="button"
                                onClick={saveProject}
                                disabled={isSaving}
                                className="btn btn-primary rounded-lg px-4 py-2"
                            >
                                {isSaving ? '保存中...' : '保存'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Content Management Modal */}
            {contentManagementProject && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
                    <div className="relative flex h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-border-light bg-surface-primary shadow-lg overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-text-secondary" />
                                <div>
                                    <h3 className="text-lg font-semibold text-text-primary">内容管理</h3>
                                    <p className="text-xs text-text-tertiary">{contentManagementProject.name}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeContentManagement}
                                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-border-light px-4">
                            <button
                                type="button"
                                onClick={() => handleContentTabChange('sql-pairs')}
                                className={cn(
                                    "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors flex items-center gap-1.5",
                                    contentActiveTab === 'sql-pairs'
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-text-secondary hover:text-text-primary"
                                )}
                            >
                                <Code className="h-4 w-4" />
                                SQL 示例对
                            </button>
                            <button
                                type="button"
                                onClick={() => handleContentTabChange('synonyms')}
                                className={cn(
                                    "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors flex items-center gap-1.5",
                                    contentActiveTab === 'synonyms'
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-text-secondary hover:text-text-primary"
                                )}
                            >
                                <ArrowLeftRight className="h-4 w-4" />
                                同义词
                            </button>
                            <button
                                type="button"
                                onClick={() => handleContentTabChange('docs')}
                                className={cn(
                                    "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors flex items-center gap-1.5",
                                    contentActiveTab === 'docs'
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-text-secondary hover:text-text-primary"
                                )}
                            >
                                <FileText className="h-4 w-4" />
                                业务知识
                            </button>
                            <button
                                type="button"
                                onClick={() => handleContentTabChange('index-entries')}
                                className={cn(
                                    "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors flex items-center gap-1.5",
                                    contentActiveTab === 'index-entries'
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-text-secondary hover:text-text-primary"
                                )}
                            >
                                <Tag className="h-4 w-4" />
                                指标库
                            </button>
                            <button
                                type="button"
                                onClick={() => handleContentTabChange('org-nodes')}
                                className={cn(
                                    "px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors flex items-center gap-1.5",
                                    contentActiveTab === 'org-nodes'
                                        ? "border-blue-500 text-blue-600"
                                        : "border-transparent text-text-secondary hover:text-text-primary"
                                )}
                            >
                                <Network className="h-4 w-4" />
                                机构信息
                                {!orgActiveDataDt && orgDataTimes.length === 0 && (
                                    <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-orange-500" title="尚未导入机构数据" />
                                )}
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 overflow-auto p-4">
                            {/* SQL Pairs Tab */}
                            {contentActiveTab === 'sql-pairs' && (
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                                                <input
                                                    type="text"
                                                    value={sqlSearchQuery}
                                                    onChange={(e) => setSqlSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && searchSqlPairs()}
                                                    placeholder="输入问题检索相关SQL..."
                                                    className="w-72 pl-8 pr-3 py-2 text-sm rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                />
                                            </div>
                                            <Button onClick={searchSqlPairs} className="btn btn-neutral text-sm">
                                                检索
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button onClick={() => setSqlModalVisible(true)} className="btn btn-primary text-sm flex items-center gap-1">
                                                <Plus className="h-4 w-4" /> 添加
                                            </Button>
                                            <Button
                                                onClick={handleClearAllSqlPairs}
                                                disabled={sqlPairs.length === 0}
                                                className="btn btn-neutral text-sm text-red-500 disabled:opacity-50"
                                            >
                                                清空全部
                                            </Button>
                                        </div>
                                    </div>
                                    {contentLoading ? (
                                        <div className="flex h-40 items-center justify-center text-text-secondary">
                                            <p className="text-sm">加载中...</p>
                                        </div>
                                    ) : sqlPairs.length === 0 ? (
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-secondary">
                                            <Code className="h-8 w-8" />
                                            <p className="text-sm">暂无SQL示例对</p>
                                        </div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-sm border-collapse text-white">
                                          <thead>
                                          <tr className="bg-surface-secondary">
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-2/5 text-white">问题</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium text-white">SQL</th>
                                            <th className="border border-border-light px-3 py-2 text-center font-medium w-16 text-white">操作</th>
                                          </tr>
                                          </thead>
                                          <tbody>
                                          {sqlPairs.map((item, idx) => (
                                            <tr key={item.id} className={idx % 2 === 0 ? 'bg-surface-primary' : 'bg-surface-secondary/50'}>
                                              <td className="border border-border-light px-3 py-2 text-white">{item.question}</td>
                                              <td className="border border-border-light px-3 py-2 text-white">
                                                <code className="text-xs font-mono text-white bg-gray-800/60 px-1.5 py-0.5 rounded">
                                                  {item.sql}
                                                </code>
                                              </td>
                                              <td className="border border-border-light px-3 py-2 text-center">
                                                <button
                                                  onClick={() => {
                                                    if (confirm('确定删除此项吗？')) handleRemoveSqlPair(item.id);
                                                  }}
                                                  className="text-red-400 hover:text-red-300 transition-colors"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                </div>
                            )}

                            {/* Synonyms Tab */}
                            {contentActiveTab === 'synonyms' && (
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                                                <input
                                                    type="text"
                                                    value={synSearchQuery}
                                                    onChange={(e) => setSynSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && searchSynonyms()}
                                                    placeholder="输入词语检索相关同义词..."
                                                    className="w-72 pl-8 pr-3 py-2 text-sm rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                />
                                            </div>
                                            <Button onClick={searchSynonyms} className="btn btn-neutral text-sm">
                                                检索
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button onClick={() => setSynModalVisible(true)} className="btn btn-primary text-sm flex items-center gap-1">
                                                <Plus className="h-4 w-4" /> 添加
                                            </Button>
                                            <Button
                                                onClick={handleClearAllSynonyms}
                                                disabled={synonyms.length === 0}
                                                className="btn btn-neutral text-sm text-red-500 disabled:opacity-50"
                                            >
                                                清空全部
                                            </Button>
                                        </div>
                                    </div>
                                    {contentLoading ? (
                                        <div className="flex h-40 items-center justify-center text-text-secondary">
                                            <p className="text-sm">加载中...</p>
                                        </div>
                                    ) : synonyms.length === 0 ? (
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-secondary">
                                            <ArrowLeftRight className="h-8 w-8" />
                                            <p className="text-sm">暂无同义词</p>
                                        </div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-sm border-collapse text-white">
                                          <thead>
                                          <tr className="bg-surface-secondary">
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-32 text-white">词</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium text-white">同义词</th>
                                            <th className="border border-border-light px-3 py-2 text-center font-medium w-16 text-white">操作</th>
                                          </tr>
                                          </thead>
                                          <tbody>
                                          {synonyms.map((item, idx) => (
                                            <tr key={item.id} className={idx % 2 === 0 ? 'bg-surface-primary' : 'bg-surface-secondary/50'}>
                                              <td className="border border-border-light px-3 py-2 font-medium text-white">{item.word}</td>
                                              <td className="border border-border-light px-3 py-2 text-white">
                                                <div className="flex flex-wrap gap-1">
                                                  {item.synonyms.map((syn, i) => (
                                                    <span key={i} className="inline-flex items-center rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300 ring-1 ring-inset ring-blue-500/20">
                                    {syn}
                                </span>
                                                  ))}
                                                </div>
                                              </td>
                                              <td className="border border-border-light px-3 py-2 text-center">
                                                <button
                                                  onClick={() => {
                                                    if (confirm('确定删除此项吗？')) handleRemoveSynonym(item.id);
                                                  }}
                                                  className="text-red-400 hover:text-red-300 transition-colors"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                </div>
                            )}

                            {/* Docs Tab */}
                            {contentActiveTab === 'docs' && (
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                                                <input
                                                    type="text"
                                                    value={docSearchQuery}
                                                    onChange={(e) => setDocSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && searchDocs()}
                                                    placeholder="输入关键词检索相关知识..."
                                                    className="w-72 pl-8 pr-3 py-2 text-sm rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                />
                                            </div>
                                            <Button onClick={searchDocs} className="btn btn-neutral text-sm">
                                                检索
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button onClick={() => setDocModalVisible(true)} className="btn btn-primary text-sm flex items-center gap-1">
                                                <Plus className="h-4 w-4" /> 添加文本
                                            </Button>
                                            <label className="btn btn-neutral text-sm flex items-center gap-1 cursor-pointer">
                                                <Upload className="h-4 w-4" />
                                                {uploading ? '上传中...' : '上传文件'}
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    accept=".txt,.md,.pdf,.doc,.docx,.html,.xml,.json,.csv"
                                                    onChange={handleFileUpload}
                                                    disabled={uploading}
                                                />
                                            </label>
                                            <Button
                                                onClick={handleClearAllDocs}
                                                disabled={docs.length === 0}
                                                className="btn btn-neutral text-sm text-red-500 disabled:opacity-50"
                                            >
                                                清空全部
                                            </Button>
                                        </div>
                                    </div>
                                    {contentLoading ? (
                                        <div className="flex h-40 items-center justify-center text-text-secondary">
                                            <p className="text-sm">加载中...</p>
                                        </div>
                                    ) : docs.length === 0 ? (
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-secondary">
                                            <Inbox className="h-8 w-8" />
                                            <p className="text-sm">暂无业务知识</p>
                                        </div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-sm border-collapse text-white">
                                          <thead>
                                          <tr className="bg-surface-secondary">
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-16 text-white">序号</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium text-white">内容</th>
                                            <th className="border border-border-light px-3 py-2 text-center font-medium w-16 text-white">操作</th>
                                          </tr>
                                          </thead>
                                          <tbody>
                                          {docs.map((item, idx) => (
                                            <tr
                                              key={item.id}
                                              className={idx % 2 === 0 ? 'bg-surface-primary' : 'bg-surface-secondary/50'}
                                            >
                                              <td className="border border-border-light px-3 py-2 text-center text-white">{idx + 1}</td>
                                              <td className="border border-border-light px-3 py-2 text-white">
                                                <p className="line-clamp-2 text-white">{item.content}</p>
                                              </td>
                                              <td className="border border-border-light px-3 py-2 text-center">
                                                <button
                                                  onClick={() => {
                                                    if (confirm('确定删除此项吗？')) handleRemoveDoc(item.id);
                                                  }}
                                                  className="text-red-500 hover:text-red-600"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                </div>
                            )}

                            {/* Index Entries Tab (指标库) */}
                            {contentActiveTab === 'index-entries' && (
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                                                <input
                                                    type="text"
                                                    value={indexSearchQuery}
                                                    onChange={(e) => setIndexSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && searchIndexEntries()}
                                                    placeholder="按编码 / 名称 / 别名过滤..."
                                                    className="w-72 pl-8 pr-3 py-2 text-sm rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                />
                                            </div>
                                            <Button onClick={searchIndexEntries} className="btn btn-neutral text-sm">
                                                检索
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button onClick={openAddIndexEntry} className="btn btn-primary text-sm flex items-center gap-1">
                                                <Plus className="h-4 w-4" /> 添加
                                            </Button>
                                            <Button
                                                onClick={openKpiTableImportModal}
                                                disabled={!contentManagementProject}
                                                className="btn btn-neutral text-sm flex items-center gap-1 disabled:opacity-50"
                                            >
                                                <Database className="h-4 w-4" /> 从数据源导入
                                            </Button>
                                            <Button
                                                onClick={() => setIndexUploadModalVisible(true)}
                                                className="btn btn-neutral text-sm flex items-center gap-1"
                                            >
                                                <Upload className="h-4 w-4" /> 上传 Excel
                                            </Button>
                                            <Button
                                                onClick={handleClearAllIndexEntries}
                                                disabled={indexEntries.length === 0}
                                                className="btn btn-neutral text-sm text-red-500 disabled:opacity-50"
                                            >
                                                清空全部
                                            </Button>
                                        </div>
                                    </div>
                                    {contentLoading ? (
                                        <div className="flex h-40 items-center justify-center text-text-secondary">
                                            <p className="text-sm">加载中...</p>
                                        </div>
                                    ) : indexEntries.length === 0 ? (
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-secondary">
                                            <Tag className="h-8 w-8" />
                                            <p className="text-sm">暂无指标</p>
                                        </div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-sm border-collapse text-white">
                                          <thead>
                                          <tr className="bg-surface-secondary">
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-32 text-white">指标编码</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-48 text-white">指标名称</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium text-white">别名</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-24 text-white">来源</th>
                                            <th className="border border-border-light px-3 py-2 text-left font-medium w-20 text-white">频度</th>
                                            <th className="border border-border-light px-3 py-2 text-center font-medium w-28 text-white">操作</th>
                                          </tr>
                                          </thead>
                                          <tbody>
                                          {indexEntries.map((item, idx) => (
                                            <tr key={item.id} className={idx % 2 === 0 ? 'bg-surface-primary' : 'bg-surface-secondary/50'}>
                                              <td className="border border-border-light px-3 py-2 font-mono text-xs text-white">{item.indexNumber}</td>
                                              <td className="border border-border-light px-3 py-2 text-white">{item.standardName}</td>
                                              <td className="border border-border-light px-3 py-2">
                                                {item.aliases && item.aliases.length > 0 ? (
                                                  <div className="flex flex-wrap gap-1">
                                                    {item.aliases.map((al) => (
                                                      <span
                                                        key={al}
                                                        className="inline-flex items-center rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-300"
                                                      >
                                                        {al}
                                                      </span>
                                                    ))}
                                                  </div>
                                                ) : (
                                                  <span className="text-text-tertiary">-</span>
                                                )}
                                              </td>
                                              <td className="border border-border-light px-3 py-2">
                                                {item.source != null ? (
                                                  <span className="inline-flex items-center rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-300">
                                                    {sourceLabel(item.source)}
                                                  </span>
                                                ) : (
                                                  <span className="text-text-tertiary">-</span>
                                                )}
                                              </td>
                                              <td className="border border-border-light px-3 py-2">
                                                {item.frequency ? (
                                                  <span className="inline-flex items-center rounded bg-purple-500/15 px-1.5 py-0.5 text-xs text-purple-300">
                                                    {item.frequency}
                                                  </span>
                                                ) : (
                                                  <span className="text-text-tertiary">-</span>
                                                )}
                                              </td>
                                              <td className="border border-border-light px-3 py-2 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                  <button
                                                    onClick={() => openEditIndexEntry(item)}
                                                    className="text-blue-400 hover:text-blue-300"
                                                    title="编辑"
                                                  >
                                                    <Edit2 className="h-4 w-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      if (confirm('确定删除此项吗？')) handleRemoveIndexEntry(item.id);
                                                    }}
                                                    className="text-red-500 hover:text-red-600"
                                                    title="删除"
                                                  >
                                                    <Trash2 className="h-4 w-4" />
                                                  </button>
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                </div>
                            )}

                            {/* Org Nodes Tab (机构信息 — 数据源表驱动) */}
                            {contentActiveTab === 'org-nodes' && (
                                <div className="rounded-lg border border-border-light bg-surface-secondary/40 p-4">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-semibold text-text-primary">机构信息</h4>
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                                                <input
                                                    type="text"
                                                    value={orgSearchQuery}
                                                    onChange={(e) => setOrgSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && searchOrgNodes()}
                                                    placeholder="按机构编码 / 名称过滤..."
                                                    className="w-64 rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                />
                                            </div>
                                            <Button onClick={searchOrgNodes} className="btn btn-neutral text-xs px-3 py-1.5">
                                                检索
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => openAddOrgNode()}
                                                disabled={!contentManagementProject}
                                                className="btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                                            >
                                                <Plus className="h-3.5 w-3.5" /> 添加机构
                                            </button>
                                            <label
                                                className={cn(
                                                    'btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer',
                                                    orgExcelUploading && 'opacity-60 cursor-not-allowed'
                                                )}
                                            >
                                                <Upload className="h-3.5 w-3.5" />
                                                {orgExcelUploading ? '上传中...' : '上传 Excel'}
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    accept=".xlsx"
                                                    disabled={orgExcelUploading || !contentManagementProject}
                                                    onChange={handleOrgImportFromExcel}
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                onClick={openOrgTableImportModal}
                                                disabled={!contentManagementProject}
                                                className="btn btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
                                            >
                                                <Database className="h-3.5 w-3.5" /> 从数据源导入
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleClearOrgNodes}
                                                disabled={!contentManagementProject}
                                                className="btn btn-neutral text-xs text-red-500 disabled:opacity-50 flex items-center gap-1 px-2 py-1.5"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" /> 清空机构信息
                                            </button>
                                        </div>
                                    </div>

                                    {/* 快照切换器 */}
                                    {orgDataTimes.length > 0 && (
                                        <div className="mb-3">
                                            <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
                                                <span>当前快照：</span>
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                        orgActiveDtIsManual
                                                            ? 'bg-orange-500/15 text-orange-400 ring-1 ring-inset ring-orange-500/20'
                                                            : 'bg-blue-500/15 text-blue-400 ring-1 ring-inset ring-blue-500/20'
                                                    )}
                                                >
                                                    {orgActiveDtIsManual ? '📌' : '🕐'} {orgActiveDataDt || '最新'}
                                                </span>
                                                <span
                                                    title="通过 c_par_brch_level 表的 data_dt 列管理快照"
                                                    className="cursor-help text-xs"
                                                >
                                                    ⓘ
                                                </span>
                                            </div>
                                            <div className="mb-1.5 flex items-center gap-1 text-xs text-text-tertiary">
                                                数据快照切换
                                                <span
                                                    title="点击快照日期切换到该历史版本；切换后数据权限立即生效"
                                                    className="cursor-help ml-0.5"
                                                >
                                                    ⓘ
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {orgDataTimes.map((dt) => (
                                                    <button
                                                        key={dt}
                                                        type="button"
                                                        onClick={() => handleActivateOrgDataDt(dt)}
                                                        className={cn(
                                                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                                                            dt === orgActiveDataDt && orgActiveDtIsManual
                                                                ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30'
                                                                : dt === orgActiveDataDt
                                                                    ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                                                                    : 'bg-surface-secondary text-text-tertiary hover:bg-surface-hover hover:text-text-secondary'
                                                        )}
                                                    >
                                                        {dt}
                                                    </button>
                                                ))}
                                            </div>
                                            {orgActiveDtIsManual && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleActivateOrgDataDt('')}
                                                    className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400"
                                                >
                                                    <RotateCw className="h-3 w-3" /> 恢复自动（最新）
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {/* 分隔线 */}
                                    {orgDataTimes.length > 0 && orgNodesTree.length > 0 && (
                                        <div className="my-3 border-t border-border-light" />
                                    )}

                                    {/* 机构树预览 */}
                                    {orgNodesLoading ? (
                                        <div className="flex h-40 items-center justify-center text-sm text-text-secondary">
                                            加载中...
                                        </div>
                                    ) : filteredOrgNodesTree.length > 0 ? (
                                        <div className="max-h-[400px] overflow-auto text-sm">
                                            <OrgTreeView
                                                nodes={filteredOrgNodesTree}
                                                onUpdateBrchLv={handleUpdateBrchLv}
                                                onAddChild={openAddOrgNode}
                                                onEdit={openEditOrgNode}
                                                onDelete={handleDeleteOrgNode}
                                            />
                                        </div>
                                    ) : orgNodesTree.length > 0 && orgActiveFilter ? (
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-secondary">
                                            <Network className="h-8 w-8" />
                                            <p className="text-sm">无匹配机构</p>
                                        </div>
                                    ) : (
                                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-secondary">
                                            <Network className="h-8 w-8" />
                                            <p className="text-sm">尚未从数据源导入机构信息</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* SQL Pair Add Modal */}
            {sqlModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">添加 SQL 示例对</h3>
                            <button onClick={() => setSqlModalVisible(false)} className="rounded p-1 text-text-secondary hover:bg-surface-hover">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">问题 <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={sqlForm.question}
                                    onChange={(e) => setSqlForm(prev => ({ ...prev, question: e.target.value }))}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    placeholder="例如：本月销售额是多少？"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">SQL <span className="text-red-500">*</span></label>
                                <textarea
                                    value={sqlForm.sql}
                                    onChange={(e) => setSqlForm(prev => ({ ...prev, sql: e.target.value }))}
                                    rows={4}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    placeholder="例如：SELECT SUM(amount) FROM sales WHERE month = CURRENT_MONTH"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-border-light p-4">
                            <Button onClick={() => setSqlModalVisible(false)} className="btn btn-neutral">取消</Button>
                            <Button onClick={handleAddSqlPair} className="btn btn-primary">确定</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Synonym Add Modal */}
            {synModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">添加同义词</h3>
                            <button onClick={() => setSynModalVisible(false)} className="rounded p-1 text-text-secondary hover:bg-surface-hover">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">词 <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={synForm.word}
                                    onChange={(e) => setSynForm(prev => ({ ...prev, word: e.target.value }))}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    placeholder="例如：销售额"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">同义词（多个用逗号分隔） <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={synForm.synonyms}
                                    onChange={(e) => setSynForm(prev => ({ ...prev, synonyms: e.target.value }))}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    placeholder="例如：营收,营业额,销售收入"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-border-light p-4">
                            <Button onClick={() => setSynModalVisible(false)} className="btn btn-neutral">取消</Button>
                            <Button onClick={handleAddSynonym} className="btn btn-primary">确定</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Doc Add Modal */}
            {docModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">添加业务知识</h3>
                            <button onClick={() => setDocModalVisible(false)} className="rounded p-1 text-text-secondary hover:bg-surface-hover">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">知识内容 <span className="text-red-500">*</span></label>
                                <textarea
                                    value={docForm.content}
                                    onChange={(e) => setDocForm(prev => ({ ...prev, content: e.target.value }))}
                                    rows={6}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    placeholder="输入业务知识、术语定义或规则说明..."
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-border-light p-4">
                            <Button onClick={() => setDocModalVisible(false)} className="btn btn-neutral">取消</Button>
                            <Button onClick={handleAddDoc} className="btn btn-primary">确定</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Index Entry Add / Edit Modal */}
            {indexModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-xl rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">
                                {indexEditingId ? '编辑指标' : '添加指标'}
                            </h3>
                            <button onClick={() => setIndexModalVisible(false)} className="rounded p-1 text-text-secondary hover:bg-surface-hover">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4 p-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">
                                    指标编码 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={indexForm.indexNumber}
                                    onChange={(e) => setIndexForm((prev) => ({ ...prev, indexNumber: e.target.value }))}
                                    disabled={!!indexEditingId}
                                    placeholder="例如：KPI0001"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-800"
                                />
                                {indexEditingId && (
                                    <p className="mt-1 text-xs text-text-tertiary">编码作为唯一标识，编辑模式下不可修改</p>
                                )}
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">
                                    指标名称 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={indexForm.standardName}
                                    onChange={(e) => setIndexForm((prev) => ({ ...prev, standardName: e.target.value }))}
                                    placeholder="例如：各项存款余额"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">别名</label>
                                <input
                                    type="text"
                                    value={indexForm.aliases}
                                    onChange={(e) => setIndexForm((prev) => ({ ...prev, aliases: e.target.value }))}
                                    placeholder='多个用 "/" 分隔，例如：存款余额/总存款'
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                                <p className="mt-1 text-xs text-text-tertiary">等于指标名称的别名会自动去重剔除</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-text-primary">指标来源</label>
                                    <select
                                        value={indexForm.source ?? ''}
                                        onChange={(e) =>
                                            setIndexForm((prev) => ({
                                                ...prev,
                                                source: e.target.value === '' ? undefined : Number(e.target.value),
                                            }))
                                        }
                                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    >
                                        <option value="">选择来源口径</option>
                                        <option value="1">人行口径</option>
                                        <option value="2">银监口径</option>
                                        <option value="3">省联社口径</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-text-primary">指标频度</label>
                                    <select
                                        value={indexForm.frequency || ''}
                                        onChange={(e) => setIndexForm((prev) => ({ ...prev, frequency: e.target.value }))}
                                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    >
                                        <option value="">选择频度</option>
                                        <option value="日">日</option>
                                        <option value="旬">旬</option>
                                        <option value="月">月</option>
                                        <option value="季">季</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-border-light p-4">
                            <Button onClick={() => setIndexModalVisible(false)} className="btn btn-neutral">取消</Button>
                            <Button onClick={handleSaveIndexEntry} className="btn btn-primary">
                                {indexEditingId ? '更新' : '添加'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Index Entry Excel Upload Modal */}
            {indexUploadModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-2xl rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">上传指标库 Excel</h3>
                            <button
                                onClick={() => {
                                    setIndexUploadModalVisible(false);
                                    setIndexUploadResult(null);
                                }}
                                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-3 p-4">
                            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border-light px-6 py-10 text-text-secondary hover:border-blue-400 hover:text-blue-500">
                                <Inbox className="h-10 w-10" />
                                <span className="text-sm">{indexUploading ? '正在解析与入库...' : '点击选择 .xlsx 文件上传'}</span>
                                <span className="text-xs text-text-tertiary">必填：指标编码 / 指标名称；可选：别名（/ 分隔）、来源、频度</span>
                                <input
                                    type="file"
                                    className="hidden"
                                    accept=".xlsx,.xls"
                                    disabled={indexUploading}
                                    onChange={handleUploadIndexEntryFile}
                                />
                            </label>
                            {indexUploadResult && (
                                <div className="rounded-md border border-border-light bg-surface-secondary/40 p-3 text-sm">
                                    <div className="mb-2 grid grid-cols-3 gap-2 text-center">
                                        <div>
                                            <div className="text-xs text-text-tertiary">写入条数</div>
                                            <div className="text-lg font-semibold text-green-500">{indexUploadResult.upserted}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-text-tertiary">跳过空行</div>
                                            <div className="text-lg font-semibold text-text-primary">{indexUploadResult.skippedRows}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-text-tertiary">错误行数</div>
                                            <div className={cn('text-lg font-semibold', (indexUploadResult.errors || []).length > 0 ? 'text-red-500' : 'text-text-primary')}>
                                                {(indexUploadResult.errors || []).length}
                                            </div>
                                        </div>
                                    </div>
                                    {(indexUploadResult.errors || []).length > 0 && (
                                        <div className="max-h-48 overflow-auto">
                                            <table className="w-full text-xs border-collapse">
                                                <thead>
                                                <tr className="bg-surface-secondary">
                                                    <th className="border border-border-light px-2 py-1 text-left w-20">行号</th>
                                                    <th className="border border-border-light px-2 py-1 text-left">错误信息</th>
                                                </tr>
                                                </thead>
                                                <tbody>
                                                {indexUploadResult.errors.map((err, i) => (
                                                    <tr key={i}>
                                                        <td className="border border-border-light px-2 py-1 font-mono">{err.rowNumber}</td>
                                                        <td className="border border-border-light px-2 py-1 text-red-500">{err.message}</td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* KPI Table Import Modal (从数据源表导入指标库) */}
            {kpiTableImportModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-2xl rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">从数据源表导入指标库</h3>
                            <button
                                onClick={() => {
                                    setKpiTableImportModalVisible(false);
                                    setKpiTableImportResult(null);
                                }}
                                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Steps indicator */}
                        <div className="flex items-center border-b border-border-light px-4 py-3">
                            {[
                                { key: 'datasource', label: '选择数据源', step: 0 },
                                { key: 'table', label: '选择表并校验', step: 1 },
                                { key: 'result', label: '导入完成', step: 2 },
                            ].map((s) => {
                                const currentStep =
                                    kpiTableImportStep === 'datasource' ? 0 : kpiTableImportStep === 'table' ? 1 : 2;
                                return (
                                    <div key={s.key} className="flex items-center">
                                        <div
                                            className={cn(
                                                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                                                s.step < currentStep
                                                    ? 'bg-green-500 text-white'
                                                    : s.step === currentStep
                                                        ? 'bg-blue-500 text-white'
                                                        : 'bg-gray-200 text-gray-500 dark:bg-gray-700'
                                            )}
                                        >
                                            {s.step < currentStep ? '✓' : s.step + 1}
                                        </div>
                                        <span
                                            className={cn(
                                                'ml-2 text-xs',
                                                s.step === currentStep ? 'font-medium text-text-primary' : 'text-text-tertiary'
                                            )}
                                        >
                                            {s.label}
                                        </span>
                                        {s.step < 2 && <div className="mx-2 h-px w-8 bg-border-light" />}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Step 1: 选择数据源 */}
                        {kpiTableImportStep === 'datasource' && (
                            <div className="p-4 space-y-3">
                                <select
                                    value={kpiTableImportSelectedDs}
                                    onChange={(e) => onKpiTableImportDsChange(e.target.value)}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                >
                                    <option value="">请选择数据源</option>
                                    {kpiTableImportDatasources.map((ds: any) => (
                                        <option key={ds.id} value={ds.id}>
                                            {ds.name} ({ds.provider})
                                        </option>
                                    ))}
                                </select>
                                <div className="text-right">
                                    <button
                                        type="button"
                                        onClick={() => setKpiTableImportStep('table')}
                                        disabled={
                                            !kpiTableImportSelectedDs ||
                                            kpiTableImportLoading ||
                                            (kpiTableImportSchemas.length <= 1 && kpiTableImportTables.length === 0)
                                        }
                                        className="btn btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
                                    >
                                        下一步
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 2: 选择表并校验 */}
                        {kpiTableImportStep === 'table' && (
                            <div className="p-4 space-y-3">
                                {kpiTableImportLoading ? (
                                    <div className="flex items-center justify-center py-8 text-sm text-text-secondary">
                                        正在加载...
                                    </div>
                                ) : (
                                    <>
                                        {kpiTableImportSchemas.length > 1 && (
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-text-secondary">
                                                    数据库 Schema
                                                </label>
                                                <select
                                                    value={kpiTableImportSelectedSchema || ''}
                                                    onChange={(e) => onKpiTableImportSchemaChange(e.target.value)}
                                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                >
                                                    <option value="">请选择 Schema</option>
                                                    {kpiTableImportSchemas.map((schema) => (
                                                        <option key={schema} value={schema}>
                                                            {schema}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        <select
                                            value={kpiTableImportSelectedTable}
                                            onChange={(e) => onKpiTableImportTableChange(e.target.value)}
                                            disabled={kpiTableImportSchemas.length > 1 && !kpiTableImportSelectedSchema}
                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60"
                                        >
                                            <option value="">请选择表（如 kpi_info）</option>
                                            {kpiTableImportTables.map((t) => (
                                                <option key={t} value={t}>
                                                    {t}
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                )}

                                {/* Schema 校验结果 */}
                                {kpiTableImportColumns && (
                                    <div>
                                        <div
                                            className={cn(
                                                'rounded-md p-3 text-sm',
                                                kpiTableImportColumns.valid
                                                    ? 'border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
                                                    : 'border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                                            )}
                                        >
                                            <p className="font-medium">
                                                {kpiTableImportColumns.valid ? 'Schema 校验通过' : 'Schema 校验失败'}
                                            </p>
                                            <p className="mt-1 text-xs opacity-80">{kpiTableImportColumns.message}</p>
                                        </div>
                                        {kpiTableImportColumns.columns.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                                                {kpiTableImportColumns.columns.map((c) => (
                                                    <span
                                                        key={c.name}
                                                        className="inline-flex items-center rounded bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary"
                                                    >
                                                        {c.name} <span className="ml-1 text-text-tertiary">({c.type})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setKpiTableImportStep('datasource')}
                                        className="btn btn-neutral text-sm px-3 py-1.5"
                                    >
                                        上一步
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleKpiImportFromTable}
                                        disabled={!kpiTableImportColumns?.valid || kpiTableImportLoading}
                                        className="btn btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
                                    >
                                        {kpiTableImportLoading ? '导入中...' : '开始导入'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 3: 导入结果 */}
                        {kpiTableImportStep === 'result' && kpiTableImportResult && (
                            <div className="p-4 space-y-4">
                                <div className="flex flex-col items-center py-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
                                        <svg
                                            className="h-6 w-6 text-green-500"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M5 13l4 4L19 7"
                                            />
                                        </svg>
                                    </div>
                                    <p className="mt-2 text-sm font-medium text-text-primary">导入成功</p>
                                    <p className="text-xs text-text-tertiary">从数据源表成功导入指标库</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2 rounded-md border border-border-light bg-surface-secondary/40 p-3 text-sm">
                                    <div>
                                        <span className="text-text-tertiary">写入条数：</span>
                                        <span className="font-semibold text-green-500">{kpiTableImportResult.upserted}</span>
                                    </div>
                                    <div>
                                        <span className="text-text-tertiary">展开条数：</span>
                                        <span className="font-mono text-text-primary">{kpiTableImportResult.totalEntries}</span>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <button
                                        type="button"
                                        onClick={() => setKpiTableImportModalVisible(false)}
                                        className="btn btn-primary text-sm px-4 py-1.5"
                                    >
                                        关闭
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Org Table Import Modal (从数据源表导入机构信息) */}
            {orgTableImportModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-2xl rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">从数据源表导入机构信息</h3>
                            <button
                                onClick={() => {
                                    setOrgTableImportModalVisible(false);
                                    setOrgTableImportResult(null);
                                }}
                                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Steps indicator */}
                        <div className="flex items-center border-b border-border-light px-4 py-3">
                            {[
                                { key: 'datasource', label: '选择数据源', step: 0 },
                                { key: 'table', label: '选择表并校验', step: 1 },
                                { key: 'result', label: '导入完成', step: 2 },
                            ].map((s) => {
                                const currentStep =
                                    orgTableImportStep === 'datasource' ? 0 : orgTableImportStep === 'table' ? 1 : 2;
                                return (
                                    <div key={s.key} className="flex items-center">
                                        <div
                                            className={cn(
                                                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                                                s.step < currentStep
                                                    ? 'bg-green-500 text-white'
                                                    : s.step === currentStep
                                                        ? 'bg-blue-500 text-white'
                                                        : 'bg-gray-200 text-gray-500 dark:bg-gray-700'
                                            )}
                                        >
                                            {s.step < currentStep ? '✓' : s.step + 1}
                                        </div>
                                        <span
                                            className={cn(
                                                'ml-2 text-xs',
                                                s.step === currentStep ? 'font-medium text-text-primary' : 'text-text-tertiary'
                                            )}
                                        >
                                            {s.label}
                                        </span>
                                        {s.step < 2 && <div className="mx-2 h-px w-8 bg-border-light" />}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Step 1: 选择数据源 */}
                        {orgTableImportStep === 'datasource' && (
                            <div className="p-4 space-y-3">
                                <select
                                    value={orgTableImportSelectedDs}
                                    onChange={(e) => onOrgTableImportDsChange(e.target.value)}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                >
                                    <option value="">请选择数据源</option>
                                    {orgTableImportDatasources.map((ds: any) => (
                                        <option key={ds.id} value={ds.id}>
                                            {ds.name} ({ds.provider})
                                        </option>
                                    ))}
                                </select>
                                <div className="text-right">
                                    <button
                                        type="button"
                                        onClick={() => setOrgTableImportStep('table')}
                                        disabled={
                                            !orgTableImportSelectedDs ||
                                            orgTableImportLoading ||
                                            (orgTableImportSchemas.length <= 1 && orgTableImportTables.length === 0)
                                        }
                                        className="btn btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
                                    >
                                        下一步
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 2: 选择表并校验 */}
                        {orgTableImportStep === 'table' && (
                            <div className="p-4 space-y-3">
                                {orgTableImportLoading ? (
                                    <div className="flex items-center justify-center py-8 text-sm text-text-secondary">
                                        正在加载...
                                    </div>
                                ) : (
                                    <>
                                        {orgTableImportSchemas.length > 1 && (
                                            <div className="space-y-1.5">
                                                <label className="block text-sm font-medium text-text-secondary">
                                                    数据库 Schema
                                                </label>
                                                <select
                                                    value={orgTableImportSelectedSchema || ''}
                                                    onChange={(e) => onOrgTableImportSchemaChange(e.target.value)}
                                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                >
                                                    <option value="">请选择 Schema</option>
                                                    {orgTableImportSchemas.map((schema) => (
                                                        <option key={schema} value={schema}>
                                                            {schema}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        <select
                                            value={orgTableImportSelectedTable}
                                            onChange={(e) => onOrgTableImportTableChange(e.target.value)}
                                            disabled={orgTableImportSchemas.length > 1 && !orgTableImportSelectedSchema}
                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60"
                                        >
                                            <option value="">请选择表（如 c_par_brch_level）</option>
                                            {orgTableImportTables.map((t) => (
                                                <option key={t} value={t}>
                                                    {t}
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                )}

                                {/* Schema 校验结果 */}
                                {orgTableImportColumns && (
                                    <div>
                                        <div
                                            className={cn(
                                                'rounded-md p-3 text-sm',
                                                orgTableImportColumns.valid
                                                    ? 'border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
                                                    : 'border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                                            )}
                                        >
                                            <p className="font-medium">
                                                {orgTableImportColumns.valid ? 'Schema 校验通过' : 'Schema 校验失败'}
                                            </p>
                                            <p className="mt-1 text-xs opacity-80">{orgTableImportColumns.message}</p>
                                        </div>
                                        <p className="mt-1 text-xs text-text-tertiary">
                                            必填列: data_dt / brchno / brchna / brchup / brchlv
                                        </p>
                                        {orgTableImportColumns.columns.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                                                {orgTableImportColumns.columns.map((c) => (
                                                    <span
                                                        key={c.name}
                                                        className="inline-flex items-center rounded bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary"
                                                    >
                                                        {c.name} <span className="ml-1 text-text-tertiary">({c.type})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setOrgTableImportStep('datasource')}
                                        className="btn btn-neutral text-sm px-3 py-1.5"
                                    >
                                        上一步
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleOrgImportFromTable}
                                        disabled={!orgTableImportColumns?.valid || orgTableImportLoading}
                                        className="btn btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
                                    >
                                        {orgTableImportLoading ? '导入中...' : '开始导入'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 3: 导入结果 */}
                        {orgTableImportStep === 'result' && orgTableImportResult && (
                            <div className="p-4 space-y-4">
                                <div className="flex flex-col items-center py-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
                                        <svg
                                            className="h-6 w-6 text-green-500"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M5 13l4 4L19 7"
                                            />
                                        </svg>
                                    </div>
                                    <p className="mt-2 text-sm font-medium text-text-primary">导入成功</p>
                                    <p className="text-xs text-text-tertiary">从数据源表成功导入机构信息</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2 rounded-md border border-border-light bg-surface-secondary/40 p-3 text-sm">
                                    <div>
                                        <span className="text-text-tertiary">导入节点数：</span>
                                        <span className="font-semibold text-green-500">{orgTableImportResult.imported}</span>
                                    </div>
                                    <div>
                                        <span className="text-text-tertiary">数据日期 (dataDt)：</span>
                                        <span className="font-mono text-text-primary">{orgTableImportResult.dataDt}</span>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <button
                                        type="button"
                                        onClick={() => setOrgTableImportModalVisible(false)}
                                        className="btn btn-primary text-sm px-4 py-1.5"
                                    >
                                        关闭
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Org Node Add / Edit Modal (手动新增/编辑机构节点) */}
            {orgNodeModalVisible && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-lg border border-border-light bg-surface-primary shadow-lg">
                        <div className="flex items-center justify-between border-b border-border-light p-4">
                            <h3 className="text-lg font-semibold text-text-primary">
                                {orgNodeEditingCode ? '编辑机构' : '新增机构'}
                            </h3>
                            <button
                                onClick={() => {
                                    setOrgNodeModalVisible(false);
                                    resetOrgNodeForm();
                                }}
                                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4 p-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">
                                    机构编码 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={orgNodeForm.orgCode}
                                    onChange={(e) =>
                                        setOrgNodeForm((prev) => ({ ...prev, orgCode: e.target.value }))
                                    }
                                    disabled={!!orgNodeEditingCode}
                                    placeholder="例如：A0001"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-800"
                                />
                                {orgNodeEditingCode && (
                                    <p className="mt-1 text-xs text-text-tertiary">编码作为唯一标识，编辑模式下不可修改</p>
                                )}
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">
                                    机构名称 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={orgNodeForm.orgName}
                                    onChange={(e) =>
                                        setOrgNodeForm((prev) => ({ ...prev, orgName: e.target.value }))
                                    }
                                    placeholder="例如：南京分行"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">父机构</label>
                                <select
                                    value={orgNodeForm.parentOrgCode}
                                    onChange={(e) =>
                                        setOrgNodeForm((prev) => ({ ...prev, parentOrgCode: e.target.value }))
                                    }
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                >
                                    <option value="">留空表示根节点</option>
                                    {orgNodeParentOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-text-primary">
                                    数据权限级别 <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={orgNodeForm.brchLv}
                                    onChange={(e) =>
                                        setOrgNodeForm((prev) => ({
                                            ...prev,
                                            brchLv: e.target.value === '' ? '' : Number(e.target.value),
                                        }))
                                    }
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                >
                                    <option value="">请选择</option>
                                    {BRCH_LV_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-border-light p-4">
                            <Button
                                onClick={() => {
                                    setOrgNodeModalVisible(false);
                                    resetOrgNodeForm();
                                }}
                                className="btn btn-neutral"
                            >
                                取消
                            </Button>
                            <Button
                                onClick={handleSaveOrgNode}
                                disabled={orgNodeFormSubmitting}
                                className="btn btn-primary"
                            >
                                {orgNodeFormSubmitting ? '保存中...' : orgNodeEditingCode ? '更新' : '添加'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
