import React, { useState, useMemo, useEffect } from 'react';
import { useToastContext } from '@because/client';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from '@because/data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import { Plus, Settings, ChevronDown, X, Trash2 } from 'lucide-react';
import EndpointConfigEditor from './EndpointConfigEditor';
import { formatConfigSaveToast } from './configSaveToast';

interface EndpointConfig {
  name: string;
  apiKey: string;
  baseURL: string;
  models: {
    default: string[];
    fetch?: boolean;
  };
  titleConvo?: boolean;
  titleModel?: string;
  modelDisplayLabel?: string;
  iconURL?: string;
  dropParams?: string[];
  forceStringContent?: boolean;
}

interface EndpointsConfigProps {
  startupConfig?: any;
}

export default function EndpointsConfig({ startupConfig: propStartupConfig }: EndpointsConfigProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: startupConfigFromQuery, refetch } = useGetStartupConfig();
  const startupConfig = propStartupConfig || startupConfigFromQuery;

  const [showEditor, setShowEditor] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<EndpointConfig | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());
  const [addingModelToEndpoint, setAddingModelToEndpoint] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState('');

  const [customEndpoints, setCustomEndpoints] = useState<EndpointConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 获取端点配置
  useEffect(() => {
    const fetchEndpoints = async () => {
      setIsLoading(true);
      try {
        const baseEl = document.querySelector('base');
        const baseHref = baseEl?.getAttribute('href') || '/';
        const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${apiBase}/api/config/endpoints/custom`, {
          method: 'GET',
          headers,
          credentials: 'include',
        });

        // 检查响应内容类型
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          
          if (isJson) {
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
              // JSON 解析失败，使用默认错误信息
            }
          } else {
            // 如果不是 JSON，可能是 HTML 错误页面
            const text = await response.text().catch(() => '');
            if (text.includes('<!DOCTYPE') || text.includes('<html')) {
              errorMessage = `服务器返回了 HTML 页面而不是 JSON。可能是认证失败或路由错误。状态码: ${response.status}`;
            } else {
              errorMessage = text || errorMessage;
            }
          }
          
          throw new Error(errorMessage);
        }

        if (!isJson) {
          const text = await response.text();
          throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
        }

        const data = await response.json();
        setCustomEndpoints(data.endpoints || []);
      } catch (error) {
        console.error('Error fetching endpoints:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        showToast({
          message: `获取端点配置失败: ${errorMessage}`,
          status: 'error',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchEndpoints();
  }, [showToast, token]);

  // 刷新端点列表
  const refreshEndpoints = async () => {
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}/api/config/endpoints/custom`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('获取端点配置失败');
      }

      const data = await response.json();
      setCustomEndpoints(data.endpoints || []);
    } catch (error) {
      console.error('Error refreshing endpoints:', error);
    }
  };

  const handleCreateNew = () => {
    setEditingEndpoint(undefined);
    setShowEditor(true);
  };

  const handleEdit = (endpoint: EndpointConfig) => {
    setEditingEndpoint(endpoint);
    setShowEditor(true);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditingEndpoint(undefined);
  };

  const handleSave = async (endpoint: EndpointConfig) => {
    setIsSaving(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}/api/config/endpoints/custom`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ endpoint }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      const result = await response.json().catch(() => ({}));
      const toast = formatConfigSaveToast(result, '端点配置保存成功');
      showToast(toast);

      // 清除缓存并刷新配置（含端点与模型列表，避免编辑智能体时选择提供商后不显示可用模型）
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      queryClient.invalidateQueries([QueryKeys.endpoints]);
      await queryClient.refetchQueries({ queryKey: [QueryKeys.models] });
      await Promise.all([refetch(), refreshEndpoints()]);
      setShowEditor(false);
      setEditingEndpoint(undefined);
    } catch (error) {
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (endpointName: string) => {
    if (!confirm(`确定要删除端点配置 "${endpointName}" 吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {};
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}/api/config/endpoints/custom/${encodeURIComponent(endpointName)}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '删除失败');
      }

      const result = await response.json().catch(() => ({}));
      const toast = formatConfigSaveToast(result, '端点配置删除成功');
      showToast(toast);

      // 清除缓存并刷新配置（含端点与模型列表）
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      queryClient.invalidateQueries([QueryKeys.endpoints]);
      await queryClient.refetchQueries({ queryKey: [QueryKeys.models] });
      await refetch();
      await refreshEndpoints();
    } catch (error) {
      showToast({
        message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  const handleQuickAddModel = async (endpoint: EndpointConfig, modelName: string) => {
    if (!modelName.trim()) {
      showToast({
        message: '模型名称不能为空',
        status: 'error',
      });
      return;
    }

    // 检查模型是否已存在
    if (endpoint.models?.default?.includes(modelName.trim())) {
      showToast({
        message: '该模型已存在',
        status: 'error',
      });
      setNewModelName('');
      setAddingModelToEndpoint(null);
      return;
    }

    setIsSaving(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const updatedEndpoint: EndpointConfig = {
        ...endpoint,
        models: {
          ...endpoint.models,
          default: [...(endpoint.models?.default || []), modelName.trim()],
        },
      };

      const response = await fetch(`${apiBase}/api/config/endpoints/custom`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ endpoint: updatedEndpoint }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      // 清除缓存并刷新配置（含模型列表）
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      queryClient.invalidateQueries([QueryKeys.endpoints]);
      await queryClient.refetchQueries({ queryKey: [QueryKeys.models] });
      await Promise.all([refetch(), refreshEndpoints()]);
      
      setNewModelName('');
      setAddingModelToEndpoint(null);
      showToast({
        message: '模型添加成功',
        status: 'success',
      });
    } catch (error) {
      showToast({
        message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickRemoveModel = async (endpoint: EndpointConfig, modelName: string) => {
    if (!confirm(`确定要删除模型 "${modelName}" 吗？`)) {
      return;
    }

    setIsSaving(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const updatedEndpoint: EndpointConfig = {
        ...endpoint,
        models: {
          ...endpoint.models,
          default: (endpoint.models?.default || []).filter((m) => m !== modelName),
        },
      };

      const response = await fetch(`${apiBase}/api/config/endpoints/custom`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ endpoint: updatedEndpoint }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      // 清除缓存并刷新配置（含模型列表）
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      queryClient.invalidateQueries([QueryKeys.endpoints]);
      await queryClient.refetchQueries({ queryKey: [QueryKeys.models] });
      await Promise.all([refetch(), refreshEndpoints()]);
      
      showToast({
        message: '模型删除成功',
        status: 'success',
      });
    } catch (error) {
      showToast({
        message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 如果显示编辑器，渲染编辑器
  if (showEditor) {
    return (
      <EndpointConfigEditor
        endpoint={editingEndpoint}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  // 显示端点列表
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">端点配置</h2>
          <p className="mt-1 text-sm text-text-primary">
            管理自定义端点配置
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreateNew}
          className="flex items-center gap-2 rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600"
        >
          <Plus className="h-4 w-4" />
          添加端点配置
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-text-secondary">
            <p className="text-sm">加载中...</p>
          </div>
        ) : customEndpoints.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
            <p className="text-sm">暂无端点配置</p>
            <p className="text-xs text-text-tertiary">
              点击右上角"添加端点配置"按钮开始创建
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {customEndpoints.map((endpoint) => {
              const models = endpoint.models?.default || [];
              const hasModels = models.length > 0 || endpoint.models?.fetch;
              const isExpanded = expandedEndpoints.has(endpoint.name);

              const toggleExpand = () => {
                setExpandedEndpoints((prev) => {
                  const next = new Set(prev);
                  if (next.has(endpoint.name)) {
                    next.delete(endpoint.name);
                  } else {
                    next.add(endpoint.name);
                  }
                  return next;
                });
              };

              const renderAddModelControl = (fullWidth = false) => {
                if (addingModelToEndpoint === endpoint.name) {
                  return (
                    <div
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border border-green-500/40 bg-green-500/10 px-2.5 py-1.5',
                        fullWidth && 'w-full',
                      )}
                    >
                      <input
                        type="text"
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleQuickAddModel(endpoint, newModelName);
                          } else if (e.key === 'Escape') {
                            setNewModelName('');
                            setAddingModelToEndpoint(null);
                          }
                        }}
                        placeholder="输入模型名称"
                        className={cn(
                          'border-none bg-transparent text-xs font-medium text-text-primary outline-none placeholder:text-text-tertiary',
                          fullWidth ? 'min-w-0 flex-1 text-sm' : 'h-5 w-28',
                        )}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleQuickAddModel(endpoint, newModelName)}
                        className="flex h-5 w-5 items-center justify-center rounded text-green-400 hover:bg-green-500/20"
                        title="确认添加"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewModelName('');
                          setAddingModelToEndpoint(null);
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-surface-hover"
                        title="取消"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={() => {
                      setAddingModelToEndpoint(endpoint.name);
                      setNewModelName('');
                    }}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-lg border border-dashed border-green-500/30 px-2.5 py-1.5 text-xs font-medium text-green-400 transition-colors hover:border-green-500/50 hover:bg-green-500/10',
                      fullWidth && 'w-full justify-center py-2',
                    )}
                    title="添加模型"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>添加模型</span>
                  </button>
                );
              };

              return (
                <div
                  key={endpoint.name}
                  className={cn(
                    'overflow-hidden rounded-xl border bg-surface-primary transition-colors',
                    isExpanded ? 'border-green-500/30' : 'border-border-light',
                  )}
                >
                  <div className="group flex items-center justify-between px-4 py-3">
                    <button
                      type="button"
                      onClick={toggleExpand}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 flex-shrink-0 transition-transform duration-200',
                          isExpanded ? 'rotate-180 text-green-400' : 'text-text-secondary',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-text-primary">{endpoint.name}</span>
                          <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-xs text-text-secondary">
                            {models.length} 个模型
                          </span>
                          {endpoint.models?.fetch && (
                            <span className="rounded-md border border-green-500/20 bg-green-500/10 px-1.5 py-0.5 text-xs text-green-400">
                              自动获取
                            </span>
                          )}
                        </div>
                        {endpoint.baseURL && (
                          <p className="mt-0.5 truncate text-xs text-text-tertiary">{endpoint.baseURL}</p>
                        )}
                      </div>
                    </button>
                    <div className="ml-2 flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(endpoint);
                        }}
                        className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                        title="编辑端点配置"
                        aria-label="编辑"
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(endpoint.name);
                        }}
                        className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title="删除端点配置"
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border-light bg-surface-secondary/40 px-4 py-4">
                      {hasModels ? (
                        <div className="space-y-3">
                          {models.length > 0 && (
                            <div>
                              <div className="mb-2.5 text-xs font-medium text-text-secondary">
                                已配置模型
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {models.map((model) => (
                                  <div
                                    key={model}
                                    className="group inline-flex items-center gap-1 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-text-primary"
                                  >
                                    <span className="max-w-[200px] truncate">{model}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleQuickRemoveModel(endpoint, model)}
                                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-text-secondary opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                                      title="删除模型"
                                      aria-label="删除模型"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                                {renderAddModelControl()}
                              </div>
                            </div>
                          )}
                          {models.length === 0 && endpoint.models?.fetch && (
                            <div className="flex flex-wrap gap-2">{renderAddModelControl(true)}</div>
                          )}
                          {endpoint.models?.fetch && (
                            <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2">
                              <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                              <span className="text-xs font-medium text-green-400">
                                已启用自动获取模型列表
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-lg border border-dashed border-border-light py-6 text-center">
                            <p className="text-xs text-text-tertiary">暂无模型配置</p>
                          </div>
                          {renderAddModelControl(true)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

