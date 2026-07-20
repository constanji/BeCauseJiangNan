import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import HelpTip from './HelpTip';
import { layerLabel } from '../lib/labels';

type Check = { id: string; pass: boolean; detail?: string; excerpt?: string };
type CaseResult = {
  caseId: string;
  label: string;
  pass?: boolean;
  error?: string;
  score?: number;
  checks?: Check[];
  excerpt?: { content?: string };
};

type SuiteResult = {
  score?: number;
  passedCases?: number;
  totalCases?: number;
  cases?: CaseResult[];
};

function pct(score?: number | null) {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

function aggregateSuites(suites: Array<SuiteResult | undefined | null>) {
  const list = suites.filter(Boolean) as SuiteResult[];
  if (!list.length) return null;
  const scores = list.map((s) => s.score).filter((v): v is number => v != null);
  const passed = list.reduce((n, s) => n + (s.passedCases ?? 0), 0);
  const total = list.reduce((n, s) => n + (s.totalCases ?? 0), 0);
  const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { score, passed, total };
}

function CheckTable({ checks }: { checks?: Check[] }) {
  if (!checks?.length) return null;
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead>
        <tr className="text-black/45">
          <th className="py-1 pr-2">检查项</th>
          <th className="py-1 pr-2">结果</th>
          <th className="py-1">说明</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id} className="border-t border-black/5">
            <td className="py-1.5 pr-2 font-mono">{c.id}</td>
            <td className={`py-1.5 pr-2 font-medium ${c.pass ? 'text-accent' : 'text-danger'}`}>
              {c.pass ? '通过' : '失败'}
            </td>
            <td className="py-1.5 text-black/70">
              {c.detail}
              {c.excerpt && (
                <div className="mt-0.5 break-all font-mono text-[10px] text-black/45">{c.excerpt}</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CaseBlock({ c }: { c: CaseResult }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white/90 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{c.label}</h4>
        <span className={`text-xs font-medium ${c.pass ? 'text-accent' : 'text-danger'}`}>
          {c.error ? '请求失败' : c.pass ? '通过' : '未通过'}
          {c.score != null && !c.error ? ` · ${pct(c.score)}` : ''}
        </span>
      </div>
      {c.error && <p className="mt-2 text-sm text-danger">{c.error}</p>}
      {c.excerpt?.content && (
        <pre className="mt-2 max-h-24 overflow-auto rounded bg-black/[0.03] p-2 font-mono text-[10px] text-black/65">
          {c.excerpt.content}
        </pre>
      )}
      <CheckTable checks={c.checks} />
    </div>
  );
}

function LayerSuite({
  layer,
  suite,
  title,
  tip,
}: {
  layer: string;
  suite?: SuiteResult;
  title: string;
  tip: string;
}) {
  const [open, setOpen] = useState(true);
  if (!suite) return null;
  return (
    <div className="rounded-lg border border-black/8 bg-white/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-black/40 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="flex items-center gap-1.5 font-semibold">
          {title}
          <HelpTip text={tip} />
        </span>
        <span className="ml-auto text-sm font-normal text-black/55">
          {suite.passedCases ?? 0}/{suite.totalCases ?? 0} 用例 · 得分 {pct(suite.score)}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          {(suite.cases || []).map((c) => (
            <CaseBlock key={`${layer}-${c.caseId}`} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  title,
  tip,
  score,
  passed,
  total,
  emptyHint,
}: {
  title: string;
  tip: string;
  score: number | null;
  passed: number;
  total: number;
  emptyHint: string;
}) {
  const hasData = total > 0 || score != null;
  return (
    <div className="rounded-xl border border-black/10 bg-white/90 p-5">
      <div className="flex items-center gap-1.5 text-sm text-black/55">
        {title}
        <HelpTip text={tip} />
      </div>
      {hasData ? (
        <>
          <div
            className={`mt-2 text-3xl font-semibold tabular-nums ${
              score != null && score >= 0.8 ? 'text-accent' : score != null && score < 0.5 ? 'text-danger' : 'text-ink'
            }`}
          >
            {pct(score)}
          </div>
          <div className="mt-1 text-xs text-black/50">
            {passed}/{total} 用例通过
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-black/45">{emptyHint}</div>
      )}
    </div>
  );
}

function CollapsibleLayer({
  layer,
  report,
  defaultOpen = true,
}: {
  layer: string;
  report: any;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const format = report.format?.[layer] as SuiteResult | undefined;
  const tools = report.tools?.[layer] as SuiteResult | undefined;
  const because = report.because?.[layer] as SuiteResult | undefined;
  const summary = aggregateSuites([format, tools, because]);

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-black/10 bg-white/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3.5 text-left hover:bg-black/[0.02]"
      >
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-black/45 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <h2 className="text-lg font-semibold">{layerLabel(layer)}</h2>
        {summary && (
          <span className="ml-auto text-sm text-black/50">
            {summary.passed}/{summary.total} 用例 · 综合 {pct(summary.score)}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-4 py-4">
          <LayerSuite
            layer={layer}
            suite={format}
            title="输出规范"
            tip="Think 是否泄漏、标签是否成对、代码块内样例是否误报等。"
          />
          <LayerSuite
            layer={layer}
            suite={tools}
            title="工具协议"
            tip="默认 mock 工具：是否返回原生 tool_calls、参数 JSON、工具名、mock 往返与组装层 tools 保留。"
          />
          <LayerSuite
            layer={layer}
            suite={because}
            title="问数工具"
            tip="Because-2.0 because_skills_2：command 选型、arguments JSON、禁止正文伪调用、mock schema 往返；不执行真实 DB/RAG。"
          />
        </div>
      )}
    </section>
  );
}

export default function CapabilityReportSections({ report }: { report: any }) {
  const layers = useMemo(
    () =>
      ['direct', 'assembled'].filter(
        (l) => report.format?.[l] || report.tools?.[l] || report.because?.[l],
      ),
    [report],
  );

  const formatAgg = useMemo(
    () => aggregateSuites(layers.map((l) => report.format?.[l])),
    [report, layers],
  );
  const toolsAgg = useMemo(
    () =>
      aggregateSuites([
        ...layers.map((l) => report.tools?.[l]),
        ...layers.map((l) => report.because?.[l]),
      ]),
    [report, layers],
  );

  if (!layers.length) {
    return (
      <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        报告中没有可用的套件结果。若只勾了「问数工具」，请确认服务已重启后再跑一次（改后端后需重启
        <code className="mx-1">npm run dev</code>
        ，前端热更新不会加载新 API）。
      </div>
    );
  }

  return (
    <>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">综合得分</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ScoreCard
            title="模型输出规范"
            tip="汇总各层「输出规范」套件得分（Think 隔离、标签成对、可见答案等）。"
            score={formatAgg?.score ?? null}
            passed={formatAgg?.passed ?? 0}
            total={formatAgg?.total ?? 0}
            emptyHint="本次未跑输出规范套件"
          />
          <ScoreCard
            title="工具调用能力"
            tip="汇总「工具协议」与「问数工具」套件得分（原生 tool_calls、参数、command 选型、往返等）。"
            score={toolsAgg?.score ?? null}
            passed={toolsAgg?.passed ?? 0}
            total={toolsAgg?.total ?? 0}
            emptyHint="本次未跑工具相关套件"
          />
        </div>
        {report.config?.suites?.length > 0 && (
          <p className="mt-3 text-sm text-black/55">
            本次套件：
            {report.config.suites
              .map(
                (s: string) =>
                  ({ format: '输出规范', tools: '工具协议', because: '问数工具' }[s] || s),
              )
              .join('、')}
          </p>
        )}
      </section>

      {layers.map((layer, i) => (
        <CollapsibleLayer key={layer} layer={layer} report={report} defaultOpen={i === 0} />
      ))}
    </>
  );
}
