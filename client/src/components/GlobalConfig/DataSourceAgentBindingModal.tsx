import React, { useEffect, useMemo, useState } from 'react';
import { Button, useToastContext } from '@because/client';
import { useListAgentsQuery } from '~/data-provider';
import { useUpdateDataSourceAgentBindingsMutation } from '~/data-provider/DataSources';
import type { Agent, DataSource } from '@because/data-provider';
import { Bot, Check, X } from 'lucide-react';
import { cn } from '~/utils';

interface DataSourceAgentBindingModalProps {
  dataSource: DataSource | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function DataSourceAgentBindingModal({
  dataSource,
  open,
  onClose,
  onSaved,
}: DataSourceAgentBindingModalProps) {
  const { showToast } = useToastContext();
  const { data: agentsResponse, isLoading: agentsLoading } = useListAgentsQuery();
  const bindMutation = useUpdateDataSourceAgentBindingsMutation();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const agents = agentsResponse?.data || [];

  useEffect(() => {
    if (open && dataSource) {
      setSelectedIds(dataSource.agentIds || []);
      setSearch('');
    }
  }, [open, dataSource]);

  const filteredAgents = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) {
      return agents;
    }
    return agents.filter((agent: Agent) => {
      const name = (agent.name || '').toLowerCase();
      const id = (agent.id || '').toLowerCase();
      return name.includes(kw) || id.includes(kw);
    });
  }, [agents, search]);

  const toggleAgent = (agentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  };

  const handleSave = async () => {
    if (!dataSource) {
      return;
    }
    try {
      await bindMutation.mutateAsync({ id: dataSource._id, agentIds: selectedIds });
      showToast({ message: '智能体绑定已保存', status: 'success' });
      onSaved?.();
      onClose();
    } catch (error) {
      showToast({
        message: `保存失败: ${error instanceof Error ? error.message : '未知错误'}`,
        status: 'error',
      });
    }
  };

  if (!open || !dataSource) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border-light bg-surface-primary shadow-xl">
        <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Bot className="h-5 w-5 text-green-500" />
              绑定智能体
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              数据源「{dataSource.name}」 — 已选 {selectedIds.length} 个
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              ESB 仅传 agentId 时，将自动使用此处绑定的数据源 ID。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-secondary"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-border-light px-5 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索智能体名称或 ID…"
            className="w-full rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-green-500"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {agentsLoading ? (
            <div className="py-8 text-center text-sm text-text-secondary">加载智能体列表…</div>
          ) : filteredAgents.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-secondary">没有匹配的智能体</div>
          ) : (
            <ul className="space-y-2">
              {filteredAgents.map((agent: Agent) => {
                const checked = selectedIds.includes(agent.id);
                return (
                  <li key={agent.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-green-500/30 focus-within:ring-offset-1 focus-within:ring-offset-surface-primary',
                        checked
                          ? 'border-green-500/50 bg-green-500/5'
                          : 'border-border-light hover:bg-surface-secondary',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAgent(agent.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          checked
                            ? 'border-green-500/70 bg-green-500/15 text-green-500'
                            : 'border-white/10 bg-white/[0.04] text-transparent hover:border-white/20',
                        )}
                      >
                        <Check
                          className={cn(
                            'h-3 w-3 stroke-[2.5] transition-opacity',
                            checked ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-primary">
                          {agent.name || agent.id}
                        </span>
                        <span className="block truncate font-mono text-xs text-text-secondary">
                          {agent.id}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-light px-5 py-4">
          <Button
            onClick={onClose}
            className="btn btn-neutral border-token-border-light rounded-lg px-4 py-2"
          >
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={bindMutation.isLoading}
            className="btn btn-primary rounded-lg px-4 py-2"
          >
            {bindMutation.isLoading ? '保存中…' : '保存绑定'}
          </Button>
        </div>
      </div>
    </div>
  );
}
