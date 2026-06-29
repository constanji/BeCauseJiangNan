import React from 'react';
import { ChevronDown, ChevronRight, Search, ShoppingCart } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import FilterBar from '../components/FilterBar';
import StatusBanner from '../components/StatusBanner';
import TagBadge from '../components/TagBadge';
import { useUiState } from '../context/UiStateProvider';
import { ExportCartItem, SearchHit } from '../lib/uiState';

function highlightSnippet(snippet: string, q: string) {
  if (!q.trim()) return snippet;
  const idx = snippet.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return snippet;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="rounded bg-brand-muted px-0.5 text-brand">{snippet.slice(idx, idx + q.length)}</mark>
      {snippet.slice(idx + q.length)}
    </>
  );
}

export default function LightSchemaSearch() {
  const { state, setSearch, toggleCart, isInCart } = useUiState();
  const { search } = state;
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});
  const [searched, setSearched] = React.useState(false);

  const runSearch = React.useCallback(() => {
    const q = search.q.trim();
    if (!q) {
      setError('请输入搜索关键词');
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(true);
    api.searchLightSchemas({
      q,
      dataSourceId: search.dataSourceId || undefined,
      schemaName: search.schemaName || undefined,
      tagId: search.tagId || undefined,
    })
      .then((r) => {
        if (!r.success) throw new Error(r.error || '搜索失败');
        const hits = r.data || [];
        setResults(hits);
        const next: Record<number, boolean> = {};
        for (const hit of hits) next[hit.lightSchemaId] = true;
        setExpanded(next);
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [search.q, search.dataSourceId, search.schemaName, search.tagId]);

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-text-primary">列注释搜索</h2>
        <p className="mt-1 text-sm text-text-secondary">按列备注关键词搜索，结果按表聚合展示</p>
      </div>

      {error && <div className="mb-4"><StatusBanner tone="error" title="操作失败" message={error} /></div>}

      <div className="mb-4 space-y-4 rounded-lg border border-border-light bg-surface-primary p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            className="input flex-1"
            value={search.q}
            onChange={(e) => setSearch({ q: e.target.value })}
            placeholder="搜索列注释，例如：订单金额"
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          />
          <Button variant="primary" className="px-4 py-2" disabled={loading} onClick={runSearch}>
            <Search className="h-4 w-4" />
            搜索
          </Button>
        </div>
        <FilterBar
          dataSourceId={search.dataSourceId}
          schemaName={search.schemaName}
          tagIds={search.tagId ? [Number(search.tagId)] : []}
          singleTag
          onDataSourceChange={(v) => setSearch({ dataSourceId: v })}
          onSchemaChange={(v) => setSearch({ schemaName: v })}
          onTagIdsChange={(ids) => setSearch({ tagId: ids[0] ? String(ids[0]) : '' })}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">搜索中…</div>
        ) : !searched ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">输入关键词开始搜索</div>
        ) : results.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">未找到匹配结果</div>
        ) : (
          <div className="space-y-3">
            {results.map((hit) => {
              const open = expanded[hit.lightSchemaId];
              const cartItem: ExportCartItem = {
                lightSchemaId: hit.lightSchemaId,
                dataSourceId: hit.dataSourceId,
                dataSourceName: hit.dataSourceName,
                schemaName: hit.schemaName,
                tableName: hit.tableName,
              };
              return (
                <div key={hit.lightSchemaId} className="rounded-lg border border-border-light bg-surface-primary">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setExpanded((prev) => ({ ...prev, [hit.lightSchemaId]: !open }))}
                    >
                      {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <span className="font-medium text-text-primary">
                        {hit.dataSourceName} / {hit.schemaName}.{hit.tableName}
                      </span>
                      <span className="text-sm text-text-secondary">命中 {hit.matches.length} 列</span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      {hit.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
                      <Button
                        variant="neutral"
                        className="px-3 py-2"
                        onClick={() => toggleCart(cartItem)}
                      >
                        <ShoppingCart className="h-4 w-4" />
                        {isInCart(hit.lightSchemaId) ? '移出导出篮' : '加入导出篮'}
                      </Button>
                    </div>
                  </div>
                  {open && (
                    <div className="border-t border-border-light px-4 py-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-text-secondary">
                            <th className="py-2 pr-3">列名</th>
                            <th className="py-2 pr-3">列注释</th>
                            <th className="py-2">片段</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hit.matches.map((m) => (
                            <tr key={m.columnName} className="border-t border-border-light/60">
                              <td className="py-2 pr-3 font-medium text-text-primary">{m.columnName}</td>
                              <td className="py-2 pr-3 text-text-secondary">{m.description}</td>
                              <td className="py-2 text-text-secondary">{highlightSnippet(m.snippet, search.q)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
