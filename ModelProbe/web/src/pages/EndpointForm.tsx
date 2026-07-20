import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

const TYPES = ['openai', 'custom', 'azure', 'azureOpenAI', 'google', 'anthropic'];

type Props = { mode: 'create' | 'edit' };

export default function EndpointForm({ mode }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    type: 'openai',
    base_url: '',
    api_key: '',
    default_model: '',
    claimed_context_tokens: '',
    azure_json: '',
    drop_params: '',
    add_params: '',
  });
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    api.getEndpoint(Number(id)).then((r) => {
      const ep = r.data;
      setForm({
        name: ep.name,
        type: ep.type,
        base_url: ep.base_url,
        api_key: '',
        default_model: ep.default_model || '',
        claimed_context_tokens: ep.claimed_context_tokens ? String(ep.claimed_context_tokens) : '',
        azure_json: ep.azure ? JSON.stringify(ep.azure, null, 2) : '',
        drop_params: ep.dropParams?.join(', ') || '',
        add_params: ep.addParams ? JSON.stringify(ep.addParams, null, 2) : '',
      });
    });
  }, [mode, id]);

  const parseJson = (s: string) => {
    if (!s.trim()) return undefined;
    return JSON.parse(s);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        base_url: form.base_url,
        default_model: form.default_model || undefined,
        claimed_context_tokens: form.claimed_context_tokens ? Number(form.claimed_context_tokens) : undefined,
        azure: form.azure_json.trim() ? parseJson(form.azure_json) : undefined,
        dropParams: form.drop_params
          ? form.drop_params.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
        addParams: form.add_params.trim() ? parseJson(form.add_params) : undefined,
      };
      if (form.api_key) body.api_key = form.api_key;

      if (mode === 'create') {
        if (!form.api_key) throw new Error('新建端点必须填写 API Key');
        body.api_key = form.api_key;
        await api.createEndpoint(body);
      } else {
        await api.updateEndpoint(Number(id), body);
      }
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const test = async () => {
    if (!id || !form.default_model) {
      setError('请先保存并填写默认模型');
      return;
    }
    setTesting(true);
    setError('');
    try {
      const r = await api.testEndpoint(Number(id), form.default_model);
      alert(`测连成功 ${r.data.latencyMs}ms · 回包模型: ${r.data.model || '—'}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const field = (label: string, key: keyof typeof form, opts?: { textarea?: boolean; mono?: boolean }) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-black/75">{label}</span>
      {opts?.textarea ? (
        <textarea
          rows={3}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          className={`w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm ${opts.mono ? 'font-mono' : ''}`}
        />
      ) : (
        <input
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          className={`w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm ${opts?.mono ? 'font-mono' : ''}`}
        />
      )}
    </label>
  );

  return (
    <div className="max-w-xl">
      <Link to="/" className="text-sm text-accent hover:underline">← 返回列表</Link>
      <h1 className="mt-4 text-2xl font-semibold">{mode === 'create' ? '新建端点' : '编辑端点'}</h1>
      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-black/10 bg-white/80 p-6">
        {field('名称', 'name')}
        <label className="block">
          <span className="mb-1 block text-sm font-medium">类型</span>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        {field('Base URL', 'base_url', { mono: true })}
        {field('API Key', 'api_key', { mono: true })}
        {mode === 'edit' && <p className="text-xs text-black/50">留空 API Key 则保持原值</p>}
        {field('默认模型', 'default_model', { mono: true })}
        {field('声明上下文窗口 (tokens)', 'claimed_context_tokens')}
        {field('Azure JSON (可选)', 'azure_json', { textarea: true, mono: true })}
        {field('dropParams (逗号分隔)', 'drop_params', { mono: true })}
        {field('addParams JSON (可选)', 'add_params', { textarea: true, mono: true })}
        <div className="flex gap-3 pt-2">
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
            保存
          </button>
          {mode === 'edit' && (
            <button type="button" onClick={test} disabled={testing} className="rounded-lg border border-black/15 px-4 py-2 text-sm">
              {testing ? '测连中…' : '测连'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
