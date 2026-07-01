import React, { useState } from 'react';
import { Button, useToastContext } from '@because/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import {
  useListDataSourcesQuery,
  useCreateDataSourceMutation,
  useUpdateDataSourceMutation,
  useDeleteDataSourceMutation,
  useTestDataSourceConnectionMutation,
} from '~/data-provider/DataSources';
import { useListAgentsQuery } from '~/data-provider';
import type { DataSource, DataSourceCreateParams } from '@because/data-provider';
import { Plus, Edit, Trash2, TestTube, CheckCircle2, XCircle, Clock, Database, Eye, EyeOff, Sparkles, Bot } from 'lucide-react';
import DataSourceEditor from './DataSourceEditor';
import SemanticModelConfig from './SemanticModelConfig';
import DataSourcePreprocessing from './DataSourcePreprocessing';
import DataSourceAgentBindingModal from './DataSourceAgentBindingModal';

function ExpandActionButton({
  icon: Icon,
  shortLabel,
  fullLabel,
  onClick,
  disabled,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  shortLabel: string;
  fullLabel: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={fullLabel}
      aria-label={fullLabel}
      className={cn(
        'group flex shrink-0 items-center overflow-hidden rounded-lg border border-border-light bg-surface-secondary px-2 py-2 text-sm text-text-primary transition-all duration-200 hover:border-border-medium hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={cn(
          'ml-1 inline-block overflow-hidden whitespace-nowrap transition-[max-width] duration-200 ease-out',
          'max-w-[2em] group-hover:max-w-[7em]',
        )}
      >
        <span className="group-hover:hidden">{shortLabel}</span>
        <span className="hidden group-hover:inline">{fullLabel}</span>
      </span>
    </button>
  );
}

