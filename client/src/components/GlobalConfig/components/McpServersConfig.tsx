import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Server } from 'lucide-react';
import McpServerModal from './McpServerModal';

interface McpServersConfigProps {
    value?: Record<string, any>;
    onChange?: (value: Record<string, any>) => void;
}

export default function McpServersConfig({ value = {}, onChange }: McpServersConfigProps) {
    const [modalOpen, setModalOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<{ name: string; config: any } | null>(null);

    const serverList = useMemo(() => {
        if (!value || typeof value !== 'object') return [];
        return Object.entries(value).map(([name, config]) => ({
            name,
            config,
        }));
    }, [value]);

    const getServerUrl = (config: any) => {
        if (config.transport === 'http') {
            return config.url || config['sse-url'] || '-';
        } else {
            const cmd = config.command;
            return Array.isArray(cmd) ? cmd.join(' ') : (cmd || '-');
        }
    };

    const handleCreate = () => {
        setEditingServer(null);
        setModalOpen(true);
    };

    const handleEdit = (server: { name: string; config: any }) => {
        setEditingServer(server);
        setModalOpen(true);
    };

    const handleDelete = (name: string) => {
        if (confirm('确定删除此服务器配置?')) {
            const newValue = { ...value };
            delete newValue[name];
            onChange?.(newValue);
        }
    };

    const handleSave = ({ name, config }: { name: string; config: any }) => {
        const newValue = { ...value };

        // 如果是编辑且名称变了，删除旧的
        if (editingServer && editingServer.name !== name) {
            delete newValue[editingServer.name];
        }

        newValue[name] = config;
        onChange?.(newValue);
    };

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                    <Server className="h-4 w-4" />
                    <span>MCP 服务器</span>
                </div>
                <button
                    onClick={handleCreate}
                    className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                >
                    <Plus className="h-3 w-3" />
                    添加服务器
                </button>
            </div>

            {serverList.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    暂无 MCP 服务器配置
                </div>
            ) : (
                <div className="space-y-2">
                    {serverList.map((server) => (
                        <div
                            key={server.name}
                            className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50"
                        >
                            <div className="flex-1 overflow-hidden">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-900 dark:text-white">{server.name}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <span className={server.config.transport === 'http' ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}>
                                        [{server.config.transport?.toUpperCase()}]
                                    </span>
                                    <span className="truncate" title={getServerUrl(server.config)}>
                                        {getServerUrl(server.config)}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => handleEdit(server)}
                                    className="rounded p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                                >
                                    <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(server.name)}
                                    className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <McpServerModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                serverName={editingServer?.name}
                serverConfig={editingServer?.config}
                onSave={handleSave}
            />
        </div>
    );
}
