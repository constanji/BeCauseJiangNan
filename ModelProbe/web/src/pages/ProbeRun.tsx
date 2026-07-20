import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Endpoint } from '../api/client';

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
  const [probeContext, setProbeContext] = useState(true);
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
          probeContext,
        },
      });
      setTaskId(r.taskId);
      setTask({ status: 'pending', progress: 0, statusLogs: [] });
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">模型探测</h1>
      <p className="mt-1 text-sm text-black/60">Direct + Assembled 双层对比 · TTFT / ITL / RPM / TPM / 上下文</p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-black/10 bg-white/80 p-6">
          <label className="block text-sm">
            <span className="font-medium">端点</span>
            <select
              value={endpointId}
              onChange={(e) => {
                setEndpointId(e.target.value);
                const ep = endpoints.find((x) => String(x.id) === e.target.value);
                if (ep?.default_model) setModel(ep.default_model);
              }}
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2"
            >
              <option value="">— 选择 —</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium">模型 (L1 UI 选择值)</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 font-mono text-sm"
              placeholder="gpt-4o / deployment-name / gemini-2.0-flash"
            />
          </label>
          <div className="text-sm">
            <span className="font-medium">探测层</span>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layers.direct} onChange={(e) => setLayers({ ...layers, direct: e.target.checked })} />
                Direct（原样发送）
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layers.assembled} onChange={(e) => setLayers({ ...layers, assembled: e.target.checked })} />
                Assembled（LibreChat 组装）
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label>Warmup<input type="number" min={0} value={warmup} onChange={(e) => setWarmup(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label>延迟采样<input type="number" min={1} value={latencySamples} onChange={(e) => setLatencySamples(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label>并发<input type="number" min={1} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label>吞吐时长(s)<input type="number" min={5} value={throughputDurationSec} onChange={(e) => setThroughputDurationSec(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1" /></label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={probeContext} onChange={(e) => setProbeContext(e.target.checked)} />
            探测上下文窗口（可能较慢）
          </label>
          <button
            type="button"
            onClick={start}
            disabled={!!taskId && task?.status === 'running'}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            开始探测
          </button>
          <Link to="/reports" className="block text-center text-sm text-accent hover:underline">查看历史报告</Link>
        </div>

        <div className="rounded-xl border border-black/10 bg-ink p-4 text-mist">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span>运行日志</span>
            {task && (
              <span>
                {task.status} · {task.progress ?? 0}%
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
              <div key={i}>{line}</div>
            ))}
            {!task?.statusLogs?.length && <div className="text-white/40">等待任务…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
