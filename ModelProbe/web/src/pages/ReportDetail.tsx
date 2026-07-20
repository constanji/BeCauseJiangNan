import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../api/client';

function MetricCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white/90 p-4">
      <div className="text-xs uppercase tracking-wide text-black/45">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-black/55">{sub}</div>}
    </div>
  );
}

function IdentityTable({ layer, data }: { layer: string; data: any }) {
  if (!data) return null;
  return (
    <div className="rounded-lg border border-black/10 bg-white/90 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold capitalize">{layer}</h3>
        <span className={`text-xs font-medium ${data.match ? 'text-accent' : 'text-danger'}`}>
          {data.match ? '身份一致' : '身份不一致'}
        </span>
      </div>
      <dl className="space-y-2 font-mono text-xs">
        <div><dt className="text-black/50">L1 UI</dt><dd>{JSON.stringify(data.l1)}</dd></div>
        <div><dt className="text-black/50">L2 出站</dt><dd>{JSON.stringify(data.l2)}</dd></div>
        <div><dt className="text-black/50">L3 回包</dt><dd>{JSON.stringify(data.l3)}</dd></div>
        {data.assemblyNotes?.length > 0 && (
          <div><dt className="text-black/50">组装说明</dt><dd>{data.assemblyNotes.join(' · ')}</dd></div>
        )}
      </dl>
    </div>
  );
}

export default function ReportDetail() {
  const { taskId } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!taskId) return;
    api.getReport(taskId).then((r) => setData(r.data)).catch((e) => setError(e.message));
  }, [taskId]);

  const report = data?.report;

  const download = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modelprobe-${taskId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <div className="text-danger">{error}</div>;
  if (!data) return <div className="text-sm text-black/50">加载中…</div>;

  const latD = report?.latency?.direct;
  const latA = report?.latency?.assembled;
  const tpD = report?.throughput?.direct;
  const tpA = report?.throughput?.assembled;

  return (
    <div>
      <Link to="/reports" className="text-sm text-accent hover:underline">← 报告列表</Link>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{data.endpoint?.name}</h1>
          <p className="mt-1 font-mono text-sm text-black/65">{data.model}</p>
          <p className="text-xs text-black/45">{data.completedAt && new Date(data.completedAt).toLocaleString()}</p>
        </div>
        {report && (
          <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <Download className="h-4 w-4" /> 导出 JSON
          </button>
        )}
      </div>

      {!report ? (
        <div className="mt-8 text-sm text-black/55">报告尚未生成（{data.status}）</div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">模型身份（三层）</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <IdentityTable layer="direct" data={report.identity?.direct} />
              <IdentityTable layer="assembled" data={report.identity?.assembled} />
            </div>
            {report.compare?.modelMismatch?.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-warn">
                身份不一致层: {report.compare.modelMismatch.join(', ')}
                {report.compare.ttftDeltaMs != null && ` · TTFT 差 ${report.compare.ttftDeltaMs}ms`}
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">延迟</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="TTFT Direct (p50)" value={`${latD?.ttftMs?.p50 ?? '—'} ms`} sub={`p95 ${latD?.ttftMs?.p95 ?? '—'} ms`} />
              <MetricCard title="TTFT Assembled (p50)" value={`${latA?.ttftMs?.p50 ?? '—'} ms`} sub={`p95 ${latA?.ttftMs?.p95 ?? '—'} ms`} />
              <MetricCard title="ITL Direct (mean)" value={`${latD?.itlMs?.mean ?? '—'} ms`} />
              <MetricCard title="ITL Assembled (mean)" value={`${latA?.itlMs?.mean ?? '—'} ms`} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">吞吐</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="RPM Direct" value={String(tpD?.rpm ?? '—')} sub={`错误率 ${((tpD?.errorRate ?? 0) * 100).toFixed(1)}%`} />
              <MetricCard title="RPM Assembled" value={String(tpA?.rpm ?? '—')} />
              <MetricCard title="TPM Direct" value={String(tpD?.tpm ?? '—')} />
              <MetricCard title="TPM Assembled" value={String(tpA?.tpm ?? '—')} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">上下文窗口</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <MetricCard
                title="Direct 实测上限"
                value={String(report.context?.direct?.measuredMaxAccepted ?? '—')}
                sub={report.context?.direct?.claimed ? `声明 ${report.context.direct.claimed}` : undefined}
              />
              <MetricCard
                title="Assembled 实测上限"
                value={String(report.context?.assembled?.measuredMaxAccepted ?? '—')}
                sub={report.context?.assembled?.failReason ? `失败: ${report.context.assembled.failReason.slice(0, 80)}…` : undefined}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
