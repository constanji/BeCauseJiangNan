type Row = Record<string, unknown>;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(/,/g, '').replace(/%$/, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isWanYuan(rows: Row[]): boolean {
  return rows.some((row) => {
    const unit = row.mea_unit ?? row['计量单位'] ?? row['单位'];
    return String(unit ?? '').trim() === '万元';
  });
}

function shouldUseYiYuan(values: number[]): boolean {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return false;
  return numeric.filter((value) => Math.abs(value) >= 10000).length > numeric.length / 2;
}

function toYiYuan(value: number): number {
  return Math.round((value / 10000 + Number.EPSILON) * 100) / 100;
}

function normalizeLegacyOption(option: Record<string, unknown>): Record<string, unknown> {
  const series = Array.isArray(option.series) ? option.series : [];
  const values = series.flatMap((rawSeries) => {
    if (!rawSeries || typeof rawSeries !== 'object') return [];
    const data = Array.isArray((rawSeries as Row).data) ? (rawSeries as Row).data as unknown[] : [];
    return data.map((item) => {
      if (typeof item === 'number') return item;
      if (item && typeof item === 'object') return toNumber((item as Row).value);
      return null;
    }).filter((value): value is number => value != null);
  });
  if (!shouldUseYiYuan(values)) return option;

  return {
    ...option,
    yAxis: Array.isArray(option.yAxis)
      ? option.yAxis.map((axis) =>
          axis && typeof axis === 'object'
            ? { ...(axis as Row), name: '亿元' }
            : axis,
        )
      : option.yAxis && typeof option.yAxis === 'object'
        ? { ...(option.yAxis as Row), name: '亿元' }
        : option.yAxis,
    series: series.map((rawSeries) => {
      if (!rawSeries || typeof rawSeries !== 'object') return rawSeries;
      const data = Array.isArray((rawSeries as Row).data) ? (rawSeries as Row).data as unknown[] : [];
      return {
        ...(rawSeries as Row),
        data: data.map((item) => {
          if (typeof item === 'number') return toYiYuan(item);
          if (!item || typeof item !== 'object') return item;
          const value = toNumber((item as Row).value);
          return value == null ? item : { ...(item as Row), value: toYiYuan(value) };
        }),
      };
    }),
  };
}

/** Convert only the chart payload; query rows and answer text remain unchanged. */
export function normalizeAutoChartUnits(charts: unknown[], rows: Row[]): unknown[] {
  if (!isWanYuan(rows)) return charts;

  return charts.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const chart = raw as Record<string, unknown>;
    const data = Array.isArray(chart.data) ? chart.data : [];
    const yFields = Array.isArray(chart.yFields)
      ? chart.yFields.filter((field): field is string => typeof field === 'string')
      : [];
    const values = data.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      return yFields.map((field) => toNumber((item as Row)[field])).filter(
        (value): value is number => value != null,
      );
    });

    if (!data.length || !yFields.length) {
      const option = chart.echartsOption;
      if (option && typeof option === 'object' && isWanYuan(rows)) {
        const normalizedOption = normalizeLegacyOption(option as Record<string, unknown>);
        if (normalizedOption !== option) {
          return { ...chart, echartsOption: normalizedOption };
        }
      }
      return raw;
    }
    if (!shouldUseYiYuan(values)) return raw;
    return {
      ...chart,
      unit: '亿元',
      data: data.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const next = { ...(item as Row) };
        for (const field of yFields) {
          const value = toNumber(next[field]);
          if (value != null) next[field] = toYiYuan(value);
        }
        return next;
      }),
    };
  });
}
