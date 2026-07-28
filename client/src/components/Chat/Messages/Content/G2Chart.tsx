import { useEffect, useRef, useState, memo } from 'react';
import { Chart } from '@antv/g2';



type ChartConfig = {
  success: boolean;
  __chartConfig: boolean;
  title: string;
  analysisType?: string;
  g2Spec: Record<string, unknown>;
};

/**
 * 从工具的 output 字符串中尝试解析图表配置
 */
export function parseChartConfig(output: string): ChartConfig | null {
  if (!output) {
    return null;
  }
  try {
    const parsed = JSON.parse(output);
    if (parsed && parsed.__chartConfig === true && parsed.success === true) {
      return parsed as ChartConfig;
    }
  } catch {
    // 无法解析，不是图表配置
  }
  return null;
}

/**
 * 使用 G2 Spec 渲染图表
 */
function renderChart(container: HTMLDivElement, config: ChartConfig): Chart {
  const isDark = document.documentElement.classList.contains('dark');

  const chart = new Chart({
    container,
    autoFit: true,
    theme: isDark ? 'classicDark' : 'classic',
  });

  // G2 Spec 必须通过 chart.options() 设置，不能展开到构造函数中
  chart.options(config.g2Spec as Record<string, unknown>);
  chart.render();
  return chart;
}

type G2ChartProps = {
  output: string;
  isSubmitting: boolean;
};

const G2Chart = memo(({ output, isSubmitting }: G2ChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ChartConfig | null>(null);

  // 解析配置
  useEffect(() => {
    if (!output) {
      return;
    }
    const parsed = parseChartConfig(output);
    if (parsed) {
      setConfig(parsed);
      setError(null);
    }
  }, [output]);

  // 渲染图表
  useEffect(() => {
    if (!config || !containerRef.current) {
      return;
    }

    // 清理之前的实例
    if (chartRef.current) {
      try {
        chartRef.current.destroy();
      } catch {
        // ignore destroy errors
      }
      chartRef.current = null;
    }

    try {
      const chart = renderChart(containerRef.current, config);
      chartRef.current = chart;
      setError(null);
    } catch (err) {
      setError((err as Error).message || '图表渲染失败');
    }

    return () => {
      if (chartRef.current) {
        try {
          chartRef.current.destroy();
        } catch {
          // ignore
        }
        chartRef.current = null;
      }
    };
  }, [config]);

  // 还在等待工具输出
  if (!output && isSubmitting) {
    return (
      <div className="my-3 flex items-center gap-2 text-sm text-text-secondary">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-light border-t-text-primary" />
        <span>正在生成图表...</span>
      </div>
    );
  }

  // 输出不是图表配置
  if (!config) {
    return null;
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-sm">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">{config.title}</h3>
      </div>
      {/* 图表区域 */}
      <div className="p-4">
        {error ? (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            <span>图表渲染错误: {error}</span>
          </div>
        ) : (
          <div
            ref={containerRef}
            style={{ width: '100%', minHeight: '320px' }}
          />
        )}
      </div>
    </div>
  );
});

G2Chart.displayName = 'G2Chart';

export default G2Chart;
