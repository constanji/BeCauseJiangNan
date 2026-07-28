import React, { useMemo, useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { ProviderConfig } from '~/constants/projectConfig';

export interface PlatformEndpointOption {
    name: string;
    baseURL: string;
    apiKey: string;
    models: string[];
}

interface ProviderConfigFormProps {
    config: ProviderConfig;
    value: Record<string, any>;
    onChange: (value: Record<string, any>) => void;
    llmOptions?: { label: string; value: string }[];
    /** JN 已配置的自定义端点，用于回填 OpenAI 兼容字段 */
    platformEndpoints?: PlatformEndpointOption[];
}

const FIELD_CLASS =
    'w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

function isOpenAiCompatibleFields(config: ProviderConfig): boolean {
    const keys = new Set(config.fields.map((f) => f.key));
    return keys.has('base-url') && keys.has('model-name') && keys.has('api-key');
}

export default function ProviderConfigForm({
    config,
    value,
    onChange,
    llmOptions = [],
    platformEndpoints = [],
}: ProviderConfigFormProps) {
    const showPlatformPicker = isOpenAiCompatibleFields(config) && platformEndpoints.length > 0;

    const [selectedEndpoint, setSelectedEndpoint] = useState('');
    const [selectedModel, setSelectedModel] = useState('');

    const endpointModels = useMemo(() => {
        const ep = platformEndpoints.find((e) => e.name === selectedEndpoint);
        return ep?.models ?? [];
    }, [platformEndpoints, selectedEndpoint]);

    // 根据当前已填值尝试反推选中项（编辑已有配置时）
    useEffect(() => {
        if (!showPlatformPicker) return;
        const base = (value['base-url'] || '').replace(/\/$/, '');
        if (!base) return;
        const matched = platformEndpoints.find(
            (e) => (e.baseURL || '').replace(/\/$/, '') === base,
        );
        if (matched && matched.name !== selectedEndpoint) {
            setSelectedEndpoint(matched.name);
        }
        const model = value['model-name'] || '';
        if (model && model !== selectedModel) {
            setSelectedModel(model);
        }
        // 仅在打开表单 / 端点列表变化时同步，避免覆盖用户正在改的选择
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showPlatformPicker, platformEndpoints]);

    const handleChange = (key: string, val: any) => {
        onChange({
            ...value,
            [key]: val,
        });
    };

    const applyEndpoint = (endpointName: string) => {
        setSelectedEndpoint(endpointName);
        setSelectedModel('');
        if (!endpointName) return;
        const ep = platformEndpoints.find((e) => e.name === endpointName);
        if (!ep) return;
        const next = {
            ...value,
            'base-url': ep.baseURL || value['base-url'] || '',
            'api-key': ep.apiKey || value['api-key'] || '',
        };
        const models = ep.models || [];
        if (models.length === 1) {
            next['model-name'] = models[0];
            setSelectedModel(models[0]);
        } else if (value['model-name'] && models.includes(value['model-name'])) {
            setSelectedModel(value['model-name']);
        } else {
            next['model-name'] = '';
        }
        onChange(next);
    };

    const applyModel = (modelName: string) => {
        setSelectedModel(modelName);
        if (!modelName) return;
        onChange({
            ...value,
            'model-name': modelName,
        });
    };

    return (
        <div className="space-y-4">
            {showPlatformPicker && (
                <div className="space-y-3 rounded-lg border border-border-light bg-surface-secondary/40 p-3">
                    <p className="text-xs text-text-secondary">
                        从平台已配置的端点快速填入接口地址、模型与 API 密钥（仍可手动修改下方字段）
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-text-primary">
                                平台端点
                            </label>
                            <select
                                value={selectedEndpoint}
                                onChange={(e) => applyEndpoint(e.target.value)}
                                className={FIELD_CLASS}
                            >
                                <option value="">手动填写 / 选择端点</option>
                                {platformEndpoints.map((ep) => (
                                    <option key={ep.name} value={ep.name}>
                                        {ep.name}
                                        {ep.baseURL ? `（${ep.baseURL}）` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-text-primary">
                                模型
                            </label>
                            <select
                                value={selectedModel}
                                onChange={(e) => applyModel(e.target.value)}
                                disabled={!selectedEndpoint || endpointModels.length === 0}
                                className={FIELD_CLASS}
                            >
                                <option value="">
                                    {!selectedEndpoint
                                        ? '请先选择端点'
                                        : endpointModels.length === 0
                                          ? '该端点暂无模型'
                                          : '选择模型'}
                                </option>
                                {endpointModels.map((m) => (
                                    <option key={m} value={m}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {config.fields.map((field) => (
                <div key={field.key} className="space-y-1">
                    <div className="flex items-center gap-1">
                        <label className="block text-sm font-medium text-text-primary">
                            {field.label}
                            {field.required && <span className="ml-0.5 text-red-500">*</span>}
                        </label>
                        {field.tip && (
                            <div className="group relative z-10 cursor-help">
                                <HelpCircle className="h-3 w-3 text-text-tertiary" />
                                <div className="absolute bottom-full left-1/2 mb-2 hidden w-48 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs text-white shadow group-hover:block">
                                    {field.tip}
                                </div>
                            </div>
                        )}
                    </div>

                    {field.type === 'text' && (
                        <input
                            type="text"
                            value={value[field.key] || ''}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            placeholder={field.placeholder || (field.default ? String(field.default) : '')}
                            className={FIELD_CLASS}
                        />
                    )}

                    {field.type === 'password' && (
                        <input
                            type="password"
                            value={value[field.key] || ''}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className={FIELD_CLASS}
                        />
                    )}

                    {field.type === 'number' && (
                        <input
                            type="number"
                            value={value[field.key] ?? field.default ?? ''}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                handleChange(field.key, isNaN(val) ? undefined : val);
                            }}
                            min={field.min}
                            max={field.max}
                            step={field.step || 1}
                            className={FIELD_CLASS}
                        />
                    )}

                    {field.type === 'switch' && (
                        <div className="flex items-center">
                            <label className="relative inline-flex cursor-pointer items-center">
                                <input
                                    type="checkbox"
                                    checked={value[field.key] ?? field.default ?? false}
                                    onChange={(e) => handleChange(field.key, e.target.checked)}
                                    className="peer sr-only"
                                />
                                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"></div>
                            </label>
                        </div>
                    )}

                    {(field.type === 'select' || field.type === 'llm-select') && (
                        <select
                            value={value[field.key] ?? field.default ?? ''}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            className={FIELD_CLASS}
                        >
                            {field.type === 'llm-select' ? (
                                <>
                                    <option value="">选择 LLM</option>
                                    {llmOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </>
                            ) : (
                                field.options?.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))
                            )}
                        </select>
                    )}

                    {field.type === 'textarea' && (
                        <textarea
                            value={value[field.key] || ''}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            rows={3}
                            className={FIELD_CLASS}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}
