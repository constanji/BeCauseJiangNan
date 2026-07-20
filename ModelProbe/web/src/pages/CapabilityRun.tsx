import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Endpoint } from '../api/client';
import FieldLabel from '../components/FieldLabel';
import HelpTip from '../components/HelpTip';
import { statusLabel } from '../lib/labels';

export default function CapabilityRun() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointId, setEndpointId] = useState(params.get('endpointId') || '');
  const [model, setModel] = useState('');
  const [layers, setLayers] = useState({ direct: true, assembled: true });
  const [suites, setSuites] = useState({ format: true, tools: true, because: true });
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
        const data = await api.getCapabilityTask(taskId);
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
    const selectedSuites = [
      ...(suites.format ? ['format'] : []),
      ...(suites.tools ? ['tools'] : []),
      ...(suites.because ? ['because'] : []),
    ];
    if (!selectedLayers.length) {
      setError('至少选择一层探测');
      return;
    }
    if (!selectedSuites.length) {
      setError('至少选择一个测试套件');
      return;
    }
    try {
      setTaskId(null);
      setTask({ status: 'pending', progress: 0, statusLogs: [`准备启动：套件 ${selectedSuites.join('、')}`] });
      const r = await api.runCapability({
        endpointId: Number(endpointId),
        model,
        config: { layers: selectedLayers, suites: selectedSuites },
      });
      setTaskId(r.taskId);
      setTask({
        status: 'pending',
        progress: 0,
        statusLogs: [`已提交任务 ${r.taskId}，套件：${selectedSuites.join('、')}`],
      });
    } catch (err: any) {
      setError(err.message);
      setTask(null);
    }
  };

  const inputCls = 'mt-1 w-full rounded-lg border border-black/15 px-3 py-2';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">规范与工具探测</h1>
      <p className="mt-1 text-sm text-black/60">
        检查 Think 是否泄漏到正文、能否产出合法 tool_calls，以及 mock 工具往返
      </p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-black/10 bg-white/80 p-6">
          <FieldLabel label="端点" tip="已配置的模型服务。">
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

          <FieldLabel label="模型" tip="与性能探测相同，支持 Direct / Assembled 双层。">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={`${inputCls} font-mono text-sm`}
            />
          </FieldLabel>

          <div className="text-sm">
            <span className="mb-2 flex items-center gap-1.5 font-medium text-black/80">
              探测层
              <HelpTip text="直连 vs Because 组装规则，对比 tools 是否被组装层丢弃。" />
            </span>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layers.direct} onChange={(e) => setLayers({ ...layers, direct: e.target.checked })} />
                直连层
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layers.assembled} onChange={(e) => setLayers({ ...layers, assembled: e.target.checked })} />
                组装层
              </label>
            </div>
          </div>

          <div className="text-sm">
            <span className="mb-2 flex items-center gap-1.5 font-medium text-black/80">
              测试套件
              <HelpTip text="输出规范=Think 隔离；工具协议=默认 mock（get_weather 等）；问数工具=Because-2.0 的 because_skills_2 schema，只测 command 选型与 mock 往返，不连真实数据源。" />
            </span>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={suites.format} onChange={(e) => setSuites({ ...suites, format: e.target.checked })} />
                输出规范
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={suites.tools} onChange={(e) => setSuites({ ...suites, tools: e.target.checked })} />
                工具协议（默认 mock）
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={suites.because} onChange={(e) => setSuites({ ...suites, because: e.target.checked })} />
                问数工具（Because-2.0）
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={start}
            disabled={!!taskId && (task?.status === 'running' || task?.status === 'pending')}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            开始探测
          </button>
          <div className="flex justify-center gap-4 text-sm">
            <Link to="/probe" className="text-accent hover:underline">性能探测</Link>
            <Link to="/reports" className="text-accent hover:underline">历史报告</Link>
          </div>
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
            {!task?.statusLogs?.length && <div className="text-white/40">等待任务…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
