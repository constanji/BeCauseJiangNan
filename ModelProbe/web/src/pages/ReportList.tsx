import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ReportList() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listReports().then((r) => setItems(r.data)).finally(() => setLoading(false));
  }, []);

  const badge = (status: string) => {
    const cls =
      status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
      status === 'failed' ? 'bg-red-100 text-red-800' :
      'bg-amber-100 text-amber-900';
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">评测报告</h1>
          <p className="mt-1 text-sm text-black/60">历史探测结果</p>
        </div>
        <Link to="/probe" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">新建探测</Link>
      </div>
      {loading ? (
        <div className="text-sm text-black/50">加载中…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/10 bg-white/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-black/[0.03] text-xs uppercase text-black/50">
              <tr>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">端点</th>
                <th className="px-4 py-3">模型</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.taskId} className="border-b border-black/5">
                  <td className="px-4 py-3 text-xs text-black/55">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{r.endpointName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.model}</td>
                  <td className="px-4 py-3">{badge(r.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/reports/${r.taskId}`} className="text-accent hover:underline">查看</Link>
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
