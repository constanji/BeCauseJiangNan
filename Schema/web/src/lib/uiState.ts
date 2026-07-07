export type Tag = {
  id: number;
  name: string;
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number;
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

export type SearchMatch = {
  columnName: string;
  description: string;
  snippet: string;
  matchSource?: 'meta' | 'sample' | 'live';
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
  /** 轻量搜索：列名、列注释、采样值（本地 LightSchema） */
  searchLight: boolean;
  /** 深度搜索：连库扫描文本列全表数据 */
  searchDeep: boolean;
};

export type ExportCartState = {
  items: ExportCartItem[];
  tagIds: number[];
};

export type UiState = {
  library: LibraryUiState;
  search: SearchUiState;
  explore: ExploreUiState;
  review: ReviewUiState;
  exportCart: ExportCartState;
};

export const STORAGE_KEY = 'schema-ui-state-v1';

export const DEFAULT_UI_STATE: UiState = {
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
    searchLight: true,
    searchDeep: false,
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

export function normalizeExploreState(raw: Partial<ExploreUiState> & Record<string, unknown> = {}): ExploreUiState {
  let searchLight = true;
  if (typeof raw.searchLight === 'boolean') {
    searchLight = raw.searchLight;
  } else if ('searchColumnMeta' in raw || 'searchSampleValues' in raw) {
    searchLight = raw.searchColumnMeta === true || raw.searchSampleValues === true;
  }
  return {
    q: typeof raw.q === 'string' ? raw.q : '',
    dataSourceId: typeof raw.dataSourceId === 'string' ? raw.dataSourceId : '',
    schemaName: typeof raw.schemaName === 'string' ? raw.schemaName : '',
    searchLight,
    searchDeep: raw.searchDeep === true,
  };
}

export function loadUiState(): UiState {
  if (typeof window === 'undefined') return DEFAULT_UI_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_STATE;
    const parsed = JSON.parse(raw);
    return {
      library: { ...DEFAULT_UI_STATE.library, ...(parsed.library || {}) },
      search: { ...DEFAULT_UI_STATE.search, ...(parsed.search || {}) },
      explore: normalizeExploreState(parsed.explore),
      review: { ...DEFAULT_UI_STATE.review, ...(parsed.review || {}) },
      exportCart: {
        items: Array.isArray(parsed.exportCart?.items) ? parsed.exportCart.items : [],
        tagIds: Array.isArray(parsed.exportCart?.tagIds) ? parsed.exportCart.tagIds : [],
      },
    };
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
