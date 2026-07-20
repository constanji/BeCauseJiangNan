import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import HelpTip from '../components/HelpTip';
import ReportPicker from '../components/ReportPicker';
import { layerLabel } from '../lib/labels';

type Side = 'a' | 'b' | 'tie' | null;

function num(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function fmt(v: unknown, suffix = '') {
  if (v == null || v === '') return '—';
  return `${v}${suffix}`;
}

function pickWinner(a: number | null, b: number | null, prefer: 'lower' | 'higher'): Side {
  if (a == null && b == null) return null;
  if (a == null) return 'b';
  if (b == null) return 'a';
  if (a === b) return 'tie';
  if (prefer === 'lower') return a < b ? 'a' : 'b';
  return a > b ? 'a' : 'b';
}

function WinnerMark({ side, col }: { side: Side; col: 'a' | 'b' }) {
  if (side === 'tie') return <span className="ml-1 text-xs text-black/35">持平</span>;
  if (side === col) return <span className="ml-1 text-xs font-medium text-accent">更优</span>;
  return null;
}

function cellClass(side: Side, col: 'a' | 'b') {
  if (side === col) return 'bg-accent/10 font-medium text-ink';
  if (side === 'tie') return 'text-black/70';
  return 'text-black/70';
}

function extractMetrics(detail: any) {
  const report = detail?.report || {};
  const latD = report.latency?.direct;
  const latA = report.latency?.assembled;
  const tpD = report.throughput?.direct;
  const tpA = report.throughput?.assembled;
  return {
    endpoint: detail?.endpoint?.name || report.endpoint?.name || '—',
    model: detail?.model || report.model || '—',
    l3Direct: report.identity?.direct?.l3?.model ?? '—',
    l3Assembled: report.identity?.assembled?.l3?.model ?? '—',
    matchDirect: report.identity?.direct?.match,
    matchAssembled: report.identity?.assembled?.match,
    ttftDirect: num(latD?.ttftMs?.p50),
    ttftAssembled: num(latA?.ttftMs?.p50),
    itlDirect: num(latD?.itlMs?.mean),
    itlAssembled: num(latA?.itlMs?.mean),
    rpmDirect: num(tpD?.rpm),
    rpmAssembled: num(tpA?.rpm),
    tpmDirect: num(tpD?.tpm),
    tpmAssembled: num(tpA?.tpm),
    errDirect: num(tpD?.errorRate),
    errAssembled: num(tpA?.errorRate),
    ctxDirect: num(report.context?.direct?.measuredMaxAccepted),
    ctxAssembled: num(report.context?.assembled?.measuredMaxAccepted),
  };
}

type Row = {
  label: string;
  tip?: string;
  a: string;
  b: string;
  winner: Side;
};

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<any[]>([]);
  const [idA, setIdA] = useState(params.get('a') || '');
  const [idB, setIdB] = useState(params.get('b') || '');
  const [detailA, setDetailA] = useState<any>(null);
  const [detailB, setDetailB] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listReports().then((r) =>
      setList(
        r.data.filter((x) => x.status === 'completed' && x.kind !== 'capability'),
      ),
    );
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (idA) next.set('a', idA);
    if (idB) next.set('b', idB);
    setParams(next, { replace: true });
  }, [idA, idB, setParams]);

  useEffect(() => {
    if (!idA || !idB) {
      setDetailA(null);
      setDetailB(null);
      return;
    }
    if (idA === idB) {
      setError('请选择两条不同的报告');
      setDetailA(null);
      setDetailB(null);
      return;
    }
    setError('');
    setLoading(true);
    Promise.all([api.getReport(idA), api.getReport(idB)])
      .then(([a, b]) => {
        setDetailA(a.data);
        setDetailB(b.data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [idA, idB]);

  const rows: Row[] = useMemo(() => {
    if (!detailA || !detailB) return [];
    const a = extractMetrics(detailA);
    const b = extractMetrics(detailB);

    const mk = (
      label: string,
      tip: string | undefined,
      av: number | null,
      bv: number | null,
      prefer: 'lower' | 'higher',
      suffix = '',
      format?: (n: number | null) => string,
    ): Row => {
      const winner = pickWinner(av, bv, prefer);
      const show = format || ((n) => fmt(n, suffix));
      return { label, tip, a: show(av), b: show(bv), winner };
    };

    return [
      {
        label: '端点',
        a: a.endpoint,
        b: b.endpoint,
        winner: null,
      },
      {
        label: '模型 (L1)',
        a: a.model,
        b: b.model,
        winner: null,
      },
      {
        label: '直连 L3 回包模型',
        tip: '供应商实际回包的模型名',
        a: String(a.l3Direct),
        b: String(b.l3Direct),
        winner: null,
      },
      {
        label: '组装 L3 回包模型',
        a: String(a.l3Assembled),
        b: String(b.l3Assembled),
        winner: null,
      },
      mk('直连 · 首 token 中位 (TTFT)', '越小越快', a.ttftDirect, b.ttftDirect, 'lower', ' ms'),
      mk('组装 · 首 token 中位 (TTFT)', '越小越快', a.ttftAssembled, b.ttftAssembled, 'lower', ' ms'),
      mk(
        '直连 · token 间隔均值 (ITL)',
        '越小越流畅。若为 — 表示网关整段一次返回，无间隔样本；新探测会尝试估算。',
        a.itlDirect,
        b.itlDirect,
        'lower',
        ' ms',
      ),
      mk('组装 · token 间隔均值 (ITL)', undefined, a.itlAssembled, b.itlAssembled, 'lower', ' ms'),
      mk('直连 · 每分钟请求 (RPM)', '越大越好（同并发设定下）', a.rpmDirect, b.rpmDirect, 'higher'),
      mk('组装 · 每分钟请求 (RPM)', undefined, a.rpmAssembled, b.rpmAssembled, 'higher'),
      mk('直连 · 每分钟 Token (TPM)', '越大越好', a.tpmDirect, b.tpmDirect, 'higher'),
      mk('组装 · 每分钟 Token (TPM)', undefined, a.tpmAssembled, b.tpmAssembled, 'higher'),
      mk(
        '直连 · 错误率',
        '越小越好',
        a.errDirect,
        b.errDirect,
        'lower',
        '',
        (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`),
      ),
      mk(
        '组装 · 错误率',
        undefined,
        a.errAssembled,
        b.errAssembled,
        'lower',
        '',
        (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`),
      ),
      mk('直连 · 上下文实测上限', '越大越好（仅开启上下文探测时有值）', a.ctxDirect, b.ctxDirect, 'higher'),
      mk('组装 · 上下文实测上限', undefined, a.ctxAssembled, b.ctxAssembled, 'higher'),
      {
        label: '直连身份是否一致',
        tip: '结论后为供应商实际回包模型名（L3）',
        a:
          a.matchDirect == null
            ? '—'
            : `${a.matchDirect ? '一致' : '不一致'}（${a.l3Direct}）`,
        b:
          b.matchDirect == null
            ? '—'
            : `${b.matchDirect ? '一致' : '不一致'}（${b.l3Direct}）`,
        winner: null,
      },
      {
        label: `组装身份（${layerLabel('assembled')}）是否一致`,
        tip: '结论后为供应商实际回包模型名（L3）',
        a:
          a.matchAssembled == null
            ? '—'
            : `${a.matchAssembled ? '一致' : '不一致'}（${a.l3Assembled}）`,
        b:
          b.matchAssembled == null
            ? '—'
            : `${b.matchAssembled ? '一致' : '不一致'}（${b.l3Assembled}）`,
        winner: null,
      },
    ];
  }, [detailA, detailB]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">报告对比</h1>
      <p className="mt-1 text-sm text-black/60">选择两份已完成的性能报告，对比延迟、吞吐与模型身份</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ReportPicker
          label="报告 A"
          value={idA}
          options={list}
          disabledId={idB}
          onChange={setIdA}
        />
        <ReportPicker
          label="报告 B"
          value={idB}
          options={list}
          disabledId={idA}
          onChange={setIdB}
        />
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
      {loading && <div className="mt-6 text-sm text-black/50">加载中…</div>}

      {!loading && detailA && detailB && (
        <>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-black/50">
            <Link to={`/reports/${idA}`} className="text-accent hover:underline">查看报告 A</Link>
            <Link to={`/reports/${idB}`} className="text-accent hover:underline">查看报告 B</Link>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-black/10 bg-white/80">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-black/[0.03] text-xs text-black/50">
                <tr>
                  <th className="px-4 py-3 w-[32%]">指标</th>
                  <th className="px-4 py-3">报告 A</th>
                  <th className="px-4 py-3">报告 B</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-black/5">
                    <td className="px-4 py-2.5 text-black/65">
                      <span className="inline-flex items-center gap-1">
                        {row.label}
                        {row.tip && <HelpTip text={row.tip} />}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 font-mono text-xs ${cellClass(row.winner, 'a')}`}>
                      {row.a}
                      <WinnerMark side={row.winner} col="a" />
                    </td>
                    <td className={`px-4 py-2.5 font-mono text-xs ${cellClass(row.winner, 'b')}`}>
                      {row.b}
                      <WinnerMark side={row.winner} col="b" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-black/45">
            「更优」按常见评测方向标注：延迟/错误率越低越好，RPM/TPM/上下文越大越好。身份字段不做优劣判断。
          </p>
        </>
      )}

      {!loading && (!idA || !idB) && (
        <div className="mt-8 rounded-xl border border-dashed border-black/15 bg-white/50 px-6 py-12 text-center text-sm text-black/55">
          请先选择两份报告。也可在「报告」列表勾选两条后点「对比这两条」。
        </div>
      )}
    </div>
  );
}
