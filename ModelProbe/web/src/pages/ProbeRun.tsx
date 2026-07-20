import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Endpoint } from '../api/client';
import FieldLabel from '../components/FieldLabel';
import HelpTip from '../components/HelpTip';
import { statusLabel } from '../lib/labels';

export default function ProbeRun() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointId, setEndpointId] = useState(params.get('endpointId') || '');
  const [model, setModel] = useState('');
  const [layers, setLayers] = useState({ direct: true, assembled: true });
  const [warmup, setWarmup] = useState(1);
  const [latencySamples, setLatencySamples] = useState(3);
  const [concurrency, setConcurrency] = useState(2);
  const [throughputDurationSec, setThroughputDurationSec] = useState(20);
  const [probeGeneration, setProbeGeneration] = useState(true);
  const [decodeMaxTokens, setDecodeMaxTokens] = useState(256);
  const [decodeSamples, setDecodeSamples] = useState(2);
  const [probeLongOutput, setProbeLongOutput] = useState(true);
  const [longOutputMaxTokens, setLongOutputMaxTokens] = useState(256);
  const [probeLongInput, setProbeLongInput] = useState(false);
  const [longInputTokens, setLongInputTokens] = useState(4096);
  const [longInputMaxTokens, setLongInputMaxTokens] = useState(32);
  const [probeContext, setProbeContext] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<any>(null);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listEndpoints().then((r) => {
      setEndpoints(r.data);
      const ep = r.data.find((e) => String(e.id) === endpointId);
      if (ep?.default_model) setModel(ep.default_model);
    });
  }, [endpointId]);

  useEffect(() => {
    if (!taskId) return;
    const t = setInterval(async () => {
      try {
        const data = await api.getTask(taskId);
        setTask(data);
        if (data.status === 'completed') {
          clearInterval(t);
          navigate(`/reports/${taskId}`);
        }
        if (data.status === 'failed') clearInterval(t);
      } catch {
        // ignore
      }
    }, 1500);
    return () => clearInterval(t);
  }, [taskId, navigate]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [task?.statusLogs]);

  const start = async () => {
    setError('');
    if (!endpointId || !model) {
      setError('请选择端点并填写模型');
      return;
    }
    const selectedLayers = [
      ...(layers.direct ? ['direct'] : []),
      ...(layers.assembled ? ['assembled'] : []),
    ];
    if (!selectedLayers.length) {
      setError('至少选择一层探测');
      return;
    }
    try {
      const r = await api.runProbe({
        endpointId: Number(endpointId),
        model,
        config: {
          layers: selectedLayers,
          warmup,
          latencySamples,
          concurrency,
          throughputDurationSec,
          probeGeneration,
          decodeMaxTokens,
          decodeSamples,
          probeLongOutput,
          longOutputMaxTokens,
          probeLongInput,
          longInputTokens,
          longInputMaxTokens,
          probeContext,
        },
      });
      setTaskId(r.taskId);
      setTask({ status: 'pending', progress: 0, statusLogs: [] });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const inputCls = 'mt-1 w-full rounded-lg border border-black/15 px-3 py-2';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">模型探测</h1>
      <p className="mt-1 text-sm text-black/60">
        对比「直连」与「组装」两层请求，测量首 token 延迟、吞吐与模型身份是否一致
      </p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-black/10 bg-white/80 p-6">
          <FieldLabel
            label="端点"
            tip="已保存的模型服务地址。请先在「端点」页配置 Base URL 与 API Key。"
          >
            <select
              value={endpointId}
              onChange={(e) => {
                setEndpointId(e.target.value);
                const ep = endpoints.find((x) => String(x.id) === e.target.value);
                if (ep?.default_model) setModel(ep.default_model);
              }}
              className={inputCls}
            >
              <option value="">— 选择 —</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.name}</option>
              ))}
            </select>
          </FieldLabel>

          <FieldLabel
            label="模型（界面选择值 / L1）"
            tip="你在界面上选择的模型名。报告会对比：L1 选择值、L2 实际发出去的字段、L3 供应商回包里的模型名。"
          >
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={`${inputCls} font-mono text-sm`}
              placeholder="如 gpt-4o、部署名、gemini-2.0-flash"
            />
          </FieldLabel>

          <div className="text-sm">
            <span className="mb-2 flex items-center gap-1.5 font-medium text-black/80">
              探测层
              <HelpTip text="直连层：模型名原样发给供应商。组装层：按 Because/LibreChat 规则改写请求体（如 Azure 部署名、Google 的 modelName），用于发现链路是否改坏了请求。" />
            </span>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layers.direct} onChange={(e) => setLayers({ ...layers, direct: e.target.checked })} />
                直连层（原样发送）
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layers.assembled} onChange={(e) => setLayers({ ...layers, assembled: e.target.checked })} />
                组装层（Because 规则）
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldLabel
              label="预热次数"
              tip="正式采样前先发几次请求，丢掉冷启动影响。一般 1～2 次即可；0 表示不预热。"
            >
              <input type="number" min={0} value={warmup} onChange={(e) => setWarmup(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
            <FieldLabel
              label="延迟采样次数"
              tip="预热后重复测延迟的次数，用于算中位数/P95。次数越多越稳，但更慢。建议 3～5。"
            >
              <input type="number" min={1} value={latencySamples} onChange={(e) => setLatencySamples(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
            <FieldLabel
              label="并发数"
              tip="用于短请求 / 长输出 / 长输入并发段，不是生成速度（生成速度固定单路）。网关限流严时可改成 1。"
            >
              <input type="number" min={1} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
            <FieldLabel
              label="吞吐时长（秒）"
              tip="短请求 / 长输出 / 长输入并发压测持续多久。时间越长越接近稳态，但更耗配额。默认 20 秒。"
            >
              <input type="number" min={5} value={throughputDurationSec} onChange={(e) => setThroughputDurationSec(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
            <FieldLabel
              label="生成采样次数"
              tip="单路生成速度采样次数。用来算 decodeTps / TPOT 中位数。"
            >
              <input type="number" min={1} value={decodeSamples} onChange={(e) => setDecodeSamples(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
            <FieldLabel
              label="生成 max_tokens"
              tip="生成速度阶段每次最多生成多少 token。默认 256。"
            >
              <input type="number" min={32} value={decodeMaxTokens} onChange={(e) => setDecodeMaxTokens(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
            <FieldLabel
              label="长输出 max_tokens"
              tip="长输出并发吞吐每次请求的生成上限。默认 256；越大越费时费配额。"
            >
              <input type="number" min={32} value={longOutputMaxTokens} onChange={(e) => setLongOutputMaxTokens(Number(e.target.value))} className={inputCls} />
            </FieldLabel>
          </div>

          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={probeGeneration}
                onChange={(e) => setProbeGeneration(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                生成速度（单路解码）
                <HelpTip text="短 prompt + 较大 max_tokens，顺序测 decodeTps。回答「模型生成快不快」。默认开启。" />
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={probeLongOutput}
                onChange={(e) => setProbeLongOutput(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                长输出并发吞吐
                <HelpTip text="多路同时长生成，看真实多用户承载。比短 ping 更耗配额。默认开启。" />
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={probeLongInput}
                onChange={(e) => setProbeLongInput(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                长输入并发吞吐
                <HelpTip text="大 prompt（贴近问数上下文）下的并发能力。很费 token，可能压到网关。默认关闭。" />
                <span className="text-black/45">（默认关闭）</span>
              </span>
            </label>
            {probeLongInput && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <FieldLabel label="长输入约 tokens" tip="填充文本目标长度，近似值。">
                  <input type="number" min={512} value={longInputTokens} onChange={(e) => setLongInputTokens(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
                <FieldLabel label="长输入 max_tokens" tip="大输入后只生成少量 token，默认 32。">
                  <input type="number" min={1} value={longInputMaxTokens} onChange={(e) => setLongInputMaxTokens(Number(e.target.value))} className={inputCls} />
                </FieldLabel>
              </div>
            )}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={probeContext}
                onChange={(e) => setProbeContext(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                探测上下文窗口
                <HelpTip text="会用越来越长的文本试探供应商能接受的上限（阶梯 + 二分）。默认关闭：耗时长、费 token，且结果是近似值，不是精确上下文窗口。" />
                <span className="text-black/45">（默认关闭）</span>
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={start}
            disabled={!!taskId && (task?.status === 'running' || task?.status === 'pending')}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            开始探测
          </button>
          <Link to="/reports" className="block text-center text-sm text-accent hover:underline">查看历史报告</Link>
          <Link to="/capability" className="block text-center text-sm text-black/55 hover:text-accent hover:underline">规范与工具探测 →</Link>
        </div>

        <div className="rounded-xl border border-black/10 bg-ink p-4 text-mist">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span>运行日志</span>
            {task && (
              <span>
                {statusLabel(task.status)} · {task.progress ?? 0}%
              </span>
            )}
          </div>
          {task && (
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/15">
              <div className="h-full bg-accent transition-all" style={{ width: `${task.progress ?? 0}%` }} />
            </div>
          )}
          <div ref={logRef} className="max-h-96 overflow-y-auto font-mono text-xs leading-relaxed text-white/85">
            {(task?.statusLogs || []).map((line: string, i: number) => (
              <div key={i} className="py-0.5">{line}</div>
            ))}
            {!task?.statusLogs?.length && <div className="text-white/40">等待任务…点击「开始探测」后这里会显示进度</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
