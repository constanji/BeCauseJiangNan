import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Plus, Play, Trash2 } from 'lucide-react';
import { api, type Endpoint } from '../api/client';

export default function EndpointList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyingId, setCopyingId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api
      .listEndpoints()
      .then((r) => setItems(r.data.filter((ep) => ep.name !== '__imported__')))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (id: number) => {
    if (!confirm('确定删除此端点？')) return;
    await api.deleteEndpoint(id);
    load();
  };

  const copy = async (id: number) => {
    setError('');
    setCopyingId(id);
    try {
      const r = await api.copyEndpoint(id);
      navigate(`/endpoints/${r.data.id}/edit`);
    } catch (e: any) {
      setError(e.message || '复制失败');
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">模型端点</h1>
          <p className="mt-1 text-sm text-black/60">配置 provider / 网关 baseURL 与 API Key</p>
        </div>
        <Link
          to="/endpoints/new"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> 新建端点
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
      {loading ? (
        <div className="text-sm text-black/50">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 bg-white/50 px-6 py-12 text-center text-sm text-black/55">
          暂无端点，请先新建
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/10 bg-black/[0.03] text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">Base URL</th>
                <th className="px-4 py-3">默认模型</th>
                <th className="px-4 py-3">测连</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((ep) => (
                <tr key={ep.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3 font-medium">{ep.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{ep.type}</td>
                  <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-black/65">{ep.base_url}</td>
                  <td className="px-4 py-3 font-mono text-xs">{ep.default_model || '—'}</td>
                  <td className="px-4 py-3">
                    {ep.last_test_ok === 1 ? (
                      <span className="text-accent">OK</span>
                    ) : ep.last_test_ok === 0 ? (
                      <span className="text-danger" title={ep.last_test_error}>失败</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        to={`/probe?endpointId=${ep.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-accent hover:bg-accent/10"
                      >
                        <Play className="h-3.5 w-3.5" /> 探测
                      </Link>
                      <button
                        type="button"
                        disabled={copyingId === ep.id}
                        onClick={() => copy(ep.id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 disabled:opacity-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copyingId === ep.id ? '复制中…' : '复制'}
                      </button>
                      <Link to={`/endpoints/${ep.id}/edit`} className="rounded-md px-2 py-1 hover:bg-black/5">
                        编辑
                      </Link>
                      <button type="button" onClick={() => remove(ep.id)} className="rounded-md px-2 py-1 text-danger hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
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
  );
}
