import React, { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Settings as SettingsIcon } from 'lucide-react';
import { useUpdateUserPluginsMutation } from '@because/data-provider/react-query';
import {
  OGDialog,
  TrashIcon,
  CircleHelpIcon,
  useToastContext,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@because/client';
import type { TPlugin } from '@because/data-provider';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import ChartConfigDialog from './ChartConfigDialog';

const ECHARTS_TOOL_KEY = 'echarts_generator_app';

export default function AgentTool({
  tool,
  regularTools,
}: {
  tool: string;
  regularTools?: TPlugin[];
  agent_id?: string;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const updateUserPlugins = useUpdateUserPluginsMutation();
  const { getValues, setValue } = useFormContext<AgentForm>();

  const [isFocused, setIsFocused] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [chartConfigOpen, setChartConfigOpen] = useState(false);

  if (!regularTools) {
    return null;
  }

  const currentTool = regularTools.find((t) => t.pluginKey === tool);

  if (!currentTool) {
    return null;
  }

  const removeTool = (toolId: string) => {
    if (toolId) {
      updateUserPlugins.mutate(
        { pluginKey: toolId, action: 'uninstall', auth: {}, isEntityTool: true },
        {
          onError: (error: unknown) => {
            showToast({ message: `Error while deleting the tool: ${error}`, status: 'error' });
          },
          onSuccess: () => {
            const remainingToolIds = getValues('tools')?.filter((id: string) => id !== toolId);
            setValue('tools', remainingToolIds);
            showToast({ message: 'Tool deleted successfully', status: 'success' });
          },
        },
      );
    }
  };

  const isEchartsTool = tool === ECHARTS_TOOL_KEY;

  return (
    <>
      {isEchartsTool && (
        <ChartConfigDialog open={chartConfigOpen} onOpenChange={setChartConfigOpen} />
      )}
      <OGDialog>
      <div
        className="group relative flex w-full items-center gap-1 rounded-lg p-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsFocused(false);
          }
        }}
      >
        <div className="flex grow items-center">
          {currentTool.icon && (
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
              <div
                className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-center bg-no-repeat dark:bg-white/20"
                style={{
                  backgroundImage: `url(${currentTool.icon})`,
                  backgroundSize: 'cover',
                }}
              />
            </div>
          )}
          <div
            className="grow px-2 py-1.5 text-text-primary"
            style={{ textOverflow: 'ellipsis', wordBreak: 'break-all', overflow: 'hidden' }}
          >
            {currentTool.name}
          </div>
        </div>

        {isEchartsTool && (
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded transition-all duration-200 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            aria-label="Chart settings"
            onClick={() => setChartConfigOpen(true)}
          >
            <SettingsIcon className="h-4 w-4 text-text-secondary" />
          </button>
        )}

        <OGDialogTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded transition-all duration-200 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            aria-label={`Delete ${currentTool.name}`}
            tabIndex={0}
            onFocus={() => setIsFocused(true)}
          >
            <TrashIcon className="h-4 w-4 text-red-500" />
          </button>
        </OGDialogTrigger>
      </div>
      <OGDialogTemplate
        showCloseButton={false}
        title={localize('com_ui_delete_tool')}
        className="max-w-[450px]"
        main={
          <>
            <div className="flex w-full flex-col items-start gap-2 text-sm text-text-secondary">
              <p>
                {localize('com_ui_delete_tool_confirm')}{' '}
                <strong>&quot;{currentTool.name}&quot;</strong>?
              </p>
              {currentTool.description && (
                <div className="flex items-start gap-2">
                  <CircleHelpIcon className="h-4 w-4 flex-shrink-0 text-text-secondary" />
                  <p className="text-sm">{currentTool.description}</p>
                </div>
              )}
            </div>
          </>
        }
        selection={{
          selectHandler: () => removeTool(tool),
          selectClasses:
            'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
          selectText: localize('com_ui_delete'),
        }}
      />
    </OGDialog>
    </>
  );
}
