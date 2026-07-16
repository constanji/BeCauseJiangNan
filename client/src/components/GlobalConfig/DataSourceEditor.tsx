import React, { useEffect, useState } from 'react';
import { useToastContext } from '@because/client';
import { useForm, Controller } from 'react-hook-form';
import { cn, defaultTextProps } from '~/utils';
import { formatConnectionTestErrorFromThrown, formatConnectionTestErrorMessage } from '~/utils/formatConnectionTestError';
import { useTestConnectionMutation } from '~/data-provider/DataSources';
import type { DataSource, DataSourceCreateParams } from '@because/data-provider';
import {
  ArrowLeft,
  Database,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

interface DataSourceEditorProps {
  dataSource?: DataSource;
  onSave: (data: DataSourceCreateParams) => Promise<void>;
  onCancel: () => void;
}

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
      title={label ?? (checked ? '已开启' : '已关闭')}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-transparent',
        checked ? 'bg-green-500' : 'bg-gray-600',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

const DB_TYPES = [
  {
    value: 'mysql',
    label: 'MySQL',
    defaultPort: 3306,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    activeBorder: 'border-green-500',
    logo: '🐬',
  },
  {
    value: 'postgresql',
    label: 'PostgreSQL',
    defaultPort: 5432,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    activeBorder: 'border-green-500',
    logo: '🐘',
  },
  {
    value: 'gaussdb',
    label: 'GaussDB',
    defaultPort: 8000,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    activeBorder: 'border-orange-500',
    logo: '🔴',
  },
];

const defaultSSL = {
  enabled: false,
  rejectUnauthorized: true,
  ca: null,
  cert: null,
  key: null,
};

export default function DataSourceEditor({ dataSource, onSave, onCancel }: DataSourceEditorProps) {
  const { showToast } = useToastContext();
  const testMutation = useTestConnectionMutation();
  const [isTesting, setIsTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isEditing = !!dataSource;

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, isDirty, errors },
    reset,
    watch,
    setValue,
  } = useForm<DataSourceCreateParams>({
    defaultValues: dataSource
      ? {
          name: dataSource.name,
          type: dataSource.type,
          host: dataSource.host,
          port: dataSource.port,
          database: dataSource.database,
          username: dataSource.username,
          password: '',
          connectionPool: dataSource.connectionPool,
          ssl: dataSource.ssl || defaultSSL,
          status: dataSource.status || 'active',
        }
      : {
          name: '',
          type: 'mysql',
          host: '',
          port: 3306,
          database: '',
          username: '',
          password: '',
          connectionPool: { min: 0, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 },
          ssl: defaultSSL,
          status: 'active',
        },
  });

  useEffect(() => {
    if (dataSource) {
      reset({
        name: dataSource.name,
        type: dataSource.type,
        host: dataSource.host,
        port: dataSource.port,
        database: dataSource.database,
        username: dataSource.username,
        password: '',
        connectionPool: dataSource.connectionPool,
        ssl: dataSource.ssl || defaultSSL,
        status: dataSource.status || 'active',
      });
    }
  }, [dataSource, reset]);

  const onSubmit = async (data: DataSourceCreateParams) => {
    try {
      await onSave(data);
    } catch {
      // 错误已在父组件处理
    }
  };

  const handleTestConnection = async () => {
    const formData = watch();
    if (!formData.host || !formData.port || !formData.database || !formData.username || !formData.password) {
      showToast({ message: '请先填写所有必填字段', status: 'error' });
      return;
    }
    setIsTesting(true);
    setTestPassed(false);
    try {
      const result = await testMutation.mutateAsync(formData);
      if (result.success) {
        setTestPassed(true);
        showToast({ message: '连接测试成功', status: 'success' });
      } else {
        showToast({
          message: `连接测试失败：${formatConnectionTestErrorMessage(result)}`,
          status: 'error',
        });
      }
    } catch (error) {
      showToast({
        message: `连接测试失败：${formatConnectionTestErrorFromThrown(error)}`,
        status: 'error',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const dbType = watch('type');
  const sslEnabled = watch('ssl.enabled');
  const status = watch('status');

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col">
        {/* ── 顶部导航栏 ── */}
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border-light text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label="返回"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Database className="h-4 w-4 flex-shrink-0 text-green-500" />
            <h2 className="truncate text-base font-semibold text-text-primary">
              {isEditing ? `编辑 · ${dataSource.name}` : '添加数据源'}
            </h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border-light px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                testPassed
                  ? 'border-green-500 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                  : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
              )}
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : testPassed ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Network className="h-3.5 w-3.5" />
              )}
              {isTesting ? '测试中…' : testPassed ? '测试通过' : '测试连接'}
            </button>
            <button
              type="submit"
              disabled={(!isDirty && isEditing) || isSubmitting}
              className="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        {/* ── 表单内容 ── */}
        <div className="flex-1 overflow-auto">
          <div className="space-y-4">
            {/* 基本信息 */}
            <div className="rounded-xl border border-border-light bg-surface-primary">
              <div className="flex items-center gap-2 border-b border-border-light px-5 py-3.5">
                <Database className="h-4 w-4 text-green-400" />
                <span className="text-sm font-semibold text-text-primary">基本信息</span>
              </div>
              <div className="space-y-5 p-5">
                {/* 名称 */}
                <div>
                  <label className="mb-1.5 text-sm font-medium text-text-primary">
                    数据源名称 <span className="text-red-400">*</span>
                  </label>
                  <Controller
                    name="name"
                    control={control}
                    rules={{ required: '请输入数据源名称' }}
                    render={({ field }) => (
                      <input
                        {...field}
                        className={cn(
                          defaultTextProps,
                          'w-full px-3 py-2',
                          errors.name && 'border-red-400',
                        )}
                        placeholder="例如：生产数据库"
                        autoFocus
                      />
                    )}
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-red-400">{errors.name.message}</p>
                  )}
                </div>

                {/* 数据库类型 */}
                <div>
                  <label className="mb-1.5 text-sm font-medium text-text-primary">
                    数据库类型 <span className="text-red-400">*</span>
                  </label>
                  <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                      <div className="flex gap-3">
                        {DB_TYPES.map(({ value, label, defaultPort, color, bg, activeBorder, logo }) => {
                          const active = field.value === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                field.onChange(value);
                                setValue('port', defaultPort);
                              }}
                              className={cn(
                                'flex flex-1 items-center gap-3 rounded-lg border p-3 text-left transition-all',
                                active
                                  ? `${activeBorder} ${bg}`
                                  : 'border-border-light bg-surface-secondary hover:border-border-medium hover:bg-surface-hover',
                              )}
                            >
                              <span className="text-xl">{logo}</span>
                              <div>
                                <p className={cn('text-sm font-semibold', active ? color : 'text-text-primary')}>
                                  {label}
                                </p>
                                <p className="text-xs text-text-secondary">默认端口 {defaultPort}</p>
                              </div>
                              {active && (
                                <CheckCircle2 className={cn('ml-auto h-4 w-4', color)} />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>

                {/* 状态 */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">启用数据源</p>
                    <p className="mt-0.5 text-xs text-text-secondary">关闭后该数据源将不可用</p>
                  </div>
                  <Controller
                    name="status"
                    control={control}
                    render={({ field }) => (
                      <Toggle
                        checked={field.value === 'active'}
                        onChange={(val) => field.onChange(val ? 'active' : 'inactive')}
                      />
                    )}
                  />
                </div>
              </div>
            </div>

            {/* 连接信息 */}
            <div className="rounded-xl border border-border-light bg-surface-primary">
              <div className="flex items-center gap-2 border-b border-border-light px-5 py-3.5">
                <Network className="h-4 w-4 text-green-400" />
                <span className="text-sm font-semibold text-text-primary">连接信息</span>
              </div>
              <div className="space-y-5 p-5">
                {/* 主机 + 端口 */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="mb-1.5 text-sm font-medium text-text-primary">
                      主机地址 <span className="text-red-400">*</span>
                    </label>
                    <Controller
                      name="host"
                      control={control}
                      rules={{ required: '请输入主机地址' }}
                      render={({ field }) => (
                        <input
                          {...field}
                          className={cn(
                            defaultTextProps,
                            'w-full px-3 py-2',
                            errors.host && 'border-red-400',
                          )}
                          placeholder="localhost 或 IP地址"
                        />
                      )}
                    />
                    {errors.host && (
                      <p className="mt-1 text-xs text-red-400">{errors.host.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 text-sm font-medium text-text-primary">
                      端口 <span className="text-red-400">*</span>
                    </label>
                    <Controller
                      name="port"
                      control={control}
                      rules={{
                        required: '必填',
                        min: { value: 1, message: '> 0' },
                        max: { value: 65535, message: '< 65536' },
                      }}
                      render={({ field }) => (
                        <input
                          {...field}
                          type="number"
                          className={cn(
                            defaultTextProps,
                            'w-full px-3 py-2',
                            errors.port && 'border-red-400',
                          )}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      )}
                    />
                  </div>
                </div>

                {/* 数据库名 */}
                <div>
                  <label className="mb-1.5 text-sm font-medium text-text-primary">
                    数据库名 <span className="text-red-400">*</span>
                  </label>
                  <Controller
                    name="database"
                    control={control}
                    rules={{ required: '请输入数据库名' }}
                    render={({ field }) => (
                      <input
                        {...field}
                        className={cn(
                          defaultTextProps,
                          'w-full px-3 py-2',
                          errors.database && 'border-red-400',
                        )}
                        placeholder="数据库名称"
                      />
                    )}
                  />
                </div>

                {/* 用户名 + 密码 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 text-sm font-medium text-text-primary">
                      用户名 <span className="text-red-400">*</span>
                    </label>
                    <Controller
                      name="username"
                      control={control}
                      rules={{ required: '请输入用户名' }}
                      render={({ field }) => (
                        <input
                          {...field}
                          className={cn(
                            defaultTextProps,
                            'w-full px-3 py-2',
                            errors.username && 'border-red-400',
                          )}
                          placeholder="数据库用户名"
                          autoComplete="username"
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 text-sm font-medium text-text-primary">
                      密码{!isEditing && <span className="text-red-400"> *</span>}
                    </label>
                    <Controller
                      name="password"
                      control={control}
                      rules={{
                        validate: (value) => {
                          if (!isEditing && !value) return '请输入密码';
                          return true;
                        },
                      }}
                      render={({ field }) => (
                        <div className="relative">
                          <input
                            {...field}
                            type={showPassword ? 'text' : 'password'}
                            className={cn(
                              defaultTextProps,
                              'w-full px-3 py-2 pr-9',
                              errors.password && 'border-red-400',
                            )}
                            placeholder={isEditing ? '留空则保持不变' : '数据库密码'}
                            autoComplete="current-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                            tabIndex={-1}
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SSL/TLS */}
            <div className="rounded-xl border border-border-light bg-surface-primary">
              <div className="flex items-center justify-between border-b border-border-light px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-green-400" />
                  <span className="text-sm font-semibold text-text-primary">SSL/TLS 加密</span>
                </div>
                <Controller
                  name="ssl.enabled"
                  control={control}
                  render={({ field }) => (
                    <Toggle
                      checked={field.value || false}
                      onChange={(val) => {
                        field.onChange(val);
                        if (!val) {
                          setValue('ssl.rejectUnauthorized', true);
                          setValue('ssl.ca', null);
                          setValue('ssl.cert', null);
                          setValue('ssl.key', null);
                        }
                      }}
                    />
                  )}
                />
              </div>

              {!sslEnabled ? (
                <p className="px-5 py-4 text-sm text-text-secondary">
                  启用 SSL/TLS 可加密数据传输，建议在生产环境中开启。
                </p>
              ) : (
                <div className="space-y-5 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-text-primary">验证服务器证书</p>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        关闭后允许自签名证书（不推荐用于生产）
                      </p>
                    </div>
                    <Controller
                      name="ssl.rejectUnauthorized"
                      control={control}
                      render={({ field }) => (
                        <Toggle
                          checked={field.value !== undefined ? field.value : true}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 text-sm font-medium text-text-primary">
                      CA 证书 <span className="text-xs font-normal text-text-secondary">（可选）</span>
                    </label>
                    <Controller
                      name="ssl.ca"
                      control={control}
                      render={({ field }) => (
                        <textarea
                          {...field}
                          value={field.value || ''}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          className={cn(defaultTextProps, 'min-h-[80px] w-full px-3 py-2 font-mono text-xs')}
                          placeholder="PEM 格式的 CA 证书内容"
                        />
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 text-sm font-medium text-text-primary">
                        客户端证书 <span className="text-xs font-normal text-text-secondary">（可选）</span>
                      </label>
                      <Controller
                        name="ssl.cert"
                        control={control}
                        render={({ field }) => (
                          <textarea
                            {...field}
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value || null)}
                            className={cn(defaultTextProps, 'min-h-[80px] w-full px-3 py-2 font-mono text-xs')}
                            placeholder="PEM 格式的客户端证书"
                          />
                        )}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 text-sm font-medium text-text-primary">
                        客户端私钥 <span className="text-xs font-normal text-text-secondary">（可选）</span>
                      </label>
                      <Controller
                        name="ssl.key"
                        control={control}
                        render={({ field }) => (
                          <textarea
                            {...field}
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value || null)}
                            className={cn(defaultTextProps, 'min-h-[80px] w-full px-3 py-2 font-mono text-xs')}
                            placeholder="PEM 格式的客户端私钥"
                          />
                        )}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 连接池 */}
            <div className="rounded-xl border border-border-light bg-surface-primary">
              <div className="flex items-center gap-2 border-b border-border-light px-5 py-3.5">
                <SlidersHorizontal className="h-4 w-4 text-green-400" />
                <span className="text-sm font-semibold text-text-primary">连接池</span>
                <span className="ml-auto text-xs text-text-secondary">高级设置</span>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { name: 'connectionPool.min', label: '最小连接数', placeholder: '0', defaultVal: 0 },
                      { name: 'connectionPool.max', label: '最大连接数', placeholder: '10', defaultVal: 10 },
                      {
                        name: 'connectionPool.idleTimeoutMillis',
                        label: '空闲超时（ms）',
                        placeholder: '30000',
                        defaultVal: 30000,
                      },
                      {
                        name: 'connectionPool.connectionTimeoutMillis',
                        label: '连接超时（ms）',
                        placeholder: '10000',
                        defaultVal: 10000,
                      },
                    ] as const
                  ).map(({ name, label, placeholder, defaultVal }) => (
                    <div key={name}>
                      <label className="mb-1.5 text-sm font-medium text-text-primary">{label}</label>
                      <Controller
                        name={name as any}
                        control={control}
                        render={({ field }) => (
                          <input
                            {...field}
                            type="number"
                            className={cn(defaultTextProps, 'w-full px-3 py-2')}
                            placeholder={placeholder}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || defaultVal)}
                          />
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
