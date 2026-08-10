import { useMemo, useState, type ReactNode } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { ChevronDown, RotateCcw, Play } from "lucide-react";
import { AgentCapabilities, dataService } from "@because/data-provider";
import {
  OGDialog,
  OGDialogTemplate,
  Switch,
  Input,
  Label,
  Button,
  useToastContext,
} from "@because/client";
import type { AgentForm } from "~/common";

const AUTO_CHART_FIELD = AgentCapabilities.auto_chart ?? "auto_chart";
const CHART_CONFIG_SET_OPTS = { shouldDirty: true, shouldTouch: true } as const;

const DEFAULT_MATCH_RULES = {
  time_series: { enabled: true, chart_type: "line", min_periods: 2, sort: "time_asc" },
  dimension_compare: {
    enabled: true,
    chart_type: "pie",
    min_categories: 2,
    sort: "value_desc",
    pie_top_n: 8,
  },
  baseline_compare: {
    enabled: true,
    chart_type: "line",
    min_points: 2,
    order: "history_to_current",
  },
} as const;

type RuleKey = keyof typeof DEFAULT_MATCH_RULES;
type MatchRules = Record<string, Record<string, unknown>>;

const INDICATOR_PRESET = {
  preset: "indicator" as const,
  input_mode: "simple" as const,
  marker: "zb",
  placement: "prepend" as const,
  max_charts: 1,
};

const ATTRIBUTION_PRESET = {
  preset: "attribution" as const,
  input_mode: "simple" as const,
  marker: "result",
  placement: "semantic" as const,
  max_charts: 3,
};

type ChartConfigDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function asRules(value: unknown): MatchRules {
  return value && typeof value === "object" ? (value as MatchRules) : {};
}

