import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import KeyValueEditor from './KeyValueEditor';
import { cn } from '~/utils';

interface McpServerModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    serverName?: string;
    serverConfig?: any;
    onSave: (data: { name: string; config: any }) => void;
}

export default function McpServerModal({
    open,
    onOpenChange,
    serverName,
    serverConfig,
    onSave,
}: McpServerModalProps) {
    const getDefaultForm = () => ({
        name: '',
        transport: 'http',
        url: '',
        'sse-url': '',
        'log-requests': true,
        'log-responses': true,
        timeout: 60000,
        'custom-headers': {},
        command: [] as string[],
        'log-events': true,
        environment: {},
    });

    const [form, setForm] = useState(getDefaultForm());
    const isEdit = !!serverName;

    useEffect(() => {
        if (open) {
            if (serverConfig) {
                setForm({
                    ...getDefaultForm(),
                    name: serverName || '',
                    ...serverConfig,
                });
            } else {
                setForm(getDefaultForm());
            }
        }
    }, [open, serverName, serverConfig]);

    const commandString = useMemo(() => {
        return Array.isArray(form.command) ? form.command.join(' ') : '';
    }, [form.command]);

    const handleCommandChange = (val: string) => {
        setForm(prev => ({
            ...prev,
            command: val.split(/\s+/).filter(s => s.trim()),
        }));
    };

    const handleSave = () => {
        if (!form.name.trim()) return;

        const config: any = {
            transport: form.transport,
        };

        if (form.transport === 'http') {
            if (form.url) config.url = form.url;
            if (form['sse-url']) config['sse-url'] = form['sse-url'];
            if (form['log-requests']) config['log-requests'] = form['log-requests'];
            if (form['log-responses']) config['log-responses'] = form['log-responses'];
            if (form.timeout) config.timeout = form.timeout;
            if (form['custom-headers'] && Object.keys(form['custom-headers']).length > 0) {
                config['custom-headers'] = form['custom-headers'];
            }
        } else {
            if (form.command && form.command.length > 0) {
                config.command = form.command;
            }
            if (form['log-events']) config['log-events'] = form['log-events'];
            if (form.environment && Object.keys(form.environment).length > 0) {
                config.environment = form.environment;
            }
        }

        onSave({ name: form.name.trim(), config });
        onOpenChange(false);
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
            <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-surface-primary dark:bg-gray-800 shadow-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                    </h3>
                    <button
                        onClick={() => onOpenChange(false)}
                        className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            服务器名称 <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            disabled={isEdit}
                            placeholder="server_name"
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-800"
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            传输方式 <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setForm({ ...form, transport: 'http' })}
                                className={cn(
                                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                    form.transport === 'http'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                                )}
                            >
                                HTTP
                            </button>
                            <button
                                type="button"
                                onClick={() => setForm({ ...form, transport: 'stdio' })}
                                className={cn(
                                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                    form.transport === 'stdio'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                                )}
                            >
                                STDIO
                            </button>
                        </div>
                    </div>

                    {form.transport === 'http' ? (
                        <>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    服务器 URL <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.url}
                                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                                    placeholder="http://localhost:3002/mcp"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                                <p className="mt-1 text-xs text-gray-500">Streamable HTTP 模式。如使用 SSE (已废弃)，请填写 sse-url</p>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    SSE URL (已废弃)
                                </label>
                                <input
                                    type="text"
                                    value={form['sse-url']}
                                    onChange={(e) => setForm({ ...form, 'sse-url': e.target.value })}
                                    placeholder="http://localhost:3001/sse"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                            </div>

                            <div className="flex gap-4">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={form['log-requests']}
                                        onChange={(e) => setForm({ ...form, 'log-requests': e.target.checked })}
                                        className="rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">记录请求日志</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={form['log-responses']}
                                        onChange={(e) => setForm({ ...form, 'log-responses': e.target.checked })}
                                        className="rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">记录响应日志</span>
                                </label>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    超时时间 (ms)
                                </label>
                                <input
                                    type="number"
                                    value={form.timeout}
                                    onChange={(e) => setForm({ ...form, timeout: parseInt(e.target.value) || 0 })}
                                    min={1000}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    自定义请求头
                                </label>
                                <KeyValueEditor
                                    value={form['custom-headers']}
                                    onChange={(val) => setForm({ ...form, 'custom-headers': val })}
                                    addButtonText="添加请求头"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    启动命令 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={commandString}
                                    onChange={(e) => handleCommandChange(e.target.value)}
                                    placeholder="npm exec @modelcontextprotocol/server-everything@0.6.2"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                />
                                <p className="mt-1 text-xs text-gray-500">命令和参数用空格分隔</p>
                            </div>

                            <div>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={form['log-events']}
                                        onChange={(e) => setForm({ ...form, 'log-events': e.target.checked })}
                                        className="rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">记录事件日志</span>
                                </label>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    环境变量
                                </label>
                                <KeyValueEditor
                                    value={form.environment}
                                    onChange={(val) => setForm({ ...form, environment: val })}
                                    addButtonText="添加环境变量"
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                    <button
                        onClick={() => onOpenChange(false)}
                        className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                        保存
                    </button>
                </div>
            </div>
        </div>
    );
}
