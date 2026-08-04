import { useFormContext, Controller } from 'react-hook-form';
import { AgentCapabilities } from '@because/data-provider';
import {
  Switch,
  HoverCard,
  HoverCardPortal,
  HoverCardContent,
  HoverCardTrigger,
  CircleHelpIcon,
} from '@because/client';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import { ESide } from '~/common';

/** Form field name — keep as literal so a stale data-provider build cannot pass `undefined` to watch/setValue. */
const AUTO_CHART_FIELD = AgentCapabilities.auto_chart ?? 'auto_chart';

/**
 * Per-agent toggle for server-side auto chart generation after data-query tools.
 * When enabled, ToolNode injects echarts_generator_app without relying on the model.
 */
export default function AutoChart() {
  const localize = useLocalize();
  const { control } = useFormContext<AgentForm>();

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center gap-2">
        <span>
          <label className="text-token-text-primary block font-medium dark:text-text-primary">
            {localize('com_ui_auto_chart')}
          </label>
        </span>
      </div>
      <HoverCard openDelay={50}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="text-text-primary">{localize('com_ui_auto_chart_toggle')}</div>
            <HoverCardTrigger>
              <CircleHelpIcon className="h-4 w-4 text-text-tertiary" />
            </HoverCardTrigger>
          </div>
          <HoverCardPortal>
            <HoverCardContent side={ESide.Top} className="w-80">
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_auto_chart_info')}
                </p>
              </div>
            </HoverCardContent>
          </HoverCardPortal>
          <Controller
            name={AUTO_CHART_FIELD}
            control={control}
            defaultValue={false}
            render={({ field }) => (
              <Switch
                id="auto_chart"
                checked={field.value === true}
                onCheckedChange={(value) => field.onChange(value === true)}
                className="ml-4"
                data-testid="auto_chart"
                aria-label={localize('com_ui_auto_chart_toggle')}
              />
            )}
          />
        </div>
      </HoverCard>
    </div>
  );
}
