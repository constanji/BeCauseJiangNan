import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, Connection } from '../api/client';

export default function RunPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [list, setList] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState(params.get('connectionId') || '');
  const [mode, setMode] = useState<'live' | 'attach'>('live');
  const [question, setQuestion] = useState('请分析本月存款余额较上月下降的主要原因');
  const [conversationId, setConversationId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [dataSourceId, setDataSourceId] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.listConnections().then((r) => {
      setList(r.data || []);
      if (!connectionId && r.data?.[0]) setConnectionId(String(r.data[0].id));
    });
  }, []);

  const selected = useMemo(
    () => list.find((c) => String(c.id) === String(connectionId)),
    [list, connectionId],
  );

  useEffect(() => {
    if (selected?.agent_id && !agentId) setAgentId(selected.agent_id);
    if (selected?.data_source_id && !dataSourceId) setDataSourceId(selected.data_source_id);
  }, [selected]);

  const start = async () => {
    setError('');
    setRunning(true);
    setLogs([]);
    setProgress(0);
    try {
      const res = await api.runTask({
        connectionId: Number(connectionId),
        mode,
        question: mode === 'live' ? question : undefined,
        conversationId: mode === 'attach' ? conversationId : undefined,
        agentId: agentId || undefined,
        dataSourceId: dataSourceId || undefined,
      });
      const taskId = res.taskId;
      const poll = async () => {
        const snap = await api.getTask(taskId);
        const d = snap.data;
        setProgress(d.progress || 0);
        setLogs(d.statusLogs || []);
        if (d.status === 'completed') {
          setRunning(false);
          navigate(`/reports/${taskId}`);
          return;
        }
        if (d.status === 'failed') {
          setRunning(false);
          setError(d.error || '任务失败');
          return;
        }
        setTimeout(poll, 1500);
      };
      poll();
    } catch (e: any) {
      setRunning(false);
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">链路采集</h1>
        <p className="mt-1 text-sm text-black/60">
          真跑或绑定会话后，基于落库 <code className="font-mono text-xs">Message.content</code> 与工具
          I/O 做重构统计（非每轮 LLM 精确帧）。
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-black/10 bg-white/80 p-4">
        <label className="block text-sm">
          <span className="mb-1 block text-black/60">BeCause 连接</span>
          <select
            className="w-full rounded-lg border border-black/10 px-3 py-2"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            <option value="">请选择</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === 'live'}
              onChange={() => setMode('live')}
            />
            真跑采集（发问）
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === 'attach'}
              onChange={() => setMode('attach')}
            />
            绑定已有 conversationId
          </label>
        </div>

        {mode === 'live' ? (
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">典型问句</span>
            <textarea
              className="min-h-[88px] w-full rounded-lg border border-black/10 px-3 py-2"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">conversationId</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
            />
          </label>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">Agent ID（可覆盖连接默认）</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">data_source_id</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
              value={dataSourceId}
              onChange={(e) => setDataSourceId(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          disabled={running || !connectionId}
          onClick={start}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? `进行中 ${progress}%` : '开始'}
        </button>
      </section>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      {logs.length > 0 && (
        <pre className="max-h-64 overflow-auto rounded-xl border border-black/10 bg-ink/95 p-3 font-mono text-xs text-emerald-100">
          {logs.join('\n')}
        </pre>
      )}
    </div>
  );
}
