export type Tag = {
  id: number;
  name: string;
  displayName?: string;
  parentId?: number | null;
  parentName?: string | null;
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number;
  childCount?: number;
};

export type CatalogItem = {
  id: number;
  dataSourceId: string;
  dataSourceName: string;
  schemaName: string;
  tableName: string;
  tags: Tag[];
  updatedAt: string;
  columnCount: number;
};

export type CatalogDetail = CatalogItem & {
  content?: {
    tableName: string;
    tableDescription?: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      description?: string;
      sampleValues?: string[];
    }>;
    primaryKeys: string[];
  };
  ddlText?: string;
  createdAt?: string;
};

/** 命中来源：表名 / 列名 / 注释 / 采样值 / 实际数据（meta 为旧版兼容） */
export type MatchSource = 'table' | 'column' | 'comment' | 'sample' | 'live' | 'meta';

export type SearchMatch = {
  columnName: string;
  description: string;
  snippet: string;
  matchSource?: MatchSource;
  matchedValues?: string[];
};

export type SearchHit = {
  lightSchemaId: number | null;
  dataSourceId: string;
  dataSourceName: string;
  schemaName: string;
  tableName: string;
  tags: Tag[];
  columnCount: number;
  matches: SearchMatch[];
};

export type RemoteTablePreview = {
  lightSchemaId: number | null;
  dataSourceId: string;
  dataSourceName: string;
  schemaName: string;
  tableName: string;
  content: CatalogDetail['content'];
  ddlText?: string;
  columnCount: number;
};

export type ExportCartItem = {
  lightSchemaId: number;
  dataSourceId: string;
  dataSourceName: string;
  schemaName: string;
  tableName: string;
};

export type GroupMode = 'flat' | 'dataSource' | 'schema';

/** 主页 / 审查 / 搜索 / 找表 共用的数据源与 Schema，刷新与切页保持一致 */
export type CatalogScope = {
  dataSourceId: string;
  schemaName: string;
};

export type LibraryUiState = {
  dataSourceId: string;
  schemaName: string;
  tagIds: number[];
  groupMode: GroupMode;
  searchQuery: string;
};

export type SearchUiState = {
  q: string;
  dataSourceId: string;
  schemaName: string;
  tagId: string;
};

export type ReviewUiState = {
  columnSearchQuery: string;
  hideInCart: boolean;
};

export type ExploreUiState = {
  q: string;
  dataSourceId: string;
  schemaName: string;
};

export type ExportCartState = {
  items: ExportCartItem[];
  tagIds: number[];
};

export type UiState = {
  catalogScope: CatalogScope;
  library: LibraryUiState;
  search: SearchUiState;
  explore: ExploreUiState;
  review: ReviewUiState;
  exportCart: ExportCartState;
};

export const STORAGE_KEY = 'schema-ui-state-v1';

export const DEFAULT_CATALOG_SCOPE: CatalogScope = {
  dataSourceId: '',
  schemaName: '',
};

export const DEFAULT_UI_STATE: UiState = {
  catalogScope: { ...DEFAULT_CATALOG_SCOPE },
  library: {
    dataSourceId: '',
    schemaName: '',
    tagIds: [],
    groupMode: 'schema',
    searchQuery: '',
  },
  search: {
    q: '',
    dataSourceId: '',
    schemaName: '',
    tagId: '',
  },
  explore: {
    q: '',
    dataSourceId: '',
    schemaName: '',
  },
  review: {
    columnSearchQuery: '',
    hideInCart: false,
  },
  exportCart: {
    items: [],
    tagIds: [],
  },
};

export function normalizeCatalogScope(raw: Partial<CatalogScope> & Record<string, unknown> = {}): CatalogScope {
  return {
    dataSourceId: typeof raw.dataSourceId === 'string' ? raw.dataSourceId : '',
    schemaName: typeof raw.schemaName === 'string' ? raw.schemaName : '',
  };
}

export function normalizeExploreState(raw: Partial<ExploreUiState> & Record<string, unknown> = {}): ExploreUiState {
  return {
    q: typeof raw.q === 'string' ? raw.q : '',
    dataSourceId: typeof raw.dataSourceId === 'string' ? raw.dataSourceId : '',
    schemaName: typeof raw.schemaName === 'string' ? raw.schemaName : '',
  };
}

/** 将 scope 同步写入 library / search / explore，保证旧字段读写一致 */
export function applyCatalogScope(state: UiState, scope: CatalogScope): UiState {
  return {
    ...state,
    catalogScope: scope,
    library: { ...state.library, dataSourceId: scope.dataSourceId, schemaName: scope.schemaName },
    search: { ...state.search, dataSourceId: scope.dataSourceId, schemaName: scope.schemaName },
    explore: { ...state.explore, dataSourceId: scope.dataSourceId, schemaName: scope.schemaName },
  };
}

function resolveCatalogScope(parsed: any): CatalogScope {
  if (parsed?.catalogScope) return normalizeCatalogScope(parsed.catalogScope);
  // 兼容旧 localStorage：优先主页，其次搜索 / 找表
  const fromLibrary = parsed?.library || {};
  const fromSearch = parsed?.search || {};
  const fromExplore = parsed?.explore || {};
  return normalizeCatalogScope({
    dataSourceId: fromLibrary.dataSourceId || fromSearch.dataSourceId || fromExplore.dataSourceId || '',
    schemaName: fromLibrary.schemaName || fromSearch.schemaName || fromExplore.schemaName || '',
  });
}

export function loadUiState(): UiState {
  if (typeof window === 'undefined') return DEFAULT_UI_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_STATE;
    const parsed = JSON.parse(raw);
    const scope = resolveCatalogScope(parsed);
    const base: UiState = {
      catalogScope: scope,
      library: { ...DEFAULT_UI_STATE.library, ...(parsed.library || {}) },
      search: { ...DEFAULT_UI_STATE.search, ...(parsed.search || {}) },
      explore: normalizeExploreState(parsed.explore),
      review: { ...DEFAULT_UI_STATE.review, ...(parsed.review || {}) },
      exportCart: {
        items: Array.isArray(parsed.exportCart?.items) ? parsed.exportCart.items : [],
        tagIds: Array.isArray(parsed.exportCart?.tagIds) ? parsed.exportCart.tagIds : [],
      },
    };
    return applyCatalogScope(base, scope);
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function saveUiState(state: UiState) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function cartItemKey(item: Pick<ExportCartItem, 'lightSchemaId'>) {
  return String(item.lightSchemaId);
}

export const TAG_COLORS = [
  '#10a37f',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
];
