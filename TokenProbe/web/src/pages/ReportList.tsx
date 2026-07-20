import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Upload } from 'lucide-react';
import { api } from '../api/client';

export default function ReportList() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const res = await api.listReports();
    setRows(res.data || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const remove = async (taskId: string) => {
    if (!confirm('删除该报告？')) return;
    await api.deleteReport(taskId);
    await load();
  };

  const onImport = async (file: File) => {
    setError('');
    try {
      const text = await file.text();
      const body = JSON.parse(text);
      const res = await api.importReport(body);
      await load();
      window.location.href = `/reports/${res.taskId}`;
    } catch (e: any) {
      setError(e.message || '导入失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">报告</h1>
          <p className="mt-1 text-sm text-black/60">支持导出 / 导入 tokenprobe-report JSON</p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5"
          >
            <Upload className="h-4 w-4" /> 导入 JSON
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-black/10 bg-white/80">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/[0.03] text-black/55">
            <tr>
              <th className="px-3 py-2 font-medium">时间</th>
              <th className="px-3 py-2 font-medium">问句 / 来源</th>
              <th className="px-3 py-2 font-medium">累加</th>
              <th className="px-3 py-2 font-medium">峰值估值</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.taskId} className="border-t border-black/5">
                <td className="px-3 py-2 font-mono text-xs text-black/50">
                  {(r.completedAt || r.createdAt || '').replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-3 py-2">
                  <div className="max-w-xs truncate">{r.question || '—'}</div>
                  <div className="text-xs text-black/40">
                    {r.connectionName || '—'} · {r.source || '—'}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono">{r.chainTotalTokens ?? '—'}</td>
                <td className="px-3 py-2 font-mono">{r.peakContextTokens ?? '—'}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/reports/${r.taskId}`} className="mr-2 text-accent hover:underline">
                    查看
                  </Link>
                  <button type="button" onClick={() => remove(r.taskId)} className="text-black/35 hover:text-danger">
                    <Trash2 className="inline h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-black/45">
                  暂无报告
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
