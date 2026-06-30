import { buildDataSourceGroups, buildSchemaGroups } from './catalogGroups';
import { CatalogItem } from './uiState';

/** 与审查页左侧栏相同的表顺序（含表名搜索筛选） */
export function flattenReviewSidebarTables(
  visibleItems: CatalogItem[],
  tableSearch: string,
  nestedByDataSource: boolean,
): CatalogItem[] {
  const q = tableSearch.trim().toLowerCase();
  const match = (item: CatalogItem) =>
    !q || item.tableName.toLowerCase().includes(q);
  const sortTables = (list: CatalogItem[]) =>
    [...list].filter(match).sort((a, b) => a.tableName.localeCompare(b.tableName, 'zh-CN'));

  if (nestedByDataSource && buildDataSourceGroups(visibleItems).length > 1) {
    const flat: CatalogItem[] = [];
    for (const ds of buildDataSourceGroups(visibleItems)) {
      for (const schema of ds.schemas) {
        flat.push(...sortTables(schema.items));
      }
    }
    return flat;
  }

  const flat: CatalogItem[] = [];
  for (const group of buildSchemaGroups(visibleItems)) {
    flat.push(...sortTables(group.items));
  }
  return flat;
}

/** 删除 removedId 后，在 ordered 中顺延到下一张（同位置或上一张） */
export function pickNextCatalogId(
  ordered: CatalogItem[],
  removedId: number,
): number | null {
  const idx = ordered.findIndex((item) => item.id === removedId);
  const remaining = ordered.filter((item) => item.id !== removedId);
  if (remaining.length === 0) return null;
  if (idx === -1) return remaining[0]?.id ?? null;
  return remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
}

/** 字符串表名列表版：删除 removed 后顺延 */
export function pickNextTableName(tableNames: string[], removed: string): string {
  const idx = tableNames.indexOf(removed);
  const remaining = tableNames.filter((n) => n !== removed);
  if (remaining.length === 0) return '';
  if (idx === -1) return remaining[0] ?? '';
  return remaining[Math.min(idx, remaining.length - 1)] ?? '';
}
