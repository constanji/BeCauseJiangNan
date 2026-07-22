import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '../api/client';
import FieldLabel from '../components/FieldLabel';

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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    api.getEndpoint(Number(id)).then((r) => {
      const ep = r.data;
      const azure_json = ep.azure ? JSON.stringify(ep.azure, null, 2) : '';
      const drop_params = ep.dropParams?.join(', ') || '';
      const add_params = ep.addParams ? JSON.stringify(ep.addParams, null, 2) : '';
      setForm({
        name: ep.name,
        type: ep.type,
        base_url: ep.base_url,
        api_key: '',
        default_model: ep.default_model || '',
        claimed_context_tokens: ep.claimed_context_tokens ? String(ep.claimed_context_tokens) : '',
        azure_json,
        drop_params,
        add_params,
      });
      setAdvancedOpen(false);
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

  const buildTestBody = () => {
    // 空字段也显式下发，避免编辑态省略 key 后服务端回退到 DB 旧值
    const body: Record<string, unknown> = {
      model: form.default_model,
      name: form.name,
      type: form.type,
      base_url: form.base_url,
      default_model: form.default_model,
      azure: form.azure_json.trim() ? parseJson(form.azure_json) : null,
      dropParams: form.drop_params
        ? form.drop_params.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      addParams: form.add_params.trim() ? parseJson(form.add_params) : {},
    };
    if (form.api_key) body.api_key = form.api_key;
    if (mode === 'edit' && id) body.endpointId = Number(id);
    return body;
  };

  const test = async () => {
    if (!form.default_model) {
      setError('请填写默认模型后再测连');
      return;
    }
    if (!form.base_url) {
      setError('请填写服务地址后再测连');
      return;
    }
    if (mode === 'create' && !form.api_key) {
      setError('新建端点测连必须填写 API Key');
      return;
    }
    setTesting(true);
    setError('');
    try {
      const body = buildTestBody();
      const r =
        mode === 'edit' && id
          ? await api.testEndpoint(Number(id), body)
          : await api.testEndpointDraft(body);
      alert(`测连成功 ${r.data.latencyMs}ms · 回包模型: ${r.data.model || '—'}（已用当前表单配置）`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm';

  return (
    <div className="max-w-xl">
      <Link to="/" className="text-sm text-accent hover:underline">← 返回列表</Link>
      <h1 className="mt-4 text-2xl font-semibold">{mode === 'create' ? '新建端点' : '编辑端点'}</h1>
      {error && (
        <div className="mt-4 whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 text-sm leading-relaxed text-danger">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-black/10 bg-white/80 p-6">
        <FieldLabel label="名称" tip="仅用于本地区分，如「jojo」「生产网关」。">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required />
        </FieldLabel>

        <FieldLabel
          label="类型"
          tip="决定组装层怎么改写请求。普通 OpenAI 兼容网关选 openai 或 custom 即可；Azure / Google 才需要对应类型。"
        >
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className={inputCls}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="服务地址 (Base URL)" tip="OpenAI 兼容接口根路径，一般到 /v1。不要带具体 chat 路径。">
          <input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            className={`${inputCls} font-mono`}
            required
          />
        </FieldLabel>

        <FieldLabel label="API Key" tip="访问该端点的密钥，加密保存在本地 SQLite。">
          <input
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            className={`${inputCls} font-mono`}
            placeholder={mode === 'edit' ? '留空则保持原值' : ''}
          />
        </FieldLabel>

        <FieldLabel
          label="默认模型"
          tip="探测页会自动带出该模型名。ModelScope 等平台通常需要带组织前缀的全名，如 Qwen/Qwen3-32B，不是简称 Qwen3.5-27B。"
        >
          <input
            value={form.default_model}
            onChange={(e) => setForm({ ...form, default_model: e.target.value })}
            className={`${inputCls} font-mono`}
          />
        </FieldLabel>

        <FieldLabel
          label="声明上下文窗口 (tokens)"
          tip="填纯数字，如 128000、262144。不确定请留空。只作对照，默认不会自动去量真实窗口。"
        >
          <input
            value={form.claimed_context_tokens}
            onChange={(e) => setForm({ ...form, claimed_context_tokens: e.target.value })}
            className={inputCls}
            placeholder="例如 128000，可留空"
          />
        </FieldLabel>

        <div className="rounded-lg border border-black/10">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-black/75 hover:bg-black/[0.03]"
          >
            <span>高级选项（Azure / dropParams / addParams）</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>
          {advancedOpen && (
            <div className="space-y-4 border-t border-black/10 px-3 py-4">
              <FieldLabel
                label="Azure 配置 JSON（可选）"
                tip='仅 Azure 类型需要。例：{"azureOpenAIApiDeploymentName":"my-deploy"}。普通端点留空。'
              >
                <textarea
                  rows={3}
                  value={form.azure_json}
                  onChange={(e) => setForm({ ...form, azure_json: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="一般留空"
                />
              </FieldLabel>

              <FieldLabel
                label="丢弃参数 dropParams（可选）"
                tip="组装时从请求体删除的字段，逗号分隔。例：temperature,top_p。网关不认某些参数时再用。"
              >
                <input
                  value={form.drop_params}
                  onChange={(e) => setForm({ ...form, drop_params: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="一般留空"
                />
              </FieldLabel>

              <FieldLabel
                label="追加参数 addParams JSON（可选）"
                tip='组装时往请求体塞额外字段。例：{"user":"probe"}。普通端点留空。'
              >
                <textarea
                  rows={3}
                  value={form.add_params}
                  onChange={(e) => setForm({ ...form, add_params: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="一般留空"
                />
              </FieldLabel>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
            保存
          </button>
          <button type="button" onClick={test} disabled={testing} className="rounded-lg border border-black/15 px-4 py-2 text-sm">
            {testing ? '测连中…' : '测连'}
          </button>
        </div>
        <p className="text-xs text-black/45">测连使用当前表单内容（无需先保存）。编辑时 API Key 留空则沿用已保存密钥。</p>
      </form>
    </div>
  );
}
