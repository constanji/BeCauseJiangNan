import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../api/client';

function pct(share: number) {
  return `${((share || 0) * 100).toFixed(1)}%`;
}

export default function ReportDetail() {
  const { taskId } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!taskId) return;
    api
      .getReport(taskId)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, [taskId]);

  if (error) return <div className="text-danger">{error}</div>;
  if (!data) return <div className="text-sm text-black/50">加载中…</div>;

  const report = data.report;
  if (!report) {
    return (
      <div className="space-y-3">
        <Link to="/reports" className="text-sm text-accent">
          ← 返回
        </Link>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">
          报告尚未生成。状态：{data.status}
          {data.error ? ` · ${data.error}` : ''}
        </div>
      </div>
    );
  }

  const exportJson = () => {
    const payload = {
      format: 'tokenprobe-report',
      version: 1,
      report,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tokenprobe-${taskId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = report.summary || {};
  const steps = report.steps || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-sm text-accent hover:underline">
            ← 报告列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Token 重构报告</h1>
          <p className="mt-1 max-w-2xl text-sm text-black/60">{report.methodology?.summary}</p>
        </div>
        <button
          type="button"
          onClick={exportJson}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
        >
          <Download className="h-4 w-4" /> 导出 JSON
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['全链路累加', s.chainTotalTokens],
          ['峰值估值', s.peakContextTokens],
          ['问数阶段', s.askPhaseTokens],
          ['归因阶段', s.attributionPhaseTokens],
        ].map(([label, val]) => (
          <div key={String(label)} className="rounded-xl border border-black/10 bg-white/80 p-4">
            <div className="text-xs text-black/50">{label}</div>
            <div className="mt-1 font-mono text-2xl font-semibold">{val ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 text-sm text-amber-950">
        <div className="font-medium">口径说明</div>
        <p className="mt-1">{report.methodology?.peakNote}</p>
        <p className="mt-2 text-black/70">{s.windowRecommendation}</p>
      </div>

      <section className="overflow-hidden rounded-xl border border-black/10 bg-white/80">
        <div className="border-b border-black/5 px-4 py-3 font-medium">步骤拆解</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-black/[0.03] text-xs text-black/55">
            <tr>
              <th className="px-3 py-2">步骤</th>
              <th className="px-3 py-2">工具 / command</th>
              <th className="px-3 py-2">输入</th>
              <th className="px-3 py-2">输出</th>
              <th className="px-3 py-2">合计</th>
              <th className="px-3 py-2">占比</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((st: any) => (
              <tr key={st.id} className="border-t border-black/5">
                <td className="px-3 py-2">{st.label}</td>
                <td className="px-3 py-2 font-mono text-xs text-black/55">
                  {st.toolName || '—'}
                  {st.commands?.length ? ` / ${st.commands.join(',')}` : ''}
                </td>
                <td className="px-3 py-2 font-mono">{st.inputTokens}</td>
                <td className="px-3 py-2 font-mono">{st.outputTokens}</td>
                <td className="px-3 py-2 font-mono font-medium">{st.totalTokens}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded bg-black/5">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${Math.min(100, (st.share || 0) * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs">{pct(st.share)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.optimization && (
        <section className="rounded-xl border border-black/10 bg-white/80 p-4 text-sm">
          <div className="font-medium">优化线索</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-black/70">
            {(report.optimization.wasteHints || []).map((h: string) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="mt-3 text-black/55">
            压缩模拟峰值约 <span className="font-mono text-ink">{report.optimization.compressSimPeak}</span>
            （约压 {report.optimization.compressRatio}）。{report.optimization.note}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-black/10 bg-white/80 p-4 text-sm text-black/60">
        <div className="font-medium text-ink">元信息</div>
        <div className="mt-2 grid gap-1 font-mono text-xs">
          <div>conversationId: {report.conversationId || '—'}</div>
          <div>encoding: {report.encoding}</div>
          <div>source: {report.source}</div>
          <div>question: {report.question || '—'}</div>
        </div>
      </section>
    </div>
  );
}