export default function DataSourceManagement() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [showEditor, setShowEditor] = useState(false);
  const [editingDataSource, setEditingDataSource] = useState<DataSource | undefined>(undefined);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [semanticModelDataSourceId, setSemanticModelDataSourceId] = useState<string | null>(null);
  const [preprocessingDataSource, setPreprocessingDataSource] = useState<DataSource | null>(null);
  const [bindingDataSource, setBindingDataSource] = useState<DataSource | null>(null);

  const { data: dataSourcesResponse, isLoading, refetch } = useListDataSourcesQuery();
  const { data: agentsResponse } = useListAgentsQuery();
  const dataSources = dataSourcesResponse?.data || [];
  const agentNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const agent of agentsResponse?.data || []) {
      map[agent.id] = agent.name || agent.id;
    }
    return map;
  }, [agentsResponse?.data]);

  const createMutation = useCreateDataSourceMutation();
  const updateMutation = useUpdateDataSourceMutation();
  const deleteMutation = useDeleteDataSourceMutation();
  const testMutation = useTestDataSourceConnectionMutation();

  const handleCreateNew = () => {
    setEditingDataSource(undefined);
    setShowEditor(true);
  };

  const handleEdit = (dataSource: DataSource) => {
    setEditingDataSource(dataSource);
    setShowEditor(true);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditingDataSource(undefined);
  };

  const handleSave = async (data: DataSourceCreateParams) => {
    try {
      if (editingDataSource) {
        await updateMutation.mutateAsync({
          id: editingDataSource._id,
          data,
        });
        showToast({
          message: '数据源更新成功',
          status: 'success',
        });
      } else {
        await createMutation.mutateAsync(data);
        showToast({
          message: '数据源创建成功',
          status: 'success',
        });
      }
      setShowEditor(false);
      setEditingDataSource(undefined);
      refetch();
    } catch (error) {
      showToast({
        message: `保存失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个数据源吗？此操作无法撤销。')) {
      return;
    }
    try {
      await deleteMutation.mutateAsync({ id });
      showToast({
        message: '数据源删除成功',
        status: 'success',
      });
      refetch();
    } catch (error) {
      showToast({
        message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const result = await testMutation.mutateAsync({ id });
      if (result.success) {
        showToast({
          message: '连接测试成功',
          status: 'success',
        });
      } else {
        showToast({
          message: `连接测试失败: ${result.error || '未知错误'}`,
          status: 'error',
        });
      }
      refetch();
    } catch (error) {
      showToast({
        message: `连接测试失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTogglePublic = async (e: React.MouseEvent, dataSource: DataSource) => {
    e.stopPropagation();
    e.preventDefault();
    
    const newIsPublic = !(dataSource.isPublic ?? false);
    
    try {
      await updateMutation.mutateAsync({
        id: dataSource._id,
        data: {
          isPublic: newIsPublic,
        },
      });
      
      showToast({
        message: newIsPublic ? '已展示数据源' : '已隐藏数据源',
        status: 'success',
      });
    } catch (error) {
      showToast({
        message: `操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  const getStatusIcon = (dataSource: DataSource) => {
    if (dataSource.lastTestResult === 'success') {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    } else if (dataSource.lastTestResult === 'failed') {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
    return <Clock className="h-4 w-4 text-gray-400" />;
  };

  if (semanticModelDataSourceId) {
    return (
      <SemanticModelConfig
        dataSourceId={semanticModelDataSourceId}
        onBack={() => setSemanticModelDataSourceId(null)}
      />
    );
  }

  if (preprocessingDataSource) {
    return (
      <DataSourcePreprocessing
        dataSourceId={preprocessingDataSource._id}
        dataSourceName={preprocessingDataSource.name}
        onBack={() => setPreprocessingDataSource(null)}
      />
    );
  }

  if (showEditor) {
    return (
      <DataSourceEditor
        dataSource={editingDataSource}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">数据源管理</h2>
          <p className="mt-1 text-sm text-text-secondary">
            管理数据库连接配置，支持 MySQL、PostgreSQL 和 GaussDB
          </p>
        </div>
        <Button
          onClick={handleCreateNew}
          className="btn btn-primary relative flex items-center gap-2 rounded-lg px-4 py-2"
        >
          <Plus className="h-4 w-4" />
          新建数据源
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-text-secondary">加载中...</div>
          </div>
        ) : dataSources.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-text-secondary mb-4">暂无数据源</p>
              <Button
                onClick={handleCreateNew}
                className="btn btn-primary relative flex items-center gap-2 rounded-lg px-4 py-2"
              >
                <Plus className="h-4 w-4" />
                创建第一个数据源
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {dataSources.map((dataSource) => (
              <div
                key={dataSource._id}
                className="rounded-lg border border-border-light bg-surface-primary p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-text-primary">{dataSource.name}</h3>
                      {getStatusIcon(dataSource)}
                      <span
                        className={cn(
                          'px-2 py-1 text-xs font-medium rounded',
                          dataSource.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800',
                        )}
                      >
                        {dataSource.status === 'active' ? '已启用' : '已禁用'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                      <div>
                        <span className="text-text-secondary">类型:</span>
                        <span className="ml-2 text-text-primary font-medium">
                          {dataSource.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-secondary">主机:</span>
                        <span className="ml-2 text-text-primary font-medium">
                          {dataSource.host}:{dataSource.port}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-secondary">数据库:</span>
                        <span className="ml-2 text-text-primary font-medium">{dataSource.database}</span>
                      </div>
                      <div>
                        <span className="text-text-secondary">用户名:</span>
                        <span className="ml-2 text-text-primary font-medium">{dataSource.username}</span>
                      </div>
                    </div>
                    {dataSource.lastTestedAt && (
                      <div className="mt-2 text-xs text-text-secondary">
                        最后测试: {new Date(dataSource.lastTestedAt).toLocaleString()}
                        {dataSource.lastTestError && (
                          <span className="ml-2 text-red-500">({dataSource.lastTestError})</span>
                        )}
                      </div>
                    )}
                    {(dataSource.agentIds?.length ?? 0) > 0 && (
                      <div className="mt-3">
                        <span className="text-xs text-text-secondary">已绑定智能体:</span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {dataSource.agentIds!.map((agentId) => (
                            <span
                              key={agentId}
                              className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
                              title={agentId}
                            >
                              {agentNameById[agentId] || agentId}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!updateMutation.isLoading) {
                          handleTogglePublic(e, dataSource);
                        }
                      }}
                      disabled={updateMutation.isLoading}
                      className={cn(
                        'rounded-lg p-2 transition-colors cursor-pointer',
                        (dataSource.isPublic ?? false)
                          ? 'text-green-500 hover:bg-green-500/10'
                          : 'text-text-tertiary hover:bg-surface-hover',
                        updateMutation.isLoading && 'opacity-50 cursor-not-allowed',
                      )}
                      title={(dataSource.isPublic ?? false) ? '已展示给用户（点击隐藏）' : '未展示给用户（点击显示）'}
                      aria-label={(dataSource.isPublic ?? false) ? '隐藏' : '显示'}
                    >
                      {(dataSource.isPublic ?? false) ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </button>
                    <ExpandActionButton
                      icon={Bot}
                      shortLabel="绑定"
                      fullLabel="绑定智能体"
                      onClick={() => setBindingDataSource(dataSource)}
                    />
                    <ExpandActionButton
                      icon={Database}
                      shortLabel="结构"
                      fullLabel="数据库结构"
                      onClick={() => setSemanticModelDataSourceId(dataSource._id)}
                    />
                    <ExpandActionButton
                      icon={Sparkles}
                      shortLabel="处理"
                      fullLabel="数据预处理"
                      onClick={() => setPreprocessingDataSource(dataSource)}
                    />
                    <button
                      type="button"
                      onClick={() => handleTestConnection(dataSource._id)}
                      disabled={testingIds.has(dataSource._id)}
                      title={testingIds.has(dataSource._id) ? '测试中…' : '测试连接'}
                      aria-label="测试连接"
                      className="rounded-lg border border-border-light bg-surface-secondary p-2 text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      <TestTube className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(dataSource)}
                      title="编辑"
                      aria-label="编辑"
                      className="rounded-lg border border-border-light bg-surface-secondary p-2 text-text-primary transition-colors hover:bg-surface-hover"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(dataSource._id)}
                      title="删除"
                      aria-label="删除"
                      className="rounded-lg border border-border-light bg-surface-secondary p-2 text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DataSourceAgentBindingModal
        dataSource={bindingDataSource}
        open={!!bindingDataSource}
        onClose={() => setBindingDataSource(null)}
        onSaved={() => refetch()}
      />
    </div>
  );
}

