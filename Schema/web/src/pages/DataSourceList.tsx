import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  Database,
  Edit,
  Loader2,
  Plus,
  Sparkles,
  TestTube,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import { typeLabel } from '../lib/dbTypes';

function StatusIcon({ ds }: { ds: any }) {
  if (ds.last_test_ok) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (ds.status === 'inactive') return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-text-tertiary" />;
}

function StatusBadge({ ds }: { ds: any }) {
  if (ds.last_test_ok || ds.status === 'active') {
    return (
      <span className="rounded bg-green-500/15 px-2 py-1 text-xs font-medium text-green-400">
        已启用
      </span>
    );
  }
  if (ds.status === 'inactive') {
    return (
      <span className="rounded bg-red-500/15 px-2 py-1 text-xs font-medium text-red-400">
        未连通
      </span>
    );
  }
  return (
    <span className="rounded bg-surface-tertiary px-2 py-1 text-xs font-medium text-text-tertiary">
      未测试
    </span>
  );
}

function IconActionButton({
  title,
  onClick,
  disabled,
  children,
  danger = false,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'rounded-lg border border-border-light bg-surface-secondary p-2 transition-colors disabled:opacity-50',
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-text-primary hover:bg-surface-tertiary',
      )}
    >
      {children}
    </button>
  );
}

export default function DataSourceList() {
  const nav = useNavigate();
  const { showToast } = useToast();
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.listDataSources()
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载数据源失败');
        setItems(r.data || []);
      })
      .catch((err) => {
        showToast(err.message || String(err), 'error');
      })
      .finally(() => setLoading(false));
  };

  React.useEffect(() => { reload(); }, []);

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await api.testDataSource(id);
      if (!res.success) {
        showToast(`连接测试失败：${res.error || '未知错误'}`, 'error');
        return;
      }
      showToast('连接测试成功', 'success');
    } catch (err: any) {
      showToast(`连接测试失败：${err?.message || String(err)}`, 'error');
    } finally {
      setTestingId(null);
      reload();
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除数据源「${name}」？关联 LightSchema 将一并删除。`)) return;
    const res = await api.deleteDataSource(id);
    if (!res.success) {
      showToast(res.error || '删除失败', 'error');
      return;
    }
    showToast('数据源删除成功', 'success');
    reload();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">数据源管理</h2>
          <p className="mt-1 text-sm text-text-secondary">
            管理数据库连接配置，生成 LightSchema 并导出 Excel
          </p>
        </div>
        <Button variant="primary" className="px-4 py-2" onClick={() => nav('/new')}>
          <Plus className="h-4 w-4" />
          新建数据源
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-4">
            <p className="text-text-secondary">暂无数据源</p>
            <Button variant="primary" className="px-4 py-2" onClick={() => nav('/new')}>
              <Plus className="h-4 w-4" />
              创建第一个数据源
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((ds) => (
              <div
                key={ds.id}
                className="rounded-lg border border-border-light bg-surface-primary p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h3 className="text-lg font-semibold text-text-primary">{ds.name}</h3>
                      <StatusIcon ds={ds} />
                      <StatusBadge ds={ds} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-text-secondary">类型:</span>
                        <span className="ml-2 font-medium text-text-primary">{typeLabel(ds.type)}</span>
                      </div>
                      <div>
                        <span className="text-text-secondary">主机:</span>
                        <span className="ml-2 font-medium text-text-primary">{ds.host}:{ds.port}</span>
                      </div>
                      <div>
                        <span className="text-text-secondary">数据库:</span>
                        <span className="ml-2 font-medium text-text-primary">{ds.database}</span>
                      </div>
                      <div>
                        <span className="text-text-secondary">用户名:</span>
                        <span className="ml-2 font-medium text-text-primary">{ds.username}</span>
                      </div>
                    </div>
                    {ds.last_test_at && (
                      <div className="mt-2 text-xs text-text-secondary">
                        最后测试: {new Date(ds.last_test_at).toLocaleString()}
                        {ds.last_test_error && (
                          <span className="ml-2 text-red-400">({ds.last_test_error})</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <Button
                      variant="neutral"
                      className="px-3 py-2"
                      title="LightSchema 分析与导出"
                      onClick={() => nav(`/workbench/${ds.id}`)}
                    >
                      <Sparkles className="h-4 w-4" />
                      数据预处理
                    </Button>
                    <Button
                      variant="neutral"
                      className="px-3 py-2"
                      title="Schema 浏览"
                      onClick={() => nav(`/workbench/${ds.id}`)}
                    >
                      <Database className="h-4 w-4" />
                      数据库结构
                    </Button>
                    <IconActionButton
                      title={testingId === ds.id ? '测试中…' : '测试连接'}
                      disabled={testingId === ds.id}
                      onClick={() => handleTest(ds.id)}
                    >
                      {testingId === ds.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                    </IconActionButton>
                    <IconActionButton title="编辑" onClick={() => nav(`/edit/${ds.id}`)}>
                      <Edit className="h-4 w-4" />
                    </IconActionButton>
                    <IconActionButton
                      title="删除"
                      danger
                      onClick={() => handleDelete(ds.id, ds.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
