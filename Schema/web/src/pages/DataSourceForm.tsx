import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Network,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import {
  DB_TYPES,
  DataSourceType,
  UNSUPPORTED_TYPE_MSG,
  isBackendSupported,
  isComingSoon,
} from '../lib/dbTypes';

const defaultSSL = {
  enabled: false,
  rejectUnauthorized: true,
  ca: '',
  cert: '',
  key: '',
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label ?? (checked ? '已开启' : '已关闭')}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-brand' : 'bg-surface-tertiary',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export default function DataSourceForm({ mode }: { mode: 'create' | 'edit' }) {
  const nav = useNavigate();
  const params = useParams();
  const isEditing = mode === 'edit';

  const [form, setForm] = React.useState({
    name: '',
    type: 'gaussdb' as DataSourceType,
    host: '',
    port: 8000,
    database: '',
    username: '',
    password: '',
    status: 'active' as 'active' | 'inactive',
    ssl: defaultSSL,
  });
  const [loading, setLoading] = React.useState(mode === 'edit');
  const [testing, setTesting] = React.useState(false);
  const [testPassed, setTestPassed] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showSsl, setShowSsl] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageTone, setMessageTone] = React.useState<'warning' | 'error' | 'success'>('warning');
  const { showToast } = useToast();

  const supported = isBackendSupported(form.type);
  const comingSoon = isComingSoon(form.type);

  React.useEffect(() => {
    if (mode !== 'edit' || !params.id) return;
    setLoading(true);
    api.getDataSource(params.id)
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载数据源失败');
        if (r.data) {
          const data = r.data as any;
          setForm((prev) => ({
            ...prev,
            ...data,
            type: (data.type || 'gaussdb') as DataSourceType,
            password: '',
            ssl: { ...defaultSSL, ...(data.ssl || {}) },
          }));
          if (data.ssl?.enabled) setShowSsl(true);
        }
      })
      .catch((err) => {
        setMessageTone('error');
        setMessage(err.message || String(err));
      })
      .finally(() => setLoading(false));
  }, [mode, params.id]);

  const payload = () => {
    const body: any = {
      name: form.name,
      type: form.type,
      host: form.host,
      port: Number(form.port),
      database: form.database,
      username: form.username,
      status: form.status,
      ssl: form.ssl,
    };
    if (form.password) body.password = form.password;
    return body;
  };

  const handleTest = async () => {
    if (!supported) {
      setMessageTone('warning');
      setMessage(UNSUPPORTED_TYPE_MSG);
      return;
    }
    if (!form.host || !form.port || !form.database || !form.username) {
      setMessageTone('warning');
      setMessage('请先填写完整的连接信息');
      return;
    }
    if (!form.password && !isEditing) {
      setMessageTone('warning');
      setMessage('测连需要填写密码');
      return;
    }
    setTesting(true);
    setMessage(null);
    setTestPassed(false);
    try {
      const res = isEditing
        ? await api.testDataSource(params.id!)
        : await api.testDataSourceConfig({ ...payload(), password: form.password });
      if (!res.success) throw new Error(res.error || '连接失败');
      setMessageTone('success');
      setMessage('连接成功');
      setTestPassed(true);
    } catch (error: any) {
      setMessageTone('error');
      setMessage(error?.message || String(error));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!supported) {
      setMessageTone('warning');
      setMessage(UNSUPPORTED_TYPE_MSG);
      return;
    }
    setMessage(null);
    const body = payload();
    if (mode === 'create' && !form.password) {
      setMessageTone('warning');
      setMessage('请填写密码');
      return;
    }
    const res = mode === 'edit'
      ? await api.updateDataSource(params.id!, body)
      : await api.createDataSource({ ...body, password: form.password });
    if (!res.success) {
      setMessageTone('error');
      setMessage(res.error || '保存失败');
      showToast(res.error || '保存失败', 'error');
      return;
    }
    showToast(mode === 'edit' ? '数据源更新成功' : '数据源创建成功');
    nav('/');
  };

  const selectType = (value: DataSourceType) => {
    const hit = DB_TYPES.find((item) => item.value === value);
    setForm((prev) => ({
      ...prev,
      type: value,
      port: hit?.defaultPort ?? prev.port,
    }));
    setTestPassed(false);
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center px-4 py-4 text-text-secondary">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="neutral" className="px-2 py-2" onClick={() => nav('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Database className="h-4 w-4 shrink-0 text-brand" />
          <h2 className="truncate text-base font-semibold text-text-primary">
            {isEditing ? `编辑 · ${form.name || '数据源'}` : '添加数据源'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="neutral" className="px-3 py-2" onClick={() => nav('/')}>取消</Button>
          <Button
            variant="neutral"
            className={cn('px-3 py-2', testPassed && 'border-green-500 text-green-400')}
            disabled={testing || !supported}
            onClick={handleTest}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : testPassed ? <CheckCircle2 className="h-4 w-4" /> : <Network className="h-4 w-4" />}
            {testing ? '测试中…' : testPassed ? '测试通过' : '测试连接'}
          </Button>
          <Button variant="primary" className="px-3 py-2" disabled={!supported} onClick={handleSave}>保存</Button>
        </div>
      </div>

      {(!supported || comingSoon) && (
        <div className="mb-4">
          <StatusBanner
            tone="warning"
            title={comingSoon ? '即将支持' : '暂不可用'}
            message={UNSUPPORTED_TYPE_MSG}
          />
        </div>
      )}

      {message && (
        <div className="mb-4">
          <StatusBanner tone={messageTone} title="提示" message={message} />
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-auto pb-4">
        <div className="rounded-xl border border-border-light bg-surface-primary">
          <div className="flex items-center gap-2 border-b border-border-light px-5 py-3.5">
            <Database className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-text-primary">基本信息</span>
          </div>
          <div className="space-y-5 p-5">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-text-primary">
                数据源名称 <span className="text-red-400">*</span>
              </span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：生产数据库"
              />
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-text-primary">
                数据库类型 <span className="text-red-400">*</span>
              </span>
              <div className="flex flex-col gap-3 md:flex-row">
                {DB_TYPES.map(({ value, label, defaultPort, color, bg, activeBorder, logo }) => {
                  const active = form.type === value;
                  const soon = isComingSoon(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => selectType(value)}
                      className={cn(
                        'relative flex flex-1 items-center gap-3 rounded-lg border p-3 text-left transition-all',
                        active ? `${activeBorder} ${bg}` : 'border-border-light bg-surface-secondary hover:border-border-medium',
                        soon && !active && 'opacity-80',
                      )}
                    >
                      <span className="text-xl">{logo}</span>
                      <div>
                        <p className={cn('text-sm font-semibold', active ? color : 'text-text-primary')}>{label}</p>
                        <p className="text-xs text-text-secondary">
                          默认端口 {defaultPort}
                          {soon ? ' · 即将支持' : ''}
                        </p>
                      </div>
                      {active && <CheckCircle2 className={cn('ml-auto h-4 w-4', color)} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">启用数据源</p>
                <p className="mt-0.5 text-xs text-text-secondary">关闭后该数据源将不可用</p>
              </div>
              <Toggle
                checked={form.status === 'active'}
                onChange={(val) => setForm({ ...form, status: val ? 'active' : 'inactive' })}
                label="启用数据源"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border-light bg-surface-primary">
          <div className="flex items-center gap-2 border-b border-border-light px-5 py-3.5">
            <Network className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-text-primary">连接信息</span>
          </div>
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block text-sm md:col-span-2">
                <span className="mb-1.5 block font-medium text-text-primary">
                  主机地址 <span className="text-red-400">*</span>
                </span>
                <input
                  className="input"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="localhost 或 IP 地址"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-text-primary">
                  端口 <span className="text-red-400">*</span>
                </span>
                <input
                  className="input"
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-text-primary">
                数据库名 <span className="text-red-400">*</span>
              </span>
              <input
                className="input"
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-text-primary">
                  用户名 <span className="text-red-400">*</span>
                </span>
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-text-primary">
                  密码 {!isEditing && <span className="text-red-400">*</span>}
                </span>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={isEditing ? '留空表示不修改' : undefined}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border-light bg-surface-primary">
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-border-light px-5 py-3.5 text-left"
            onClick={() => setShowSsl((v) => !v)}
          >
            <ShieldCheck className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-text-primary">SSL 配置（可选）</span>
          </button>
          {showSsl && (
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">启用 SSL</span>
                <Toggle
                  checked={!!form.ssl.enabled}
                  onChange={(val) => setForm({ ...form, ssl: { ...form.ssl, enabled: val } })}
                />
              </div>
              {form.ssl.enabled && (
                <>
                  <label className="block text-sm text-text-secondary">
                    CA
                    <textarea className="input mt-1 min-h-24" value={form.ssl.ca || ''} onChange={(e) => setForm({ ...form, ssl: { ...form.ssl, ca: e.target.value } })} />
                  </label>
                  <label className="block text-sm text-text-secondary">
                    Cert
                    <textarea className="input mt-1 min-h-24" value={form.ssl.cert || ''} onChange={(e) => setForm({ ...form, ssl: { ...form.ssl, cert: e.target.value } })} />
                  </label>
                  <label className="block text-sm text-text-secondary">
                    Key
                    <textarea className="input mt-1 min-h-24" value={form.ssl.key || ''} onChange={(e) => setForm({ ...form, ssl: { ...form.ssl, key: e.target.value } })} />
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
