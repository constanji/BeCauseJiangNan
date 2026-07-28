import React, { useState, useEffect } from 'react';
import { Button, useToastContext } from '@because/client';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import { getDatApiBaseUrl } from '~/utils/datApi';
import * as Ariakit from '@ariakit/react';
import { RefreshCw, User as UserIcon, Mail, Calendar, Download, Eye, X, List, Grid, Settings, Shield, User, Trash2, Network, Pencil } from 'lucide-react';

interface User {
  _id: string;
  email: string;
  username?: string | null;
  name?: string | null;
  avatar?: string | null;
  provider: string;
  role: string;
  orgCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserMemory {
  key: string;
  value: string;
  updated_at: string;
  tokenCount?: number;
}

interface UserMemoriesResponse {
  success: boolean;
  userId: string;
  userEmail: string;
  userName: string;
  memories: UserMemory[];
  totalTokens: number;
  count: number;
}

export default function UsersManagement() {
  const { showToast } = useToastContext();
  const { token, user: currentUser } = useAuthContext();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewingMemories, setViewingMemories] = useState<string | null>(null);
  const [memoriesData, setMemoriesData] = useState<UserMemoriesResponse | null>(null);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('detailed');
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // 获取用户列表
  const fetchUsers = async () => {
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

      const response = await fetch(`${apiBase}/api/user/list`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      // 检查响应内容类型
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = '获取用户列表失败';
        if (isJson) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            // JSON 解析失败，尝试获取文本
            const text = await response.text().catch(() => '');
            errorMessage = text || errorMessage;
          }
        } else {
          // 非 JSON 响应（可能是 HTML 错误页面）
          const text = await response.text().catch(() => '');
          errorMessage = text.includes('<!DOCTYPE') 
            ? '服务器返回了错误页面，请检查 API 端点配置' 
            : text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // 确保响应是 JSON 格式
      if (!isJson) {
        const text = await response.text();
        throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
      }

      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      showToast({
        message: `获取用户列表失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return '管理员';
      case 'USER':
        return '用户';
      default:
        return role;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'USER':
        return 'bg-white-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  // 获取用户记忆
  const fetchUserMemories = async (userId: string) => {
    setIsLoadingMemories(true);
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

      const response = await fetch(`${apiBase}/api/user/${userId}/memories`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      // 检查响应内容类型
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = '获取用户记忆失败';
        if (isJson) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            const text = await response.text().catch(() => '');
            errorMessage = text || errorMessage;
          }
        } else {
          const text = await response.text().catch(() => '');
          errorMessage = text.includes('<!DOCTYPE') 
            ? '服务器返回了错误页面，请检查 API 端点配置' 
            : text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      if (!isJson) {
        const text = await response.text();
        throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
      }

      const data = await response.json();
      setMemoriesData(data);
      setViewingMemories(userId);
    } catch (error) {
      console.error('Error fetching user memories:', error);
      showToast({
        message: `获取用户记忆失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setIsLoadingMemories(false);
    }
  };

  // 导出记忆为JSON
  const exportMemories = () => {
    if (!memoriesData) return;

    const exportData = {
      userId: memoriesData.userId,
      userEmail: memoriesData.userEmail,
      userName: memoriesData.userName,
      exportDate: new Date().toISOString(),
      totalMemories: memoriesData.count,
      totalTokens: memoriesData.totalTokens,
      memories: memoriesData.memories,
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `memories_${memoriesData.userEmail}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast({
      message: '记忆导出成功',
      status: 'success',
    });
  };

  // 关闭记忆查看
  const closeMemoriesView = () => {
    setViewingMemories(null);
    setMemoriesData(null);
  };

  // 角色选择菜单组件
  const RoleMenu = ({ user }: { user: User }) => {
    const menuStore = Ariakit.useMenuStore();
    const isOpen = menuStore.useState('open');
    const isCurrentUser = currentUser?.id === user._id;
    const isCurrentUserAdmin = isCurrentUser && currentUser?.role === 'ADMIN';

    return (
      <Ariakit.MenuProvider store={menuStore}>
        <Ariakit.MenuButton
          className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
          title="设置角色"
          aria-label="设置角色"
          disabled={updatingRole === user._id}
        >
          <Settings className="h-4 w-4" />
        </Ariakit.MenuButton>
        <Ariakit.Menu
          portal
          className="z-50 min-w-[180px] rounded-lg border border-border-light bg-surface-primary p-1 shadow-lg"
        >
          <Ariakit.MenuItem
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-text-primary outline-none transition-colors hover:bg-surface-hover',
              user.role === 'ADMIN' && 'bg-surface-secondary',
            )}
            onClick={() => {
              if (user.role !== 'ADMIN') {
                if (confirm(`确定要将用户 "${user.name || user.email}" 设置为管理员吗？`)) {
                  updateUserRole(user._id, 'ADMIN');
                }
              }
              menuStore.hide();
            }}
          >
            <Shield className="h-4 w-4" />
            <span>设置为管理员</span>
            {user.role === 'ADMIN' && <span className="ml-auto text-xs">✓</span>}
          </Ariakit.MenuItem>
          <Ariakit.MenuItem
            className={cn(
              'flex w-full items-center gap-2 rounded px-3 py-2 text-sm outline-none transition-colors',
              isCurrentUserAdmin
                ? 'cursor-not-allowed opacity-50 text-text-tertiary'
                : 'cursor-pointer text-text-primary hover:bg-surface-hover',
              user.role === 'USER' && !isCurrentUserAdmin && 'bg-surface-secondary',
            )}
            disabled={isCurrentUserAdmin}
            onClick={() => {
              if (isCurrentUserAdmin) {
                showToast({
                  message: '不能将自己设置为普通用户',
                  status: 'error',
                });
                menuStore.hide();
                return;
              }
              if (user.role !== 'USER') {
                if (confirm(`确定要将用户 "${user.name || user.email}" 设置为普通用户吗？`)) {
                  updateUserRole(user._id, 'USER');
                }
              }
              menuStore.hide();
            }}
            title={isCurrentUserAdmin ? '不能将自己设置为普通用户' : undefined}
          >
            <User className="h-4 w-4" />
            <span>设置为普通用户</span>
            {user.role === 'USER' && !isCurrentUserAdmin && <span className="ml-auto text-xs">✓</span>}
          </Ariakit.MenuItem>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
    );
  };

  // 删除用户
  const deleteUser = async (userId: string, userName: string) => {
    if (!confirm(`确定要删除用户 "${userName}" 吗？此操作不可撤销，将删除该用户的所有数据。`)) {
      return;
    }

    setDeletingUser(userId);
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

      const response = await fetch(`${apiBase}/api/user/${userId}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });

      // 检查响应内容类型
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = '删除用户失败';
        if (isJson) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            const text = await response.text().catch(() => '');
            errorMessage = text || errorMessage;
          }
        } else {
          const text = await response.text().catch(() => '');
          errorMessage = text.includes('<!DOCTYPE') 
            ? '服务器返回了错误页面，请检查 API 端点配置' 
            : text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // 从列表中移除已删除的用户
      setUsers((prevUsers) => prevUsers.filter((user) => user._id !== userId));

      showToast({
        message: '用户已成功删除',
        status: 'success',
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      showToast({
        message: `删除用户失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setDeletingUser(null);
    }
  };

  // 更新用户角色
  const updateUserRole = async (userId: string, role: 'ADMIN' | 'USER') => {
    setUpdatingRole(userId);
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

      const response = await fetch(`${apiBase}/api/user/${userId}/role`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ role }),
      });

      // 检查响应内容类型
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = '更新用户角色失败';
        if (isJson) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            const text = await response.text().catch(() => '');
            errorMessage = text || errorMessage;
          }
        } else {
          const text = await response.text().catch(() => '');
          errorMessage = text.includes('<!DOCTYPE') 
            ? '服务器返回了错误页面，请检查 API 端点配置' 
            : text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      if (!isJson) {
        const text = await response.text();
        throw new Error(`服务器返回了非 JSON 响应: ${text.substring(0, 100)}`);
      }

      const data = await response.json();
      
      // 更新本地用户列表
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user._id === userId ? { ...user, role: data.user.role } : user
        )
      );

      showToast({
        message: `用户角色已更新为${role === 'ADMIN' ? '管理员' : '普通用户'}`,
        status: 'success',
      });
    } catch (error) {
      console.error('Error updating user role:', error);
      showToast({
        message: `更新用户角色失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setUpdatingRole(null);
    }
  };

  // ============ 机构编码（orgCode）管理 ============
  type DatProjectOption = { _id: string; name: string };
  type OrgFlatOption = { orgCode: string; orgName: string; orgType: string; depth: number };

  const flattenOrgTree = (nodes: any[], depth = 0, acc: OrgFlatOption[] = []): OrgFlatOption[] => {
    for (const n of nodes || []) {
      if (n?.orgCode) {
        acc.push({
          orgCode: String(n.orgCode),
          orgName: String(n.orgName || ''),
          orgType: String(n.orgType || ''),
          depth,
        });
      }
      if (n?.children?.length) flattenOrgTree(n.children, depth + 1, acc);
    }
    return acc;
  };

  const [editingOrgUser, setEditingOrgUser] = useState<User | null>(null);
  const [orgProjects, setOrgProjects] = useState<DatProjectOption[]>([]);
  const [orgProjectId, setOrgProjectId] = useState<string>('');
  const [orgOptions, setOrgOptions] = useState<OrgFlatOption[]>([]);
  const [orgDraftCode, setOrgDraftCode] = useState<string>('');
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgSaving, setOrgSaving] = useState(false);

  const openOrgEditor = async (target: User) => {
    setEditingOrgUser(target);
    setOrgDraftCode(target.orgCode || '');
    setOrgOptions([]);
    setOrgProjectId('');
    setOrgLoading(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${apiBase}/api/dat-projects`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));
      const list: DatProjectOption[] = (data?.projects || []).map((p: any) => ({
        _id: p._id,
        name: p.name,
      }));
      setOrgProjects(list);
      if (list.length === 1) setOrgProjectId(list[0]._id);
    } catch (err) {
      showToast({
        message: `加载项目列表失败: ${err instanceof Error ? err.message : '未知错误'}`,
        status: 'warning',
      });
    } finally {
      setOrgLoading(false);
    }
  };

  useEffect(() => {
    if (!editingOrgUser || !orgProjectId) {
      setOrgOptions([]);
      return;
    }
    setOrgLoading(true);
    fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes?projectId=${orgProjectId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((tree) => setOrgOptions(flattenOrgTree(tree)))
      .catch((err) => {
        setOrgOptions([]);
        showToast({
          message: `加载机构列表失败: ${err instanceof Error ? err.message : '未知错误'}`,
          status: 'warning',
        });
      })
      .finally(() => setOrgLoading(false));
  }, [editingOrgUser, orgProjectId]);

  const closeOrgEditor = () => {
    setEditingOrgUser(null);
    setOrgProjects([]);
    setOrgProjectId('');
    setOrgOptions([]);
    setOrgDraftCode('');
  };

  const saveOrgCode = async () => {
    if (!editingOrgUser) return;
    setOrgSaving(true);
    try {
      const baseEl = document.querySelector('base');
      const baseHref = baseEl?.getAttribute('href') || '/';
      const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${apiBase}/api/user/${editingOrgUser._id}/orgCode`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ orgCode: orgDraftCode.trim() }),
      });
      const isJson = resp.headers.get('content-type')?.includes('application/json');
      const body = isJson ? await resp.json().catch(() => ({})) : {};
      if (!resp.ok) throw new Error(body?.error || `HTTP ${resp.status}`);
      const updated = body?.user;
      setUsers((prev) =>
        prev.map((u) =>
          u._id === editingOrgUser._id ? { ...u, orgCode: updated?.orgCode ?? null } : u,
        ),
      );
      showToast({ message: body?.message || '已保存', status: 'success' });
      closeOrgEditor();
    } catch (err) {
      showToast({
        message: `保存失败: ${err instanceof Error ? err.message : '未知错误'}`,
        status: 'error',
      });
    } finally {
      setOrgSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">用户管理</h2>
          <p className="mt-1 text-sm text-text-secondary">
            查看和管理所有注册用户
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换按钮 */}
          <div className="flex items-center gap-1 rounded-lg border border-border-light bg-surface-secondary p-1">
            <button
              type="button"
              onClick={() => setViewMode("detailed")}
              className={cn(
                "rounded px-2 py-1 text-sm transition-colors",
                viewMode === "detailed"
                  ? "bg-surface-primary text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover",
              )}
              title="详细视图"
              aria-label="详细视图"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("compact")}
              className={cn(
                "rounded px-2 py-1 text-sm transition-colors",
                viewMode === "compact"
                  ? "bg-surface-primary text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover",
              )}
              title="表格视图"
              aria-label="表格视图"
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>
          <Button
            type="button"
            onClick={fetchUsers}
            disabled={isLoading}
            className="btn btn-neutral border-token-border-light relative flex items-center gap-2 rounded-lg px-3 py-2"
            aria-label="刷新用户列表"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            {isLoading ? "加载中..." : "刷新"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-text-secondary">
            <p className="text-sm">加载中...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
            <p className="text-sm">暂无用户</p>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === "compact"
                ? "grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3"
                : "space-y-2",
            )}
          >
            {users.map((user) => {
              if (viewMode === "compact") {
                // 表格视图：只显示头像、昵称、用户名、身份
                return (
                  <div
                    key={user._id}
                    className="relative rounded-lg border border-border-light bg-surface-primary p-3 pr-20"
                  >
                    <div className="flex items-center gap-3">
                      {/* 头像 */}
                      <div className="flex-shrink-0">
                        <img
                          src={user.avatar || "/assets/logo.png"}
                          alt={user.name || user.email}
                          className="h-10 w-10 rounded-full object-cover"
                          onError={(e) => {
                            // 如果头像加载失败，使用logo.png
                            const target = e.target as HTMLImageElement;
                            if (
                              target.src !==
                              `${window.location.origin}/assets/logo.png`
                            ) {
                              target.src = "/assets/logo.png";
                            }
                          }}
                        />
                      </div>
                      {/* 用户信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-text-primary line-clamp-1">
                            {user.name || "未设置昵称"}
                          </h4>
                          {user.role === "ADMIN" && (
                            <span
                              className={cn(
                                "rounded-xl px-2 py-0.5 text-xs font-medium",
                                getRoleColor(user.role),
                              )}
                            >
                              {getRoleLabel(user.role)}
                            </span>
                          )}
                        </div>
                        {user.username && (
                          <p className="mt-1 text-xs text-text-secondary line-clamp-1">
                            @{user.username}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* 操作按钮 */}
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => fetchUserMemories(user._id)}
                        disabled={isLoadingMemories}
                        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                        title="查看记忆"
                        aria-label="查看记忆"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          deleteUser(user._id, user.name || user.email)
                        }
                        disabled={
                          deletingUser === user._id ||
                          currentUser?.id === user._id
                        }
                        className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                        title={
                          currentUser?.id === user._id
                            ? "不能删除自己"
                            : "删除用户"
                        }
                        aria-label="删除用户"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <RoleMenu user={user} />
                    </div>
                  </div>
                );
              }

              // 详细视图：显示完整信息
              return (
                <div
                  key={user._id}
                  className="rounded-lg border border-border-light bg-surface-primary p-4"
                >
                  <div className="flex items-start gap-4">
                    {/* 头像 */}
                    <div className="flex-shrink-0">
                      <img
                        src={user.avatar || "/assets/logo.png"}
                        alt={user.name || user.email}
                        className="h-12 w-12 rounded-full object-cover"
                        onError={(e) => {
                          // 如果头像加载失败，使用logo.png
                          const target = e.target as HTMLImageElement;
                          if (
                            target.src !==
                            `${window.location.origin}/assets/logo.png`
                          ) {
                            target.src = "/assets/logo.png";
                          }
                        }}
                      />
                    </div>

                    {/* 用户信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-text-primary">
                            {user.name || user.username || "未设置名称"}
                          </h3>
                          {user.role === "ADMIN" && (
                            <span
                              className={cn(
                                "rounded-xl px-2 py-0.5 text-xs font-medium",
                                getRoleColor(user.role),
                              )}
                            >
                              {getRoleLabel(user.role)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fetchUserMemories(user._id)}
                            disabled={isLoadingMemories}
                            className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                            title="查看记忆"
                            aria-label="查看记忆"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              deleteUser(user._id, user.name || user.email)
                            }
                            disabled={
                              deletingUser === user._id ||
                              currentUser?.id === user._id
                            }
                            className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                            title={
                              currentUser?.id === user._id
                                ? "不能删除自己"
                                : "删除用户"
                            }
                            aria-label="删除用户"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <RoleMenu user={user} />
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 text-sm">
                        <div className="flex items-center gap-2 text-text-secondary">
                          <Mail className="h-4 w-4" />
                          <span className="truncate">{user.email}</span>
                        </div>
                        {user.username && (
                          <div className="flex items-center gap-2 text-text-secondary">
                            <UserIcon className="h-4 w-4" />
                            <span>{user.username}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-text-secondary">
                          <Network className="h-4 w-4" />
                          <span className="truncate">
                            机构：
                            {user.orgCode ? (
                              <span className="font-mono text-text-primary">
                                {user.orgCode}
                              </span>
                            ) : (
                              <span className="text-text-tertiary">未绑定</span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => openOrgEditor(user)}
                            className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-blue-500 hover:bg-surface-hover"
                            title="设置机构"
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-text-secondary">
                          <Calendar className="h-4 w-4" />
                          <span>注册时间: {formatDate(user.createdAt)}</span>
                        </div>
                        {user.provider && user.provider !== "email" && (
                          <div className="text-xs text-text-tertiary">
                            登录方式: {user.provider}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 机构编辑模态框 */}
      {editingOrgUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-lg border border-border-light bg-surface-primary shadow-lg">
            <div className="flex items-center justify-between border-b border-border-light p-4">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  设置机构
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {editingOrgUser.name ||
                    editingOrgUser.username ||
                    editingOrgUser.email}
                </p>
              </div>
              <button
                type="button"
                onClick={closeOrgEditor}
                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              {orgProjects.length > 1 && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-text-primary">
                    项目
                  </label>
                  <select
                    value={orgProjectId}
                    onChange={(e) => setOrgProjectId(e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">请选择您所属的项目</option>
                    {orgProjects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-text-primary">
                  机构
                </label>
                {orgLoading ? (
                  <div className="rounded-md border border-border-light px-3 py-2 text-sm text-text-secondary">
                    加载中...
                  </div>
                ) : orgOptions.length > 0 ? (
                  <select
                    value={orgDraftCode}
                    onChange={(e) => setOrgDraftCode(e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">请选择您所属的机构</option>
                    {orgOptions.map((o) => (
                      <option key={o.orgCode} value={o.orgCode}>
                        {"　".repeat(o.depth)}
                        {o.orgName ? `${o.orgName} (${o.orgCode})` : o.orgCode}
                        {/*{o.orgType ? `  ·  ${o.orgType}` : ""}*/}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={orgDraftCode}
                    onChange={(e) => setOrgDraftCode(e.target.value)}
                    placeholder={
                      orgProjects.length === 0
                        ? "无项目，可直接手填机构编码"
                        : orgProjectId
                          ? "机构列表为空，可直接手填"
                          : "请先选择项目"
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                )}
                <p className="mt-1 text-xs text-text-tertiary">
                  当前机构：
                  <span className="font-mono">
                    {editingOrgUser.orgCode || "未绑定"}
                  </span>
                  。留空保存表示清空机构绑定。
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-light p-4">
              <Button onClick={closeOrgEditor} className="btn btn-neutral">
                取消
              </Button>
              <Button
                onClick={saveOrgCode}
                disabled={orgSaving}
                className="btn btn-primary"
              >
                {orgSaving ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 记忆查看模态框 */}
      {viewingMemories && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-border-light bg-surface-primary shadow-lg">
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-border-light p-4">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  用户记忆
                </h3>
                {memoriesData && (
                  <p className="mt-1 text-sm text-text-secondary">
                    {memoriesData.userName} ({memoriesData.userEmail})
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {memoriesData && memoriesData.count > 0 && (
                  <Button
                    type="button"
                    onClick={exportMemories}
                    className="btn btn-primary relative flex items-center gap-2 rounded-lg px-3 py-2"
                    title="导出记忆"
                    aria-label="导出记忆"
                  >
                    <Download className="h-4 w-4" />
                    导出
                  </Button>
                )}
                <button
                  type="button"
                  onClick={closeMemoriesView}
                  className="rounded p-2 text-text-secondary hover:bg-surface-hover"
                  title="关闭"
                  aria-label="关闭"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* 内容 */}
            <div className="flex-1 overflow-auto p-4">
              {isLoadingMemories ? (
                <div className="flex h-32 items-center justify-center text-text-secondary">
                  <p className="text-sm">加载中...</p>
                </div>
              ) : memoriesData ? (
                memoriesData.count === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-secondary">
                    <p className="text-sm">该用户暂无记忆</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 统计信息 */}
                    <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-text-secondary">记忆数量</div>
                          <div className="mt-1 text-lg font-semibold text-text-primary">
                            {memoriesData.count}
                          </div>
                        </div>
                        <div>
                          <div className="text-text-secondary">总Token数</div>
                          <div className="mt-1 text-lg font-semibold text-text-primary">
                            {memoriesData.totalTokens}
                          </div>
                        </div>
                        <div>
                          <div className="text-text-secondary">最后更新</div>
                          <div className="mt-1 text-sm text-text-primary">
                            {memoriesData.memories[0]?.updated_at
                              ? formatDate(memoriesData.memories[0].updated_at)
                              : "未知"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 记忆列表 */}
                    <div className="space-y-3">
                      {memoriesData.memories.map((memory) => (
                        <div
                          key={memory.key}
                          className="rounded-lg border border-border-light bg-surface-secondary p-4"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <h4 className="font-semibold text-text-primary">
                              {memory.key}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-text-secondary">
                              {memory.tokenCount && (
                                <span>{memory.tokenCount} tokens</span>
                              )}
                              <span>
                                更新于: {formatDate(memory.updated_at)}
                              </span>
                            </div>
                          </div>
                          <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">
                            {memory.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

