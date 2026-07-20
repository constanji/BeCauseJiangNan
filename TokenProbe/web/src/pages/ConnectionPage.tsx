import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Cable, RefreshCw } from 'lucide-react';
import { api, Connection } from '../api/client';

const emptyForm = {
  name: '',
  baseUrl: 'http://localhost:3080',
  email: '',
  password: '',
  agentId: '',
  dataSourceId: '',
  encoding: 'cl100k_base',
};

export default function ConnectionPage() {
  const [list, setList] = useState<Connection[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const load = async () => {
    const res = await api.listConnections();
    setList(res.data || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setError('');
    setMsg('');
    try {
      await api.createConnection({
        name: form.name,
        baseUrl: form.baseUrl,
        email: form.email,
        password: form.password,
        agentId: form.agentId || undefined,
        dataSourceId: form.dataSourceId || undefined,
        encoding: form.encoding,
      });
      setForm(emptyForm);
      setAgents([]);
      setMsg('已保存连接（服务端会自动登录/刷新 JWT，无需手填 token）');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const test = async (id: number) => {
    setError('');
    setMsg('');
    try {
      const res = await api.testConnection(id);
      setMsg(
        res.data?.ok
          ? `连接测试通过${res.data.agentChecked ? '（含 Agent）' : ''}`
          : '健康检查或登录未通过，请检查 Base URL / 账号密码',
      );
    } catch (e: any) {
      setError(e.message);
    }
  };

  const loadAgentsForForm = async () => {
    setError('');
    setMsg('');
    if (!form.baseUrl || !form.email || !form.password) {
      setError('拉取 Agent 前请先填写 Base URL、邮箱、密码');
      return;
    }
    setLoadingAgents(true);
    try {
      const res = await api.previewAgents({
        baseUrl: form.baseUrl,
        email: form.email,
        password: form.password,
      });
      setAgents(res.data || []);
      setMsg(`已加载 ${res.data?.length || 0} 个 Agent`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingAgents(false);
    }
  };

  const loadAgentsForConn = async (id: number) => {
    setError('');
    try {
      const res = await api.listAgents(id);
      setAgents(res.data || []);
      setMsg(`已加载 ${res.data?.length || 0} 个 Agent，可在上方下拉选择后重新保存覆盖默认 Agent`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('删除该连接？')) return;
    await api.deleteConnection(id);
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BeCause 连接</h1>
        <p className="mt-1 text-sm text-black/60">
          与 esb-adapter 相同：填写邮箱/密码即可，服务端自动 login / refresh，无需手抄 JWT。
        </p>
      </div>

      {(error || msg) && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${error ? 'bg-red-50 text-danger' : 'bg-emerald-50 text-accent'}`}
        >
          {error || msg}
        </div>
      )}

      <section className="rounded-xl border border-black/10 bg-white/80 p-4">
        <h2 className="mb-3 font-medium">新建连接</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">名称</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2"
              placeholder="本地开发"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">Base URL</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
              placeholder="http://localhost:3080"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">登录邮箱</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2"
              placeholder="admin@example.com"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">登录密码</span>
            <input
              type="password"
              className="w-full rounded-lg border border-black/10 px-3 py-2"
              placeholder="BeCause 账号密码"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="mb-1 flex items-center justify-between text-black/60">
              <span>默认 Agent ID</span>
              <button
                type="button"
                onClick={loadAgentsForForm}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <RefreshCw className={`h-3 w-3 ${loadingAgents ? 'animate-spin' : ''}`} />
                刷新 Agent 列表
              </button>
            </span>
            {agents.length > 0 ? (
              <select
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                value={form.agentId}
                onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              >
                <option value="">请选择</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
                placeholder="先保存连接后可下拉选择，或手动填 agent_xxx"
                value={form.agentId}
                onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              />
            )}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">默认 data_source_id（可选）</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
              value={form.dataSourceId}
              onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-black/60">Tokenizer encoding</span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
              value={form.encoding}
              onChange={(e) => setForm({ ...form, encoding: e.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={save}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> 保存
        </button>
      </section>

      <section className="rounded-xl border border-black/10 bg-white/80">
        <ul className="divide-y divide-black/5">
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="font-mono text-xs text-black/50">{c.base_url}</div>
                <div className="text-xs text-black/45">
                  {c.email || (c.hasJwt ? '静态 JWT' : '未配置账号')} · agent: {c.agent_id || '—'}
                  {c.hasPassword ? ' · 已存密码' : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => test(c.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5"
                >
                  <Cable className="h-3.5 w-3.5" /> 测试
                </button>
                <button
                  type="button"
                  onClick={() => loadAgentsForConn(c.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Agent
                </button>
                <Link
                  to={`/run?connectionId=${c.id}`}
                  className="rounded-lg bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20"
                >
                  去采集
                </Link>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="rounded-lg p-1.5 text-black/40 hover:bg-red-50 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
          {!list.length && <li className="px-4 py-8 text-center text-sm text-black/45">暂无连接</li>}
        </ul>
      </section>
    </div>
  );
}
