import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GitCompare, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client';
import { statusLabel } from '../lib/labels';

export default function ReportList() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    api
      .listReports()
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((r) => r.taskId)));
  };

  const toggleOne = (taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const badge = (status: string) => {
    const cls =
      status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
      status === 'failed' ? 'bg-red-100 text-red-800' :
      'bg-amber-100 text-amber-900';
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{statusLabel(status)}</span>;
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const r = await api.importReport(json);
      navigate(`/reports/${r.taskId}`);
    } catch (err: any) {
      setError(err.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const removeOne = async (taskId: string) => {
    if (!confirm('确定删除这条报告？不可恢复。')) return;
    try {
      await api.deleteReport(taskId);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const removeSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`确定删除选中的 ${selected.size} 条报告？不可恢复。`)) return;
    try {
      await api.deleteReports([...selected]);
      setSelected(new Set());
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const compareHref = useMemo(() => {
    const ids = [...selected];
    if (ids.length !== 2) return null;
    const picked = items.filter((r) => selected.has(r.taskId));
    if (picked.some((r) => r.kind === 'capability')) return null;
    return `/compare?a=${encodeURIComponent(ids[0])}&b=${encodeURIComponent(ids[1])}`;
  }, [selected, items]);

  const compareBlockedByCapability = useMemo(() => {
    if (selected.size !== 2) return false;
    return items.some((r) => selected.has(r.taskId) && r.kind === 'capability');
  }, [selected, items]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">评测报告</h1>
          <p className="mt-1 text-sm text-black/60">历史探测结果；可删除、导入 / 导出，勾选两条可对比</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {importing ? '导入中…' : '导入 JSON'}
          </button>
          <Link to="/probe" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
            新建探测
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-black/10 bg-white/80 px-4 py-2.5 text-sm">
          <span className="text-black/60">已选 {selected.size} 条</span>
          {compareHref ? (
            <Link to={compareHref} className="inline-flex items-center gap-1.5 text-accent hover:underline">
              <GitCompare className="h-4 w-4" /> 对比这两条
            </Link>
          ) : compareBlockedByCapability ? (
            <span className="text-black/40">规范/工具报告不支持性能对比，请只选性能报告</span>
          ) : (
            <span className="text-black/40">再选 {2 - selected.size} 条即可对比</span>
          )}
          <button
            type="button"
            onClick={removeSelected}
            className="ml-auto inline-flex items-center gap-1.5 text-danger hover:underline"
          >
            <Trash2 className="h-4 w-4" /> 删除选中
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-black/50">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 bg-white/50 px-6 py-12 text-center text-sm text-black/55">
          暂无报告。可「新建探测」，或「导入 JSON」加载已有报告文件。
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-black/[0.03] text-xs text-black/50">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选" />
                </th>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">端点</th>
                <th className="px-4 py-3">模型</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.taskId} className="border-b border-black/5">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.taskId)}
                      onChange={() => toggleOne(r.taskId)}
                      aria-label={`选择 ${r.model}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-black/55">
                    {new Date(r.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3">
                    {r.endpointName}
                    {r.imported && (
                      <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-xs text-black/45">导入</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.model}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.kind === 'capability' ? (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-800">规范/工具</span>
                    ) : (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">性能</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{badge(r.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <Link to={`/reports/${r.taskId}`} className="text-accent hover:underline">查看</Link>
                      <button type="button" onClick={() => removeOne(r.taskId)} className="text-danger hover:underline">
                        删除
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
