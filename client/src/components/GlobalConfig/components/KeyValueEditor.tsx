import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '~/utils';

interface KeyValueEditorProps {
    value?: Record<string, string>;
    onChange?: (value: Record<string, string>) => void;
    addButtonText?: string;
    className?: string;
}

export default function KeyValueEditor({
    value = {},
    onChange,
    addButtonText = '添加',
    className,
}: KeyValueEditorProps) {
    const [items, setItems] = useState<{ key: string; value: string }[]>([]);

    useEffect(() => {
        if (value) {
            const newItems = Object.entries(value).map(([k, v]) => ({ key: k, value: String(v) }));
            setItems(newItems);
        } else {
            setItems([]);
        }
    }, [value]);

    const updateItems = (newItems: { key: string; value: string }[]) => {
        setItems(newItems);
        const result: Record<string, string> = {};
        newItems.forEach(item => {
            if (item.key.trim()) {
                result[item.key.trim()] = item.value;
            }
        });
        onChange?.(result);
    };

    const addItem = () => {
        updateItems([...items, { key: '', value: '' }]);
    };

    const removeItem = (index: number) => {
        const newItems = [...items];
        newItems.splice(index, 1);
        updateItems(newItems);
    };

    const handleChange = (index: number, field: 'key' | 'value', val: string) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: val };
        updateItems(newItems);
    };

    return (
        <div className={cn('w-full space-y-2', className)}>
            {items.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                    <input
                        type="text"
                        value={item.key}
                        onChange={(e) => handleChange(index, 'key', e.target.value)}
                        placeholder="键"
                        className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <input
                        type="text"
                        value={item.value}
                        onChange={(e) => handleChange(index, 'value', e.target.value)}
                        placeholder="值"
                        className="flex-[2] rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={addItem}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 py-1.5 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500"
            >
                <Plus className="h-4 w-4" />
                {addButtonText}
            </button>
        </div>
    );
}
