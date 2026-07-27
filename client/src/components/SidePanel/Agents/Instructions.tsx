import React, { useEffect, useId, useMemo, useState } from 'react';
import { PlusCircle } from 'lucide-react';
import * as Menu from '@ariakit/react/menu';
import { DropdownPopup, useToastContext } from '@because/client';
import { specialVariables, dataService } from '@because/data-provider';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import type { TSpecialVarLabel } from '@because/data-provider';
import type { AgentForm } from '~/common';
import { cn, defaultTextProps, removeFocusOutlines } from '~/utils';
import { useLocalize } from '~/hooks';

const inputClass = cn(
  defaultTextProps,
  'flex w-full px-3 py-2 border-border-light bg-surface-secondary focus-visible:ring-2 focus-visible:ring-ring-primary',
  removeFocusOutlines,
);

interface VariableOption {
  label: TSpecialVarLabel;
  value: string;
}

const variableOptions: VariableOption[] = Object.keys(specialVariables).map((key) => ({
  label: `com_ui_special_var_${key}` as TSpecialVarLabel,
  value: `{{${key}}}`,
}));

type PromptTemplateMeta = { id: string; label: string };

const TOOL_TEMPLATE_KEYS = ['because_jn'] as const;

export default function Instructions() {
  const menuId = useId();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const methods = useFormContext<AgentForm>();
  const { control, setValue, getValues } = methods;

  const tools = useWatch({ control, name: 'tools' }) || [];
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [templates, setTemplates] = useState<PromptTemplateMeta[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const templateToolKey = useMemo(() => {
    const list = Array.isArray(tools) ? tools : [];
    return TOOL_TEMPLATE_KEYS.find((k) => list.includes(k)) || null;
  }, [tools]);

  useEffect(() => {
    let cancelled = false;
    if (!templateToolKey) {
      setTemplates([]);
      setSelectedTemplateId('');
      return;
    }
    setLoadingTemplates(true);
    dataService
      .listToolPromptTemplates(templateToolKey)
      .then((res) => {
        if (cancelled) return;
        setTemplates(res?.data || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[Instructions] load prompt templates failed', err);
        setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateToolKey]);

  const handleAddVariable = (label: TSpecialVarLabel, value: string) => {
    const currentInstructions = getValues('instructions') || '';
    const spacer = currentInstructions.length > 0 ? '\n' : '';
    const prefix = localize(label);
    setValue('instructions', currentInstructions + spacer + prefix + ': ' + value);
    setIsMenuOpen(false);
  };

  const handleApplyTemplate = async (templateId: string) => {
    if (!templateToolKey || !templateId) return;
    const current = (getValues('instructions') || '').trim();
    if (current) {
      const ok = window.confirm('当前指令已有内容，应用模板将覆盖，是否继续？');
      if (!ok) {
        setSelectedTemplateId('');
        return;
      }
    }
    setApplyingTemplate(true);
    try {
      const res = await dataService.getToolPromptTemplate(templateToolKey, templateId);
      const content = res?.data?.content;
      if (!content) {
        showToast({ message: '模板内容为空', status: 'error' });
        return;
      }
      setValue('instructions', content, { shouldDirty: true });
      showToast({
        message: `已应用模板：${res.data.label || templateId}`,
        status: 'success',
      });
    } catch (err: any) {
      showToast({
        message: `加载模板失败：${err?.message || '未知错误'}`,
        status: 'error',
      });
    } finally {
      setApplyingTemplate(false);
      setSelectedTemplateId('');
    }
  };

  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="text-token-text-primary flex-grow font-medium" htmlFor="instructions">
          {localize('com_ui_instructions')}
        </label>
        {templateToolKey && (
          <div className="flex items-center gap-1" title="应用工具自带提示词模板">
            <select
              className="h-7 max-w-[220px] rounded-md border border-border-medium bg-surface-secondary px-2 text-sm text-text-primary"
              value={selectedTemplateId}
              disabled={loadingTemplates || applyingTemplate || templates.length === 0}
              aria-label="提示词模板"
              onChange={(e) => {
                const id = e.target.value;
                setSelectedTemplateId(id);
                if (id) void handleApplyTemplate(id);
              }}
            >
              <option value="">
                {loadingTemplates
                  ? '加载模板…'
                  : applyingTemplate
                    ? '应用中…'
                    : templates.length
                      ? '提示词模板'
                      : '暂无模板'}
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ml-auto" title="Add variables to instructions">
          <DropdownPopup
            portal={true}
            mountByState={true}
            unmountOnHide={true}
            preserveTabOrder={true}
            isOpen={isMenuOpen}
            setIsOpen={setIsMenuOpen}
            trigger={
              <Menu.MenuButton
                id="variables-menu-button"
                aria-label="Add variable to instructions"
                className="flex h-7 items-center gap-1 rounded-md border border-border-medium bg-surface-secondary px-2 py-0 text-sm text-text-primary transition-colors duration-200 hover:bg-surface-tertiary"
              >
                <PlusCircle className="mr-1 h-3 w-3 text-text-secondary" aria-hidden={true} />
                {localize('com_ui_variables')}
              </Menu.MenuButton>
            }
            items={variableOptions.map((option) => ({
              label: localize(option.label) || option.label,
              onClick: () => handleAddVariable(option.label, option.value),
            }))}
            menuId={menuId}
            className="z-30"
          />
        </div>
      </div>
      <Controller
        name="instructions"
        control={control}
        render={({ field, fieldState: { error } }) => (
          <>
            <textarea
              {...field}
              value={field.value ?? ''}
              className={cn(inputClass, 'min-h-[100px] resize-y text-text-primary')}
              id="instructions"
              placeholder={localize('com_agents_instructions_placeholder')}
              rows={3}
              aria-label="Agent instructions"
              aria-required="true"
              aria-invalid={error ? 'true' : 'false'}
            />
            {error && (
              <span
                className="text-sm text-red-500 transition duration-300 ease-in-out"
                role="alert"
              >
                {localize('com_ui_field_required')}
              </span>
            )}
          </>
        )}
      />
    </div>
  );
}