export default function ChartConfigDialog({ open, onOpenChange }: ChartConfigDialogProps) {
  const { showToast } = useToastContext();
  const { control, setValue, watch, getValues } = useFormContext<AgentForm>();
  const chartConfig = watch("chart_config") as Record<string, unknown> | undefined;
  const autoChartEnabled = watch("auto_chart") === true;
  const [activeTab, setActiveTab] = useState<"auto" | "match" | "general">("auto");
  const [openRules, setOpenRules] = useState<Record<string, boolean>>({
    time_series: true,
    dimension_compare: false,
    baseline_compare: false,
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewQuery, setPreviewQuery] = useState("查询各机构存款余额占比");
  const [previewOutput, setPreviewOutput] = useState('[{"brchna":"机构A","index_value":100},{"brchna":"机构B","index_value":200}]');
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const rules = useMemo(() => asRules(chartConfig?.match_rules), [chartConfig?.match_rules]);
  const ruleValue = (key: RuleKey, field: string, fallback: unknown) =>
    rules[key]?.[field] ?? fallback;
  const updateRule = (key: RuleKey, field: string, value: unknown) => {
    const next = { ...rules, [key]: { ...(rules[key] ?? {}), [field]: value } };
    setValue("chart_config.match_rules" as never, next as never, CHART_CONFIG_SET_OPTS);
  };

  const resetMatchRules = () => {
    setValue("chart_config.match_rules" as never, { ...DEFAULT_MATCH_RULES } as never, CHART_CONFIG_SET_OPTS);
    showToast({ message: "图表匹配规则已恢复默认，请保存智能体" });
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      let parsed: unknown = previewOutput;
      try { parsed = JSON.parse(previewOutput); } catch { /* server accepts tool text */ }
      const result = await dataService.chartMatchPreview({
        chartConfig: getValues("chart_config") ?? {},
        query: previewQuery,
        toolOutput: parsed as string | Record<string, unknown> | unknown[],
      });
      setPreviewResult(result as Record<string, unknown>);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : "规则试算失败" });
    } finally {
      setPreviewing(false);
    }
  };

  const select = (value: unknown, onChange: (value: string) => void, options: Array<[string, string]>) => (
    <select className="mt-1 w-full rounded border border-border-medium bg-transparent px-2 py-1" value={String(value)} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );

  const renderRule = (key: RuleKey, title: string, description: string, fields: ReactNode) => {
    const expanded = openRules[key];
    const enabled = ruleValue(key, "enabled", true) !== false;
    return (
      <section key={key} className="rounded-lg border border-border-light bg-surface-secondary/30 px-3 py-2">
        <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={expanded} onClick={() => setOpenRules((v) => ({ ...v, [key]: !v[key] }))}>
          <div className="min-w-0"><div className="flex items-center gap-2"><h4 className="font-medium">{title}</h4><span className={`text-xs ${enabled ? "text-green-600" : "text-text-secondary"}`}>{enabled ? "已启用" : "已停用"}</span></div><p className="mt-0.5 text-xs text-text-secondary">{description}</p></div>
          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {expanded && <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border-light pt-3 sm:grid-cols-2">{fields}</div>}
      </section>
    );
  };

  const numberField = (key: RuleKey, field: string, label: string, fallback: number, min: number, max: number) => (
    <div><Label>{label}</Label><Input className="mt-1" type="number" min={min} max={max} value={Number(ruleValue(key, field, fallback))} onChange={(e) => updateRule(key, field, Math.min(max, Math.max(min, Number(e.target.value) || fallback)))} /></div>
  );

  const optionalNumberField = (
    key: RuleKey,
    field: string,
    label: string,
    min: number,
    max: number,
  ) => {
    const value = rules[key]?.[field];
    return (
      <div>
        <Label>{label}</Label>
        <Input
          className="mt-1"
          type="number"
          min={min}
          max={max}
          placeholder="留空表示不限"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            updateRule(
              key,
              field,
              raw === "" ? undefined : Math.min(max, Math.max(min, Number(raw) || min)),
            );
          }}
        />
      </div>
    );
  };

  const matchPage = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">按固定优先级匹配；字段由系统自动识别，规则修改会同时影响 Simple 和 Legacy 自动生图。</p>
        <Button type="button" size="sm" variant="outline" onClick={resetMatchRules} title="恢复系统默认匹配规则"><RotateCcw className="mr-1 h-4 w-4" />恢复默认</Button>
      </div>
      {renderRule("time_series", "1. 多期时间趋势", "至少出现多个不同日期和数值字段时命中", <>
        <div className="flex items-center justify-between"><Label>启用</Label><Switch aria-label="启用多期时间趋势规则" checked={ruleValue("time_series", "enabled", true) !== false} onCheckedChange={(v) => updateRule("time_series", "enabled", v)} /></div>
        <div><Label>图形</Label>{select(ruleValue("time_series", "chart_type", "line"), (v) => updateRule("time_series", "chart_type", v), [["line", "折线图"], ["bar", "柱状图"]])}</div>
        {numberField("time_series", "min_periods", "最少不同日期数", 2, 2, 100)}
        <div><Label>排序</Label>{select(ruleValue("time_series", "sort", "time_asc"), (v) => updateRule("time_series", "sort", v), [["time_asc", "时间正序"], ["time_desc", "时间倒序"]])}</div>
        {optionalNumberField("time_series", "max_points", "最多展示点数", 2, 100)}
      </>)}
      {renderRule("dimension_compare", "2. 多机构 / 多指标单期", "Query Results 中机构或指标分类达到阈值时命中，默认生成饼图", <>
        <div className="flex items-center justify-between"><Label>启用</Label><Switch aria-label="启用多机构多维度规则" checked={ruleValue("dimension_compare", "enabled", true) !== false} onCheckedChange={(v) => updateRule("dimension_compare", "enabled", v)} /></div>
        <div><Label>图形</Label>{select(ruleValue("dimension_compare", "chart_type", "pie"), (v) => updateRule("dimension_compare", "chart_type", v), [["pie", "饼图"], ["bar", "柱状图"]])}</div>
        {numberField("dimension_compare", "min_categories", "最少分类数", 2, 2, 50)}
        <div><Label>排序</Label>{select(ruleValue("dimension_compare", "sort", "value_desc"), (v) => updateRule("dimension_compare", "sort", v), [["value_desc", "数值降序"], ["value_asc", "数值升序"], ["dimension_asc", "分类名称正序"], ["source", "原始顺序"]])}</div>
        {numberField("dimension_compare", "pie_top_n", "饼图 Top N（其余合并为其他）", 8, 2, 20)}
        {optionalNumberField("dimension_compare", "bar_max_items", "柱状图最多分类数", 2, 50)}
      </>)}
      {renderRule("baseline_compare", "3. 单指标时点对比", "单行包含当前值、上日、上月末等时间对比字段时命中", <>
        <div className="flex items-center justify-between"><Label>启用</Label><Switch aria-label="启用单指标时点对比规则" checked={ruleValue("baseline_compare", "enabled", true) !== false} onCheckedChange={(v) => updateRule("baseline_compare", "enabled", v)} /></div>
        <div><Label>图形</Label>{select(ruleValue("baseline_compare", "chart_type", "line"), (v) => updateRule("baseline_compare", "chart_type", v), [["line", "折线图"], ["bar", "柱状图"]])}</div>
        {numberField("baseline_compare", "min_points", "最少有效时点数", 2, 2, 6)}
        <div><Label>顺序</Label>{select(ruleValue("baseline_compare", "order", "history_to_current"), (v) => updateRule("baseline_compare", "order", v), [["history_to_current", "历史到当前"], ["current_to_history", "当前到历史"]])}</div>
      </>)}
      <div className="border-t border-border-light pt-3">
        <button type="button" className="flex w-full items-center justify-between text-left" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}><div><Label>规则试算</Label><p className="mt-0.5 text-xs text-text-secondary">用当前未保存配置预览匹配结果</p></div><ChevronDown className={`h-4 w-4 transition-transform ${showPreview ? "rotate-180" : ""}`} aria-hidden /></button>
        {showPreview && <div className="mt-3 rounded-lg border border-border-light p-3"><div className="flex justify-end"><Button type="button" size="sm" variant="outline" onClick={runPreview} disabled={previewing}><Play className="mr-1 h-4 w-4" />{previewing ? "试算中" : "运行试算"}</Button></div>
          <Input className="mt-2" value={previewQuery} onChange={(e) => setPreviewQuery(e.target.value)} placeholder="用户问题（用于识别占比意图）" />
          <textarea className="mt-2 min-h-24 w-full rounded border border-border-medium bg-transparent p-2 text-xs" value={previewOutput} onChange={(e) => setPreviewOutput(e.target.value)} />
          {previewResult && <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-secondary p-2 text-xs">{JSON.stringify(previewResult, null, 2)}</pre>}
        </div>}
      </div>
    </div>
  );

  const autoPage = <div className="space-y-4">
    <div className="flex items-center justify-between gap-4"><div><Label className="font-medium">自动生图</Label><p className="text-xs text-text-secondary">服务端根据查数结果自动匹配图表，不影响模型手动调用。</p></div><Controller name={AUTO_CHART_FIELD} control={control} defaultValue={false} render={({ field }) => <Switch aria-label="自动生图" checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />} /></div>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!autoChartEnabled} onClick={() => setValue("chart_config", { ...(chartConfig ?? {}), ...INDICATOR_PRESET }, CHART_CONFIG_SET_OPTS)}>指标预设</Button><Button type="button" size="sm" variant="outline" disabled={!autoChartEnabled} onClick={() => setValue("chart_config", { ...(chartConfig ?? {}), ...ATTRIBUTION_PRESET }, CHART_CONFIG_SET_OPTS)}>归因预设</Button></div>
    <div><Label>自动图位置</Label>{select(chartConfig?.placement ?? "prepend", (v) => setValue("chart_config.placement" as never, v as never, CHART_CONFIG_SET_OPTS), [["prepend", "前置插入"], ["semantic", "语义插入"]])}</div>
  </div>;

  const generalPage = <div className="space-y-4">
    <div><Label>入参协议</Label>{select(chartConfig?.input_mode ?? "simple", (v) => setValue("chart_config.input_mode" as never, v as never, CHART_CONFIG_SET_OPTS), [["simple", "简化协议"], ["legacy", "完整协议"]])}</div>
    <div><Label>占位标记</Label><Input className="mt-1" maxLength={32} value={String(chartConfig?.marker ?? "")} onChange={(e) => setValue("chart_config.marker" as never, (e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined) as never, CHART_CONFIG_SET_OPTS)} /></div>
    <div><Label>单轮上限</Label><Input className="mt-1" type="number" min={1} max={5} value={Number(chartConfig?.max_charts ?? 2)} onChange={(e) => setValue("chart_config.max_charts" as never, Math.min(5, Math.max(1, Number(e.target.value) || 2)) as never, CHART_CONFIG_SET_OPTS)} /></div>
    <div className="flex items-center justify-between"><Label>同角色图表去重</Label><Switch aria-label="同角色图表去重" checked={chartConfig?.dedupe_roles !== false} onCheckedChange={(v) => setValue("chart_config.dedupe_roles" as never, v as never, CHART_CONFIG_SET_OPTS)} /></div>
    <div className="flex items-center justify-between"><Label>去掉图例（legend）</Label><Switch aria-label="去掉图例" checked={chartConfig?.hide_legend === true} onCheckedChange={(v) => setValue("chart_config.hide_legend" as never, v as never, CHART_CONFIG_SET_OPTS)} /></div>
    <div>
      <div className="flex items-center justify-between gap-4"><Label>对模型隐藏图表工具</Label><Switch aria-label="对模型隐藏图表工具" checked={chartConfig?.hide_from_model === true} onCheckedChange={(v) => setValue("chart_config.hide_from_model" as never, v as never, CHART_CONFIG_SET_OPTS)} /></div>
      <p className="mt-1 text-xs text-text-secondary">开启后模型不能主动调用图表工具，服务端自动生图仍可使用。</p>
    </div>
  </div>;

  return <OGDialog open={open} onOpenChange={onOpenChange}><OGDialogTemplate title="图表设置" className="max-w-3xl" showCloseButton main={<div className="py-2 text-sm text-text-primary"><div className="mb-4 flex border-b border-border-light"><button type="button" className={`flex-1 border-b-2 px-3 py-2 ${activeTab === "auto" ? "border-primary" : "border-transparent"}`} onClick={() => setActiveTab("auto")}>自动生图</button><button type="button" className={`flex-1 border-b-2 px-3 py-2 ${activeTab === "match" ? "border-primary" : "border-transparent"}`} onClick={() => setActiveTab("match")}>图表匹配</button><button type="button" className={`flex-1 border-b-2 px-3 py-2 ${activeTab === "general" ? "border-primary" : "border-transparent"}`} onClick={() => setActiveTab("general")}>通用配置</button></div>{activeTab === "auto" ? autoPage : activeTab === "match" ? matchPage : generalPage}</div>} buttons={<Button type="button" onClick={() => { const next = getValues("chart_config"); if (next) setValue("chart_config", { ...next }, CHART_CONFIG_SET_OPTS); showToast({ message: "图表设置已应用，请保存智能体以持久化" }); onOpenChange(false); }}>确定</Button>} /></OGDialog>;
}
