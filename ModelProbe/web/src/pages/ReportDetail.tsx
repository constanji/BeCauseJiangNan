import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import HelpTip from '../components/HelpTip';
import CapabilityReportSections from '../components/CapabilityReportSections';
import { layerLabel, statusLabel } from '../lib/labels';

function MetricCard({ title, tip, value, sub }: { title: string; tip?: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white/90 p-4">
      <div className="flex items-center gap-1.5 text-xs tracking-wide text-black/45">
        <span>{title}</span>
        {tip && <HelpTip text={tip} />}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-black/55">{sub}</div>}
    </div>
  );
}

function IdentityCard({ layer, data }: { layer: string; data: any }) {
  if (!data) return null;
  return (
    <div className="rounded-lg border border-black/10 bg-white/90 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{layerLabel(layer)}</h3>
        <span className={`text-xs font-medium ${data.match ? 'text-accent' : 'text-danger'}`}>
          {data.match ? '三层身份一致' : '三层身份不一致'}
          {data.l3?.model ? `（${data.l3.model}）` : ''}
        </span>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-xs text-black/50">
            L1 界面选择
            <HelpTip text="你在探测页填写的模型名。" />
          </dt>
          <dd className="mt-0.5 font-mono text-xs">{String(data.l1 ?? '—')}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-black/50">
            L2 实际发出
            <HelpTip text="发送给供应商的请求体里的 model / modelName 等字段。" />
          </dt>
          <dd className="mt-0.5 break-all font-mono text-xs">{JSON.stringify(data.l2)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-black/50">
            L3 供应商回包
            <HelpTip text="供应商响应里带的模型名。若与 L1 不同，可能是别名映射或网关改写。" />
          </dt>
          <dd className="mt-0.5 break-all font-mono text-xs">{JSON.stringify(data.l3)}</dd>
        </div>
        {data.assemblyNotes?.length > 0 && (
          <div>
            <dt className="text-xs text-black/50">组装说明</dt>
            <dd className="mt-0.5 text-xs leading-relaxed text-black/75">{data.assemblyNotes.join('；')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function fmtMs(v: unknown) {
  if (v == null || v === '') return '—';
  return `${v} ms`;
}

function itlSub(itl: any) {
  if (!itl) return undefined;
  if (itl.count === 0 || itl.mean == null) return itl.note || '无间隔样本';
  if (itl.source === 'estimated') return `估算 · ${itl.note || ''}`;
  return undefined;
}

export default function ReportDetail() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!taskId) return;
    api.getReport(taskId).then((r) => setData(r.data)).catch((e) => setError(e.message));
  }, [taskId]);

  const report = data?.report;
  const isCapability = report?.kind === 'capability' || data?.config?.kind === 'capability';

  const remove = async () => {
    if (!taskId || !confirm('确定删除这条报告？不可恢复。')) return;
    try {
      await api.deleteReport(taskId);
      navigate('/reports');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const download = () => {
    if (!report && !data) return;
    const payload = {
      format: 'modelprobe-report',
      version: 1,
      exportedAt: new Date().toISOString(),
      report: report || {
        taskId: data.taskId,
        endpoint: data.endpoint,
        model: data.model,
        config: data.config,
      },
    };
    // 保证导出文件自包含端点/模型，便于另一台机器导入
    if (payload.report && !payload.report.endpoint && data.endpoint) {
      payload.report.endpoint = data.endpoint;
    }
    if (payload.report && !payload.report.model && data.model) {
      payload.report.model = data.model;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
  const hasContext =
    report?.context?.direct != null || report?.context?.assembled != null;

  return (
    <div>
      <Link to="/reports" className="text-sm text-accent hover:underline">← 报告列表</Link>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{data.endpoint?.name}</h1>
          <p className="mt-1 font-mono text-sm text-black/65">{data.model}</p>
          <p className="text-xs text-black/45">
            {data.completedAt && new Date(data.completedAt).toLocaleString('zh-CN')}
            {' · '}
            {statusLabel(data.status)}
            {data.imported ? ' · 由 JSON 导入' : ''}
            {isCapability ? ' · 规范/工具探测' : report ? ' · 性能探测' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {taskId && !isCapability && (
            <Link
              to={`/compare?a=${encodeURIComponent(taskId)}`}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/[0.03]"
            >
              去对比
            </Link>
          )}
          {report && (
            <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Download className="h-4 w-4" /> 导出 JSON
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-danger hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> 删除
          </button>
        </div>
      </div>

      {!report ? (
        <div className="mt-8 text-sm text-black/55">报告尚未生成（{statusLabel(data.status)}）</div>
      ) : isCapability ? (
        <CapabilityReportSections report={report} />
      ) : (
        <>
          <section className="mt-8">
            <h2 className="mb-1 flex items-center gap-1.5 text-lg font-semibold">
              模型身份（三层对照）
              <HelpTip text="L1=你选的名字，L2=实际发出去的字段，L3=供应商回包里的模型。不一致时优先查网关别名或 Azure 部署名映射。" />
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <IdentityCard layer="direct" data={report.identity?.direct} />
              <IdentityCard layer="assembled" data={report.identity?.assembled} />
            </div>
            {report.compare?.modelMismatch?.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-warn">
                身份不一致：{report.compare.modelMismatch.map(layerLabel).join('、')}
                {report.compare.ttftDeltaMs != null &&
                  ` · 组装层相对直连层首 token 差 ${report.compare.ttftDeltaMs} ms`}
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-1 flex items-center gap-1.5 text-lg font-semibold">
              延迟
              <HelpTip text="TTFT：发出请求到收到第一个内容片段的时间。ITL：相邻 token 片段之间的间隔。数值越小通常体感越快。" />
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                title="直连 · 首 token（中位）"
                tip="Time To First Token，流式首个内容块到达时间的中位数。"
                value={fmtMs(latD?.ttftMs?.p50)}
                sub={`P95 ${fmtMs(latD?.ttftMs?.p95)}`}
              />
              <MetricCard
                title="组装 · 首 token（中位）"
                tip="组装层同样指标，用于对比 Because 组装是否带来额外延迟。"
                value={fmtMs(latA?.ttftMs?.p50)}
                sub={`P95 ${fmtMs(latA?.ttftMs?.p95)}`}
              />
              <MetricCard
                title="直连 · token 间隔（均值）"
                tip="Inter-Token Latency。若网关把整段打成一个流式块，会显示「—」或按 token 数估算，不会再显示误导性的 0。"
                value={fmtMs(latD?.itlMs?.mean)}
                sub={itlSub(latD?.itlMs)}
              />
              <MetricCard
                title="组装 · token 间隔（均值）"
                tip="同上。"
                value={fmtMs(latA?.itlMs?.mean)}
                sub={itlSub(latA?.itlMs)}
              />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-1 flex items-center gap-1.5 text-lg font-semibold">
              吞吐
              <HelpTip text="在设定并发与时长内测得的样本吞吐，不是极限压测。RPM=每分钟成功请求数，TPM=每分钟处理的 token 数。" />
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                title="直连 · 每分钟请求数"
                tip="RPM：Requests Per Minute。"
                value={String(tpD?.rpm ?? '—')}
                sub={tpD ? `错误率 ${((tpD.errorRate ?? 0) * 100).toFixed(1)}%` : undefined}
              />
              <MetricCard title="组装 · 每分钟请求数" value={String(tpA?.rpm ?? '—')} />
              <MetricCard
                title="直连 · 每分钟 Token"
                tip="TPM：Tokens Per Minute（输入+输出估算）。"
                value={String(tpD?.tpm ?? '—')}
              />
              <MetricCard title="组装 · 每分钟 Token" value={String(tpA?.tpm ?? '—')} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-1 flex items-center gap-1.5 text-lg font-semibold">
              上下文窗口
              <HelpTip text="仅在勾选「探测上下文窗口」时有数据。用填充文本近似试探，不是精确 tokenizer 结果。" />
            </h2>
            {!hasContext ? (
              <p className="mt-4 text-sm text-black/55">本次未开启上下文探测。</p>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <MetricCard
                  title="直连 · 实测可接受上限"
                  value={
                    report.context?.direct?.unknown ||
                    report.context?.direct?.measuredMaxAccepted == null
                      ? '未探查'
                      : String(report.context.direct.measuredMaxAccepted)
                  }
                  sub={
                    report.context?.direct?.claimed
                      ? `端点声明：${report.context.direct.claimed}`
                      : report.context?.direct?.failReason
                        ? String(report.context.direct.failReason).slice(0, 80)
                        : undefined
                  }
                />
                <MetricCard
                  title="组装 · 实测可接受上限"
                  value={
                    report.context?.assembled?.unknown ||
                    report.context?.assembled?.measuredMaxAccepted == null
                      ? '未探查'
                      : String(report.context.assembled.measuredMaxAccepted)
                  }
                  sub={
                    report.context?.assembled?.failReason
                      ? String(report.context.assembled.failReason).slice(0, 80)
                      : undefined
                  }
                />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
