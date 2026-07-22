import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Button, useToastContext } from '@because/client';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from '@because/data-provider';
import type { TStartupConfig } from '@because/data-provider';
import { useLocalize, useMCPConnectionStatus, useAuthContext } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { cn } from '~/utils';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  List,
  Grid,
} from 'lucide-react';
import MCPConfigEditor from './MCPConfigEditor';
import { formatConfigSaveToast } from './configSaveToast';

interface MCPManagementProps {
  startupConfig?: TStartupConfig;
}

interface ServerTestingState {
  [serverName: string]: boolean;
}

interface MCPServerConfig {
  serverName: string;
  config: {
    type?: string;
    url?: string;
    chatMenu?: boolean;
    startup?: boolean;
    customUserVars?: Record<string, any>;
    [key: string]: any;
  };
}

export default function MCPManagement({ startupConfig: propStartupConfig }: MCPManagementProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: startupConfigFromQuery, refetch } = useGetStartupConfig();
  const startupConfig = propStartupConfig || startupConfigFromQuery;
  const { connectionStatus, refetch: refetchConnectionStatus } = useMCPConnectionStatus({
    enabled: true,
  });

  const [testingServers, setTestingServers] = useState<ServerTestingState>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [customServers, setCustomServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('detailed');
  const [serverErrorMessages, setServerErrorMessages] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  // 用 ref 持有最新值，不把它放进 useEffect 依赖数组，避免 fetchServers 被反复触发。
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  });

  // 构建通用的 API base
  const getApiBase = useCallback(() => {
    const baseEl = document.querySelector('base');
    const baseHref = baseEl?.getAttribute('href') || '/';
    return baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
  }, []);

  // 构建通用的请求头
  const getHeaders = useCallback(
    (includeContentType = true): HeadersInit => ({
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

  // 组件挂载时自动获取连接状态（仅一次）
  useEffect(() => {
    if (!hasInitializedRef.current && customServers.length > 0 && !isLoading) {
      hasInitializedRef.current = true;
      refetchConnectionStatus().catch(console.error);
    }
  }, [customServers.length, isLoading, refetchConnectionStatus]);

  // 获取 MCP 服务器配置
  useEffect(() => {
    const fetchServers = async () => {
      setIsLoading(true);
      try {
        const apiBase = getApiBase();
        const response = await fetch(`${apiBase}/api/config/mcp/custom`, {
          method: 'GET',
          headers: getHeaders(),
          credentials: 'include',
        });

        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          if (isJson) {
            const errorData = await response.json().catch(() => ({}));
            errorMessage = errorData.error || errorData.message || errorMessage;
          }
          throw new Error(errorMessage);
        }

        if (!isJson) {
          const text = await response.text();
          throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
        }

        const data = await response.json();
        setCustomServers(data.servers || []);
      } catch (error) {
        console.error('Error fetching MCP servers:', error);
        showToastRef.current({
          message: `获取MCP服务器配置失败: ${error instanceof Error ? error.message : '未知错误'}`,
          status: 'error',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchServers();
  }, [getHeaders, getApiBase]);

  // 刷新服务器列表
  const refreshServers = async () => {
    try {
      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/api/config/mcp/custom`, {
        method: 'GET',
        headers: getHeaders(),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('获取MCP服务器配置失败');
      const data = await response.json();
      setCustomServers(data.servers || []);
    } catch (error) {
      console.error('Error refreshing servers:', error);
    }
  };

  const handleCreateNew = () => {
    setEditingServer(undefined);
    setShowEditor(true);
  };

  const handleEdit = (server: MCPServerConfig) => {
    setEditingServer(server);
    setShowEditor(true);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditingServer(undefined);
  };

  const handleSave = async (server: MCPServerConfig) => {
    setIsSaving(true);
    try {
      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/api/config/mcp/custom`, {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ server }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      const result = await response.json().catch(() => ({}));

      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      queryClient.invalidateQueries([QueryKeys.mcpTools]);
      queryClient.invalidateQueries([QueryKeys.tools]);
      await refetch();
      await refreshServers();
      await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      await refetchConnectionStatus();

      const toast = formatConfigSaveToast(result, 'MCP服务器配置保存成功');
      showToast(toast);
      setShowEditor(false);
      setEditingServer(undefined);
    } catch (error) {
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (serverName: string) => {
    if (!confirm(`确定要删除MCP服务器配置 "${serverName}" 吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const apiBase = getApiBase();
      const response = await fetch(
        `${apiBase}/api/config/mcp/custom/${encodeURIComponent(serverName)}`,
        {
          method: 'DELETE',
          headers: getHeaders(false),
          credentials: 'include',
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '删除失败');
      }

      const result = await response.json().catch(() => ({}));
      const toast = formatConfigSaveToast(result, 'MCP服务器配置删除成功');
      showToast(toast);
      queryClient.invalidateQueries([QueryKeys.startupConfig]);
      queryClient.invalidateQueries([QueryKeys.mcpTools]);
      queryClient.invalidateQueries([QueryKeys.tools]);
      await refetch();
      await refreshServers();
      await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      await refetchConnectionStatus();
    } catch (error) {
      showToast({
        message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  // 提取错误消息的辅助函数，处理嵌套的 JSON 格式错误
  const extractErrorMessage = useCallback((message: string): string => {
    if (!message) return '未知错误';
    try {
      try {
        const directParsed = JSON.parse(message);
        if (directParsed.error?.message) return directParsed.error.message;
        if (directParsed.message) return directParsed.message;
      } catch (e) {
        // 不是纯 JSON，继续查找
      }
      const jsonMatch = message.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.error?.message) return parsed.error.message;
        if (parsed.message) return parsed.message;
      }
    } catch (e) {
      // 解析失败，使用原始消息
    }
    return message;
  }, []);

  // 直接更新单个服务器的连接状态缓存（避免 refetch 导致的滚动重置）
  const updateServerStatusInCache = useCallback(
    (serverName: string, connectionState: 'connected' | 'error' | 'disconnected') => {
      queryClient.setQueryData<{ success: boolean; connectionStatus: Record<string, any> }>(
        [QueryKeys.mcpConnectionStatus],
        (old) => ({
          success: true,
          connectionStatus: {
            ...old?.connectionStatus,
            [serverName]: {
              ...(old?.connectionStatus?.[serverName] ?? {}),
              connectionState,
            },
          },
        }),
      );
    },
    [queryClient],
  );

  // 测试连接：支持并行测试，测试完成后直接更新缓存而非 refetch（避免滚动跳顶）
  const handleTestConnection = useCallback(
    async (serverName: string) => {
      const savedScrollTop = scrollContainerRef.current?.scrollTop ?? 0;

      setTestingServers((prev) => ({ ...prev, [serverName]: true }));
      setServerErrorMessages((prev) => {
        const next = { ...prev };
        delete next[serverName];
        return next;
      });

      try {
        const apiBase = getApiBase();
        const response = await fetch(
          `${apiBase}/api/mcp/${encodeURIComponent(serverName)}/reinitialize`,
          {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
          },
        );

        const result = await response.json().catch(() => ({ success: false, message: '响应解析失败' }));

        if (result.success) {
          updateServerStatusInCache(serverName, 'connected');
          setServerErrorMessages((prev) => {
            const next = { ...prev };
            delete next[serverName];
            return next;
          });
          showToast({
            message: `MCP服务器 "${serverName}" 测试连接成功`,
            status: 'success',
          });
        } else {
          const errorMessage = extractErrorMessage(result.error || result.message || '未知错误');
          setServerErrorMessages((prev) => ({ ...prev, [serverName]: errorMessage }));
          updateServerStatusInCache(serverName, 'error');
          showToast({
            message: `MCP服务器 "${serverName}" 测试连接失败: ${errorMessage}`,
            status: 'error',
          });
        }
      } catch (error) {
        const errorMessage = extractErrorMessage(
          error instanceof Error ? error.message : '未知错误',
        );
        setServerErrorMessages((prev) => ({ ...prev, [serverName]: errorMessage }));
        updateServerStatusInCache(serverName, 'error');
        showToast({
          message: `MCP服务器 "${serverName}" 测试连接失败: ${errorMessage}`,
          status: 'error',
        });
      } finally {
        setTestingServers((prev) => ({ ...prev, [serverName]: false }));
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedScrollTop;
          }
        });
      }
    },
    [showToast, getApiBase, getHeaders, extractErrorMessage, updateServerStatusInCache],
  );

  const handleRefreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      await refetchConnectionStatus();
      showToast({ message: '连接状态已刷新', status: 'success' });
    } catch (error) {
      showToast({ message: '刷新连接状态失败', status: 'error' });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, showToast, refetchConnectionStatus]);

  const mcpServerDefinitions = useMemo(() => {
    return customServers.map((server) => ({
      serverName: server.serverName,
      config: {
        ...server.config,
        customUserVars: server.config.customUserVars ?? {},
      },
    }));
  }, [customServers]);

  const getStatusIcon = (connectionState?: string) => {
    switch (connectionState) {
      case 'connected':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'disconnected':
        return <XCircle className="h-4 w-4 text-gray-400" />;
      case 'connecting':
        return <Clock className="h-4 w-4 text-yellow-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <XCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = (connectionState?: string, errorMessage?: string) => {
    if (connectionState === 'error' && errorMessage) {
      const lowerMsg = errorMessage.toLowerCase();
      if (
        lowerMsg.includes('request limit exceeded') ||
        lowerMsg.includes('429') ||
        lowerMsg.includes('rate limit') ||
        lowerMsg.includes('访问达上限') ||
        lowerMsg.includes('访问上限')
      ) {
        return 'API访问达上限';
      }
      if (lowerMsg.includes('not found') || lowerMsg.includes('404')) return '服务器未找到';
      if (lowerMsg.includes('timeout') || lowerMsg.includes('超时')) return '连接超时';
      if (lowerMsg.includes('unauthorized') || lowerMsg.includes('401')) return '认证失败';
      if (lowerMsg.includes('forbidden') || lowerMsg.includes('403')) return '访问被拒绝';
      return errorMessage.length > 50 ? `${errorMessage.substring(0, 50)}...` : errorMessage;
    }
    switch (connectionState) {
      case 'connected':
        return '连接正常';
      case 'disconnected':
        return '未连接';
      case 'connecting':
        return '连接中';
      case 'error':
        return '连接失败';
      default:
        return '未连接';
    }
  };

  const getStatusColor = (connectionState?: string) => {
    switch (connectionState) {
      case 'connected':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'disconnected':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
      case 'connecting':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
      case 'error':
        return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  if (showEditor) {
    return (
      <MCPConfigEditor
        server={editingServer}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">MCP服务器管理</h2>
          <p className="mt-1 text-sm text-text-primary">
            管理MCP服务器配置，可以增删改服务器配置并测试连接
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换按钮 */}
          <div className="flex items-center gap-1 rounded-lg border border-border-light bg-surface-secondary p-1">
            <button
              type="button"
              onClick={() => setViewMode('detailed')}
              className={cn(
                'rounded px-2 py-1 text-sm transition-colors',
                viewMode === 'detailed'
                  ? 'bg-surface-primary text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
              title="详细视图"
              aria-label="详细视图"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={cn(
                'rounded px-2 py-1 text-sm transition-colors',
                viewMode === 'compact'
                  ? 'bg-surface-primary text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
              title="表格视图"
              aria-label="表格视图"
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>
          <Button
            type="button"
            onClick={handleCreateNew}
            className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
          >
            <Plus className="h-4 w-4" />
            添加MCP服务器
          </Button>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-text-secondary">
            <p className="text-sm">加载中...</p>
          </div>
        ) : mcpServerDefinitions.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
            <p className="text-sm">暂无MCP服务器配置</p>
            <p className="text-xs text-text-tertiary">点击右上角"添加MCP服务器"按钮开始创建</p>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === 'compact'
                ? 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3'
                : 'space-y-2',
            )}
          >
            {mcpServerDefinitions.map((server) => {
              const serverStatus = connectionStatus?.[server.serverName];
              const errorMessage = serverErrorMessages[server.serverName];
              const connectionState = errorMessage
                ? 'error'
                : serverStatus?.connectionState ?? 'disconnected';
              const isTesting = testingServers[server.serverName] ?? false;
              const requiresOAuth = serverStatus?.requiresOAuth || false;

              if (viewMode === 'compact') {
                return (
                  <div
                    key={server.serverName}
                    className="relative rounded-lg border border-border-light bg-surface-primary p-3 pr-10"
                  >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(connectionState)}
                      <div className="min-w-0 flex-1">
                        <h4 className="line-clamp-1 text-sm font-semibold text-text-primary">
                          {server.serverName}
                        </h4>
                        <p className="mt-1 text-xs text-text-secondary">
                          {getStatusText(connectionState, errorMessage)}
                        </p>
                      </div>
                    </div>
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleTestConnection(server.serverName);
                        }}
                        disabled={isTesting}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                        title="测试连接"
                        aria-label="测试连接"
                      >
                        <RefreshCw
                          className={cn('h-4 w-4', isTesting && 'animate-spin')}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(server)}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover"
                        title="编辑MCP服务器配置"
                        aria-label="编辑"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(server.serverName)}
                        className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="删除MCP服务器配置"
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              }

              // 详细视图
              return (
                <div
                  key={server.serverName}
                  className="relative rounded-lg border border-border-light bg-surface-primary p-4"
                >
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(server)}
                      className="rounded p-1.5 text-text-secondary hover:bg-surface-hover"
                      title="编辑MCP服务器配置"
                      aria-label="编辑"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(server.serverName)}
                      className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="删除MCP服务器配置"
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mb-3 flex items-center justify-between pr-20">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(connectionState)}
                        <h3 className="text-base font-semibold text-text-primary">
                          {server.serverName}
                        </h3>
                      </div>
                      <span
                        className={cn(
                          'rounded-xl px-2 py-0.5 text-xs font-medium',
                          getStatusColor(connectionState),
                        )}
                      >
                        {getStatusText(connectionState, errorMessage)}
                      </span>
                      {requiresOAuth && (
                        <span className="rounded-xl bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          OAuth
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleTestConnection(server.serverName);
                      }}
                      disabled={isTesting}
                      className="btn btn-neutral border-token-border-light relative flex items-center gap-2 rounded-lg px-3 py-2"
                      aria-label={`测试连接 ${server.serverName}`}
                    >
                      <RefreshCw className={cn('h-4 w-4', isTesting && 'animate-spin')} />
                      {isTesting ? '测试中...' : '测试连接'}
                    </Button>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-text-secondary">
                      <span className="font-medium">连接状态:</span>
                      <span>{getStatusText(connectionState, errorMessage)}</span>
                    </div>
                    {server.config.customUserVars &&
                      Object.keys(server.config.customUserVars).length > 0 && (
                        <div className="flex items-center gap-2 text-text-secondary">
                          <span className="font-medium">自定义变量:</span>
                          <span>{Object.keys(server.config.customUserVars).length} 个</span>
                        </div>
                      )}
                    {server.config.type && (
                      <div className="flex items-center gap-2 text-text-secondary">
                        <span className="font-medium">类型:</span>
                        <span>{server.config.type}</span>
                      </div>
                    )}
                    {server.config.url && (
                      <div className="flex items-center gap-2 text-text-secondary">
                        <span className="font-medium">URL:</span>
                        <span className="truncate text-xs">{server.config.url}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
