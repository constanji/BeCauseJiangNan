import React, { useState, useEffect } from 'react';
import { Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '~/utils';

interface EmailSenderConfigProps {
    value?: Record<string, any>;
    onChange?: (value: Record<string, any>) => void;
}

export default function EmailSenderConfig({ value, onChange }: EmailSenderConfigProps) {
    const [enabled, setEnabled] = useState(false);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    const [config, setConfig] = useState({
        'smtp-host': '',
        'from-address': '',
        'smtp-port': 587,
        'auth-enabled': true,
        'tls-enabled': true,
        'username': '',
        'password': '',
        'from-name': 'DAT Agent',
        'smtp-connection-timeout': '30s',
        'smtp-timeout': '30s',
        'smtp-write-timeout': '30s',
    });

    useEffect(() => {
        if (value && Object.keys(value).length > 0) {
            setEnabled(true);
            setConfig(prev => ({ ...prev, ...value }));
        } else {
            setEnabled(false);
        }
    }, [value]);

    const emitChange = (newConfig: typeof config, isEnabled: boolean) => {
        if (!isEnabled) {
            onChange?.({});
            return;
        }

        const result: any = {};
        Object.entries(newConfig).forEach(([key, val]) => {
            if (val !== '' && val !== null && val !== undefined) {
                result[key] = val;
            }
        });
        onChange?.(result);
    };

    const handleChange = (field: string, val: any) => {
        const newConfig = { ...config, [field]: val };
        setConfig(newConfig);
        emitChange(newConfig, enabled);
    };

    const handleEnableChange = (checked: boolean) => {
        setEnabled(checked);
        emitChange(config, checked);
    };

    return (
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                    <Mail className="h-4 w-4" />
                    <span>邮件发送器</span>
                </div>
                <div className="flex items-center">
                    <label className="relative inline-flex cursor-pointer items-center">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => handleEnableChange(e.target.checked)}
                            className="peer sr-only"
                        />
                        <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"></div>
                    </label>
                </div>
            </div>

            {enabled && (
                <div className="border-t border-gray-200 p-4 dark:border-gray-700">
                    <div className="grid gap-4">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    SMTP 服务器 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={config['smtp-host']}
                                    onChange={(e) => handleChange('smtp-host', e.target.value)}
                                    placeholder="smtp.gmail.com"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    SMTP 端口
                                </label>
                                <input
                                    type="number"
                                    value={config['smtp-port']}
                                    onChange={(e) => handleChange('smtp-port', parseInt(e.target.value))}
                                    placeholder="587"
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                发件人地址 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={config['from-address']}
                                onChange={(e) => handleChange('from-address', e.target.value)}
                                placeholder="sender@example.com"
                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={config['auth-enabled']}
                                    onChange={(e) => handleChange('auth-enabled', e.target.checked)}
                                    className="rounded border-gray-300"
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">启用 SMTP 认证</span>
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={config['tls-enabled']}
                                    onChange={(e) => handleChange('tls-enabled', e.target.checked)}
                                    className="rounded border-gray-300"
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">启用 TLS 加密</span>
                            </label>
                        </div>

                        {config['auth-enabled'] && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        用户名
                                    </label>
                                    <input
                                        type="text"
                                        value={config['username']}
                                        onChange={(e) => handleChange('username', e.target.value)}
                                        placeholder="通常为邮箱地址"
                                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        密码
                                    </label>
                                    <input
                                        type="password"
                                        value={config['password']}
                                        onChange={(e) => handleChange('password', e.target.value)}
                                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                发件人名称
                            </label>
                            <input
                                type="text"
                                value={config['from-name']}
                                onChange={(e) => handleChange('from-name', e.target.value)}
                                placeholder="DAT Agent"
                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        {/* Advanced Config */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                                className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            >
                                {isAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                高级配置
                            </button>

                            {isAdvancedOpen && (
                                <div className="mt-3 grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                                            连接超时
                                        </label>
                                        <input
                                            type="text"
                                            value={config['smtp-connection-timeout']}
                                            onChange={(e) => handleChange('smtp-connection-timeout', e.target.value)}
                                            placeholder="30s"
                                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                                            发送超时
                                        </label>
                                        <input
                                            type="text"
                                            value={config['smtp-timeout']}
                                            onChange={(e) => handleChange('smtp-timeout', e.target.value)}
                                            placeholder="30s"
                                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                                            写入超时
                                        </label>
                                        <input
                                            type="text"
                                            value={config['smtp-write-timeout']}
                                            onChange={(e) => handleChange('smtp-write-timeout', e.target.value)}
                                            placeholder="30s"
                                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
