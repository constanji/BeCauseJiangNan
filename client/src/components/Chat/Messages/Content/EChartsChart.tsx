import { useEffect, useRef, memo } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  HeatmapChart,
  FunnelChart,
  GaugeChart,
  TreemapChart,
  SankeyChart,
  SunburstChart,
  BoxplotChart,
  CandlestickChart,
  MapChart,
  LinesChart,
  GraphChart,
  ParallelChart,
  CustomChart,
} from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  VisualMapComponent,
  ToolboxComponent,
  GraphicComponent,
  DatasetComponent,
  TransformComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  PolarComponent,
  GeoComponent,
  CalendarComponent,
  SingleAxisComponent,
  ParallelComponent,
  RadarComponent,
  AriaComponent,
} from 'echarts/components';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  CanvasRenderer,
  LabelLayout,
  UniversalTransition,
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  HeatmapChart,
  FunnelChart,
  GaugeChart,
  TreemapChart,
  SankeyChart,
  SunburstChart,
  BoxplotChart,
  CandlestickChart,
  MapChart,
  LinesChart,
  GraphChart,
  ParallelChart,
  CustomChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  VisualMapComponent,
  ToolboxComponent,
  GraphicComponent,
  DatasetComponent,
  TransformComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  PolarComponent,
  GeoComponent,
  CalendarComponent,
  SingleAxisComponent,
  ParallelComponent,
  RadarComponent,
  AriaComponent,
]);

export type EChartsChartData = {
  id: string;
  title: string;
  analysisType?: string;
  echartsOption: Record<string, unknown>;
};

type EChartsChartProps = {
  title: string;
  echartsOption: Record<string, unknown>;
};

const numberFormatter = new Intl.NumberFormat('en-US');

function formatTooltipValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return numberFormatter.format(value);
  }
  if (Array.isArray(value)) {
    const numeric = value.find((v) => typeof v === 'number' && Number.isFinite(v));
    if (typeof numeric === 'number') {
      return numberFormatter.format(numeric);
    }
  }
  if (value == null) {
    return '--';
  }
  return String(value);
}

/**
 * Align with echarts.html financial style: inject a thousand-separator tooltip
 * formatter when the backend stripped functions via sanitizeOption.
 */
export function withDefaultTooltipFormatter(
  option: Record<string, unknown>,
): Record<string, unknown> {
  if (!option || typeof option !== 'object') {
    return option;
  }

  const tooltip = option.tooltip;
  if (!tooltip || typeof tooltip !== 'object' || Array.isArray(tooltip)) {
    return option;
  }

  const tooltipObj = tooltip as Record<string, unknown>;
  if (tooltipObj.formatter != null && tooltipObj.formatter !== '') {
    return option;
  }

  return {
    ...option,
    tooltip: {
      ...tooltipObj,
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        return list
          .map((item) => {
            const row = item as {
              seriesName?: string;
              name?: string;
              marker?: string;
              value?: unknown;
            };
            const label = row.seriesName || row.name || '';
            const marker = typeof row.marker === 'string' ? row.marker : '';
            const formatted = formatTooltipValue(row.value);
            return label ? `${marker}${label}: ${formatted}` : `${marker}${formatted}`;
          })
          .join('<br/>');
      },
    },
  };
}

const EChartsChart = memo(({ title, echartsOption }: EChartsChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!containerRef.current || !echartsOption) {
      return;
    }

    if (chartRef.current) {
      try {
        chartRef.current.dispose();
      } catch {
        // ignore dispose errors
      }
      chartRef.current = null;
    }

    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }

    const container = containerRef.current;
    const isDark = document.documentElement.classList.contains('dark');
    const optionWithFormatter = withDefaultTooltipFormatter(echartsOption);

    const chart = echarts.init(container, isDark ? 'dark' : undefined, {
      renderer: 'canvas',
    });

    chart.setOption(optionWithFormatter);
    chartRef.current = chart;

    resizeObserverRef.current = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserverRef.current.observe(container);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartRef.current) {
        try {
          chartRef.current.dispose();
        } catch {
          // ignore
        }
        chartRef.current = null;
      }
    };
  }, [echartsOption]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (chartRef.current && containerRef.current) {
        const isDark = document.documentElement.classList.contains('dark');
        const container = containerRef.current;
        const optionWithFormatter = withDefaultTooltipFormatter(echartsOption);

        try {
          chartRef.current.dispose();
        } catch {
          // ignore
        }

        const chart = echarts.init(container, isDark ? 'dark' : undefined, {
          renderer: 'canvas',
        });
        chart.setOption(optionWithFormatter);
        chartRef.current = chart;
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, [echartsOption]);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-sm">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="p-4">
        <div ref={containerRef} style={{ width: '100%', minHeight: '360px' }} />
      </div>
    </div>
  );
});

EChartsChart.displayName = 'EChartsChart';

export default EChartsChart;
