import { useEffect, memo, useMemo, useState } from 'react';
import copy from 'copy-to-clipboard';
import { ConfigProvider, Typography, Flex } from 'antd';
import type { ThoughtChainItemType } from '@ant-design/x';
import { ThoughtChain } from '@ant-design/x';
import { CheckCircleTwoTone, LoadingOutlined, CloseCircleTwoTone, CodeOutlined } from '@ant-design/icons';
import { Copy, Check } from 'lucide-react';
import { actionDelimiter, actionDomainSeparator, Constants } from '@because/data-provider';
import { useChatContext } from '~/Providers';
import type {
  MessageToolCalls,
  MessageContentItem,
  ThoughtChainData,
} from '~/utils/parseDatServerResponse';
import { mapAttachments } from '~/utils/map';
import { useLocalize } from '~/hooks';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { ChartRenderer, extractChartDataFromToolOutput } from '~/components/Chat/Messages/Content/ChartRenderer';
import {
  extractBecauseSkillsCommand,
  isBeCauseSkillsToolName,
  mapStandaloneToolName,
  isToolOutputError,
} from '~/utils/toolCallDisplay';

const { Text } = Typography;

// 扩展 ThoughtChainItemType 以支持 children
type ExtendedThoughtChainItemType = ThoughtChainItemType & {
  children?: React.ReactNode;
};

interface ThoughtChainPanelProps {
  toolCallsByMessage: MessageToolCalls[];
  shouldRender: boolean;
  onRenderChange: (shouldRender: boolean) => void;
}

/**
 * Dat-Server 思维链内容组件 - 显示推理过程
 * 展示 ask_data / becauseai-server 工具调用输出中解析出的
 * 意图分类 / SQL 生成推理 / SQL 生成 / 语义 SQL 转换 / SQL 执行结果
 */
function DatServerThoughtChainContent({ data }: { data: ThoughtChainData }) {
  const items = useMemo(() => {
    const result: ExtendedThoughtChainItemType[] = [];

    // 1. 意图分类
    if (data.intentClassification) {
      const intent = data.intentClassification;
      result.push({
        key: 'intent',
        title: '意图分类',
        description: intent.intent || '',
        status: 'success',
        collapsible: true,
        content: (
          <div className="space-y-2 text-sm">
            {intent.rephrased_question && (
              <div>
                <span className="font-medium">重述问题:</span> {intent.rephrased_question}
              </div>
            )}
            {intent.reasoning && (
              <div>
                <span className="font-medium">推理:</span> {intent.reasoning}
              </div>
            )}
          </div>
        ),
      });
    }

    // 2. SQL 生成推理
    if (data.sqlGenerationReasoning) {
      result.push({
        key: 'reasoning',
        title: 'SQL 生成推理',
        status: 'success',
        collapsible: true,
        content: (
          <div className="markdown prose prose-sm dark:prose-invert max-w-none">
            <MarkdownLite content={data.sqlGenerationReasoning} />
          </div>
        ),
      });
    }

    // 3. SQL 生成
    if (data.sqlGenerate) {
      result.push({
        key: 'generate',
        title: 'SQL 生成',
        status: 'success',
        collapsible: true,
        content: <SqlCodeBlock sql={data.sqlGenerate} />,
      });
    }

    // 4. 语义 SQL 转换
    if (data.semanticToSql) {
      const isError =
        typeof data.semanticToSql === 'string' &&
        data.semanticToSql.toLowerCase().includes('error');
      result.push({
        key: 'semantic',
        title: '语义 SQL 转换',
        status: isError ? 'error' : 'success',
        collapsible: true,
        content: isError ? (
          <div className="sql-chain-content text-sm text-red-500">{data.semanticToSql}</div>
        ) : (
          <SqlCodeBlock sql={data.semanticToSql} />
        ),
      });
    }

    // 5. SQL 执行结果
    if (data.sqlExecute) {
      result.push({
        key: 'execute',
        title: 'SQL 执行结果',
        status: 'success',
        collapsible: true,
        content: <SqlExecuteResult content={data.sqlExecute} />,
      });
    }

    // 6. 异常信息
    if (data.exception) {
      result.push({
        key: 'exception',
        title: '异常信息',
        description: data.exception.message || '',
        status: 'error',
      });
    }

    return result;
  }, [data]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 w-full min-w-0 max-w-full border-t border-border-light pt-2">
      <div className="mb-2 text-xs font-medium text-text-primary">推理过程</div>
      <div className="w-full min-w-0 max-w-full">
        <ThoughtChain items={items} defaultExpandedKeys={[]} />
      </div>
    </div>
  );
}

/**
 * 把单行/紧凑 SQL 格式化成可读多行（按子句断行 + 缩进）
 */
function formatSqlForDisplay(sql: string): string {
  const text = sql.trim().replace(/\s+/g, ' ');
  if (!text) return '';

  // 保护字符串字面量，避免内部关键字被误断行
  const literals: string[] = [];
  const protectedSql = text.replace(/('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`)/g, (m) => {
    literals.push(m);
    return `__SQL_LIT_${literals.length - 1}__`;
  });

  let out = protectedSql
    // 主子句前换行
    .replace(
      /\s+(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION ALL|UNION|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|OUTER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|JOIN)\b/gi,
      '\n$1',
    )
    // SELECT 后多个字段换行缩进
    .replace(/\bSELECT\s+/i, 'SELECT\n  ')
    .replace(/,(?!\s*\n)/g, ',\n  ')
    // JOIN ... ON 条件换行
    .replace(/\s+ON\s+/gi, '\n  ON ')
    // WHERE/HAVING 内 AND/OR 换行缩进
    .replace(/\s+(AND|OR)\s+/gi, '\n  $1 ');

  // 给非首行主子句保持顶格；续行保持两空格缩进
  out = out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => line.trim() !== '' || (idx > 0 && idx < arr.length - 1))
    .join('\n');

  return out.replace(/__SQL_LIT_(\d+)__/g, (_, i) => literals[Number(i)] ?? '');
}

const SQL_KEYWORD_RE =
  /^(SELECT|FROM|WHERE|GROUP|BY|ORDER|HAVING|LIMIT|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AND|OR|AS|IN|NOT|NULL|IS|LIKE|BETWEEN|EXISTS|CASE|WHEN|THEN|ELSE|END|DISTINCT|UNION|ALL|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|SUM|COUNT|AVG|MAX|MIN|COALESCE|IFNULL|CAST)$/i;

type SqlToken = { type: 'keyword' | 'string' | 'number' | 'comment' | 'plain'; text: string };

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const re =
    /(\/\*[\s\S]*?\*\/|--[^\n]*|'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`|\b\d+(\.\d+)?\b|[A-Za-z_][\w$]*|[^\s]|(\s+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const text = match[0];
    if (/^\s+$/.test(text)) {
      tokens.push({ type: 'plain', text });
    } else if (text.startsWith('--') || text.startsWith('/*')) {
      tokens.push({ type: 'comment', text });
    } else if (
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith('`') && text.endsWith('`'))
    ) {
      tokens.push({ type: 'string', text });
    } else if (/^\d+(\.\d+)?$/.test(text)) {
      tokens.push({ type: 'number', text });
    } else if (SQL_KEYWORD_RE.test(text)) {
      tokens.push({ type: 'keyword', text: text.toUpperCase() });
    } else {
      tokens.push({ type: 'plain', text });
    }
  }
  return tokens;
}

/**
 * 主题一致的 SQL 代码块：子句格式化 + 关键字高亮 + 不拆中文词
 */
function SqlCodeBlock({ sql }: { sql: string }) {
  const formatted = useMemo(() => formatSqlForDisplay(sql), [sql]);
  const tokens = useMemo(() => tokenizeSql(formatted), [formatted]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const ok = copy(sql.trim(), { format: 'text/plain' });
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="sql-chain-content mt-1 w-full overflow-hidden rounded-md border border-border-light bg-surface-tertiary">
      <div className="flex items-center justify-between border-b border-border-light px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          SQL
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          aria-label={copied ? '已复制' : '复制 SQL'}
          title={copied ? '已复制' : '复制 SQL'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <div className="max-h-72 overflow-auto px-3 py-2.5">
        <pre className="sql-code-pre m-0 font-mono text-[12px] leading-6">
          <code>
            {tokens.map((token, idx) => {
              if (token.type === 'keyword') {
                return (
                  <span key={idx} className="sql-tok-keyword font-semibold">
                    {token.text}
                  </span>
                );
              }
              if (token.type === 'string') {
                return (
                  <span key={idx} className="sql-tok-string">
                    {token.text}
                  </span>
                );
              }
              if (token.type === 'number') {
                return (
                  <span key={idx} className="sql-tok-number">
                    {token.text}
                  </span>
                );
              }
              if (token.type === 'comment') {
                return (
                  <span key={idx} className="sql-tok-comment">
                    {token.text}
                  </span>
                );
              }
              return <span key={idx}>{token.text}</span>;
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * 尝试把 sql_execute 段的各类转义/二次编码内容解析成 JSON
 */
function parseSqlExecutePayload(content: string): unknown {
  let text = content.trim().replace(/^(?:Query Results)\s*:\s*/i, '').trim();
  if (!text) return null;

  const tryParse = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };

  // 1) 直接解析
  let parsed = tryParse(text);
  if (parsed !== undefined) return parsed;

  // 2) 去掉首尾多余引号后再解析（含尾部游离 "）
  const trimmedQuotes = text.replace(/^"+/, '').replace(/"+$/, '');
  parsed = tryParse(trimmedQuotes);
  if (parsed !== undefined) return parsed;

  // 3) 字面量转义：{\"key\":1} → {"key":1}
  if (text.includes('\\"') || text.includes('\\n')) {
    const unescaped = text
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/^"+/, '')
      .replace(/"+$/, '');
    parsed = tryParse(unescaped);
    if (parsed !== undefined) return parsed;
  }

  // 4) 从文本中截取第一个 JSON 数组/对象
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const candidate = arrayMatch[0].replace(/\\"/g, '"');
    parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const candidate = objectMatch[0].replace(/\\"/g, '"');
    parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }

  return null;
}

/** 侧栏默认优先展示的 KPI / 问数列（存在才显示） */
const SQL_RESULT_PRIORITY_COLS = [
  'standard_name',
  'brchna',
  'org_code',
  'data_dt',
  'index_value',
  'mea_unit',
  'm_begin_change_value',
  'm_begin_change_ratio',
  'y_begin_change_value',
  'y_begin_change_ratio',
  'yd_change_value',
  'yd_change_ratio',
];

const SQL_RESULT_DEFAULT_COL_LIMIT = 6;

function formatSqlCellValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // DAT 常见日期数组：[2026,5,31,0,0] → 2026-05-31
  if (Array.isArray(value) && value.length >= 3 && value.every((n) => typeof n === 'number')) {
    const [y, m, d] = value as number[];
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pickVisibleSqlColumns(allKeys: string[], showAll: boolean): string[] {
  if (showAll || allKeys.length <= SQL_RESULT_DEFAULT_COL_LIMIT) {
    return allKeys;
  }
  const priority = SQL_RESULT_PRIORITY_COLS.filter((k) => allKeys.includes(k));
  if (priority.length > 0) {
    return priority;
  }
  return allKeys.slice(0, SQL_RESULT_DEFAULT_COL_LIMIT);
}

/**
 * SQL 执行结果组件 — 优先渲染为表格。
 * 关键：滚动容器宽度必须被侧栏约束（min-w-0 + max-w-full），
 * 表格用 w-max 超出容器，才能出现横向滚动条。
 */
function SqlExecuteResult({ content }: { content: string }) {
  const [showAllCols, setShowAllCols] = useState(false);
  const parsed = useMemo(() => parseSqlExecutePayload(content), [content]);

  const rows = useMemo(() => {
    if (Array.isArray(parsed)) {
      return parsed.filter((row) => row != null && typeof row === 'object') as Record<
        string,
        unknown
      >[];
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed as Record<string, unknown>];
    }
    return [];
  }, [parsed]);

  const allKeys = useMemo(
    () =>
      Array.from(
        rows.reduce((set, row) => {
          Object.keys(row).forEach((k) => set.add(k));
          return set;
        }, new Set<string>()),
      ),
    [rows],
  );

  const visibleKeys = useMemo(
    () => pickVisibleSqlColumns(allKeys, showAllCols),
    [allKeys, showAllCols],
  );

  const fallbackText = useMemo(() => {
    const unescaped = content
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
    try {
      return JSON.stringify(
        JSON.parse(unescaped.replace(/^"+/, '').replace(/"+$/, '')),
        null,
        2,
      );
    } catch {
      return unescaped;
    }
  }, [content]);

  if (rows.length > 0) {
    const hiddenColCount = Math.max(0, allKeys.length - visibleKeys.length);

    return (
      <div className="sql-chain-content w-full min-w-0 max-w-full space-y-1.5">
        <div
          className="sql-result-scroll rounded-md border border-border-light"
          style={{
            // width:0 + minWidth:100%：在 flex 祖先未设 min-width:0 时仍锁住侧栏宽度，
            // 避免表格把滚动容器撑到与内容同宽，导致外层裁切且无横滑条。
            width: 0,
            minWidth: '100%',
            maxWidth: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <table
            className="border-collapse text-sm"
            style={{ width: 'max-content', tableLayout: 'auto' }}
          >
            <thead>
              <tr className="bg-surface-secondary">
                {visibleKeys.map((key, colIdx) => (
                  <th
                    key={key}
                    className={[
                      'border-b border-r border-border-light px-2 py-1.5 text-left font-medium text-text-primary',
                      colIdx === 0 ? 'sticky left-0 z-[1] bg-surface-secondary shadow-[2px_0_4px_rgba(0,0,0,0.12)]' : '',
                    ].join(' ')}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((row, idx) => (
                <tr key={idx} className="hover:bg-surface-tertiary">
                  {visibleKeys.map((key, colIdx) => (
                    <td
                      key={key}
                      className={[
                        'border-b border-r border-border-light px-2 py-1.5 text-text-primary',
                        colIdx === 0 ? 'sticky left-0 z-[1] bg-surface-primary shadow-[2px_0_4px_rgba(0,0,0,0.12)]' : '',
                      ].join(' ')}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {formatSqlCellValue(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          {rows.length > 50 && <span>显示前 50 条，共 {rows.length} 条</span>}
          {hiddenColCount > 0 && (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setShowAllCols(true)}
            >
              显示全部 {allKeys.length} 列（已隐藏 {hiddenColCount}）
            </button>
          )}
          {showAllCols && allKeys.length > SQL_RESULT_DEFAULT_COL_LIMIT && (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setShowAllCols(false)}
            >
              只看关键列
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sql-chain-content max-h-48 w-full min-w-0 overflow-auto rounded-md border border-border-light bg-surface-tertiary p-2 text-sm">
      <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-text-primary">
        {fallbackText}
      </pre>
    </div>
  );
}

/**
 * 代码块组件 - 用于展示工具调用的参数和输出
 * 修复溢出问题，确保内容在容器内正确显示
 */
function OptimizedCodeBlock({ text, maxHeight = 200 }: { text: string; maxHeight?: number }) {
  const formatText = (str: string) => {
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  };

  return (
    <div
      className="mt-1 w-full overflow-hidden rounded-md bg-surface-tertiary"
      style={{ maxWidth: '100%' }}
    >
      <div
        className="overflow-auto p-2 text-xs text-text-primary"
        style={{ maxHeight, maxWidth: '100%' }}
      >
        <pre
          className="m-0 whitespace-pre-wrap"
          style={{
            wordBreak: 'break-all',
            overflowWrap: 'break-word',
            maxWidth: '100%',
          }}
        >
          <code>{formatText(text)}</code>
        </pre>
      </div>
    </div>
  );
}

/**
 * 工具调用详情内容组件 - 用于在可折叠区域内展示
 */
function ToolCallDetailContent({
  args,
  output,
  domain,
  function_name,
  thoughtChain,
  localize,
  isLoading,
}: {
  args: string;
  output?: string | null;
  domain: string | null;
  function_name: string;
  thoughtChain: ThoughtChainData | null;
  localize: any;
  isLoading: boolean;
}) {
  const hasOutput = output != null && output.length > 0;
  const previewArgs = useMemo(() => {
    if (!args) return '';
    if (!isLoading) return args;
    if (args.length <= 1200) return args;
    return `${args.slice(0, 1200)}\n\n...`;
  }, [args, isLoading]);

  const previewOutput = useMemo(() => {
    if (!output) return output;
    if (!isLoading) return output;
    if (output.length <= 1200) return output;
    return `${output.slice(0, 1200)}\n\n...`;
  }, [output, isLoading]);

  const chartData = useMemo(
    () => (typeof output === 'string' && output.length > 0 ? extractChartDataFromToolOutput(output) : null),
    [output],
  );

  return (
    <div className="w-full min-w-0 max-w-full space-y-3">
      {args && (
        <div className="w-full min-w-0 max-w-full overflow-hidden">
          <Text type="secondary" className="mb-1 block text-xs">
            {domain
              ? localize('com_assistants_domain_info', { 0: domain })
              : localize('com_assistants_function_use', { 0: function_name })}
          </Text>
          <OptimizedCodeBlock text={previewArgs} />
        </div>
      )}

      {chartData && (
        <ChartRenderer
          chartId={`tc-${chartData.chartId}`}
          title={chartData.title}
          data={chartData.data}
          layout={chartData.layout}
        />
      )}

      {hasOutput && !chartData && previewOutput && (
        <div className="w-full min-w-0 max-w-full overflow-hidden">
          <Text type="secondary" className="mb-1 block text-xs">
            {localize('com_ui_result')}
          </Text>
          <OptimizedCodeBlock text={previewOutput} />
        </div>
      )}

      {/* dat-server 结构化推理过程（意图分类 / SQL 生成 / SQL 执行结果等） */}
      {thoughtChain && (
        <div className="w-full min-w-0 max-w-full">
          <DatServerThoughtChainContent data={thoughtChain} />
        </div>
      )}
    </div>
  );
}

/**
 * 单个工具调用项 - 使用 ant-design-x ThoughtChain 组件
 * 支持折叠功能，保持实时数据更新能力
 */
function SidePanelToolCallItem({
  toolCall,
  thoughtChain,
  isSubmitting,
  itemKey,
}: {
  toolCall: {
    name: string;
    args: string | Record<string, unknown>;
    output?: string | null;
    progress?: number;
    id?: string;
    auth?: string;
    expires_at?: number;
  };
  thoughtChain: ThoughtChainData | null;
  attachments?: any[];
  isSubmitting: boolean;
  itemKey: string;
}) {
  const localize = useLocalize();

  // 解析工具名称和域名 - 与原生 ToolCall 逻辑一致
  const { function_name, domain, isMCPToolCall } = useMemo(() => {
    const name = toolCall.name;
    if (typeof name !== 'string') {
      return { function_name: '', domain: null, isMCPToolCall: false };
    }
    if (name.includes(Constants.mcp_delimiter)) {
      const [func, server] = name.split(Constants.mcp_delimiter);
      return {
        function_name: func || '',
        domain: server && (server.replaceAll(actionDomainSeparator, '.') || null),
        isMCPToolCall: true,
      };
    }
    const [func, _domain] = name.includes(actionDelimiter)
      ? name.split(actionDelimiter)
      : [name, ''];
    return {
      function_name: func || '',
      domain: _domain && (_domain.replaceAll(actionDomainSeparator, '.') || null),
      isMCPToolCall: false,
    };
  }, [toolCall.name]);

  // 解析工具参数，提取 command
  const parsedArgs = useMemo(() => {
    if (typeof toolCall.args === 'string') {
      try {
        return JSON.parse(toolCall.args);
      } catch {
        return null;
      }
    }
    return toolCall.args;
  }, [toolCall.args]);

  const isBeCauseSkills = isBeCauseSkillsToolName(function_name);

  // 获取子工具名称（如果是 because_skills / because_skills_2）
  const subToolName = useMemo(() => {
    if (isBeCauseSkills) {
      const command = extractBecauseSkillsCommand(parsedArgs) || extractBecauseSkillsCommand(toolCall.args);
      if (command) {
        return command;
      }
    }
    return null;
  }, [isBeCauseSkills, parsedArgs, toolCall.args]);

  // 格式化参数
  const args = useMemo(() => {
    if (typeof toolCall.args === 'string') {
      return toolCall.args;
    }
    try {
      return JSON.stringify(toolCall.args, null, 2);
    } catch {
      return '';
    }
  }, [toolCall.args]);

  // 状态计算
  const hasOutput = toolCall.output != null && toolCall.output.length > 0;
  const error = isToolOutputError(toolCall.output);
  // cancelled 优先判断：只要不在提交中且没有输出且不是错误，就视为被终止
  const cancelled = !isSubmitting && !hasOutput && !error;
  // isLoading 只在提交中且无输出无错误时才为 true，避免终止后仍显示转圈
  const isLoading = isSubmitting && !hasOutput && !error;

  // 获取状态 - ThoughtChain 支持 'success' | 'error' | 'loading' 等
  const getStatus = (): 'success' | 'error' | 'loading' => {
    if (error) return 'error';
    if (cancelled) return 'error';
    if (hasOutput) return 'success';
    return 'loading';
  };

  // 获取图标 - 使用 TwoTone 图标组件，支持 twoToneColor 属性设置颜色
  const getIcon = () => {
    if (isLoading) return <LoadingOutlined spin />;
    if (error || cancelled) {
      return <CloseCircleTwoTone twoToneColor="#ef4444" />;
    }
    if (hasOutput) {
      return <CheckCircleTwoTone twoToneColor="#10b981" />;
    }
    return <CodeOutlined />;
  };

  // 获取标题文本
  const getTitle = () => {
    // 如果是 because_skills/because_skills_2，优先使用子工具名称
    let displayName = subToolName;

    // 如果 subToolName 为空，且是 because_skills/because_skills_2，尝试实时提取
    if (!displayName && isBeCauseSkills) {
      displayName =
        extractBecauseSkillsCommand(parsedArgs) ||
        extractBecauseSkillsCommand(toolCall.args) ||
        null;
    }

    // 兜底：尽量显示函数名，避免回退成泛化文案
    if (!displayName) {
      displayName = mapStandaloneToolName(function_name) || function_name || null;
    }
    
    if (isLoading) {
      return displayName
        ? localize('com_assistants_running_var', { 0: displayName })
        : localize('com_assistants_running_action');
    }
    if (cancelled) {
      return localize('com_ui_cancelled');
    }
    if (isMCPToolCall) {
      return localize('com_assistants_completed_function', { 0: displayName });
    }
    if (domain && domain.length !== Constants.ENCODED_DOMAIN_LENGTH) {
      return localize('com_assistants_completed_action', { 0: domain });
    }
    return localize('com_assistants_completed_function', { 0: displayName });
  };

  // 是否有详情内容
  const hasDetails = args || hasOutput || thoughtChain;

  // 构建 ThoughtChain 项目 - 显式指定类型避免类型错误
  const status = getStatus();
  // 如果没有 domain，就不要在 description 再重复 function_name，避免出现
  //「运行 because」下一行又单独显示「because」的重复效果
  const description =
    domain && domain.length !== Constants.ENCODED_DOMAIN_LENGTH ? domain : '';

  const toolCallItems: ExtendedThoughtChainItemType[] = [
    {
      key: itemKey,
      title: getTitle(),
      description,
      icon: getIcon(),
      status,
      collapsible: !!hasDetails,
      content: hasDetails ? (
        <ToolCallDetailContent
          args={args}
          output={toolCall.output}
          domain={domain}
          function_name={function_name}
          thoughtChain={thoughtChain}
          localize={localize}
          isLoading={status === 'loading'}
        />
      ) : undefined,
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full text-sm">
      <ThoughtChain items={toolCallItems} />
    </div>
  );
}

/**
 * ThoughtChainPanel 组件 - 使用 ant-design-x ThoughtChain 组件展示思维链
 * 直接引用原生 ToolCall 组件实现实时展示
 */
const ThoughtChainPanel = memo(function ThoughtChainPanel({
  toolCallsByMessage,
  shouldRender,
  onRenderChange,
}: ThoughtChainPanelProps) {
  const { getMessages, isSubmitting } = useChatContext();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // 获取所有消息的附件
  const attachmentsMap = useMemo(() => {
    const messages = getMessages();
    if (!messages || messages.length === 0) {
      return {};
    }

    const allAttachments: any[] = [];
    messages.forEach((message: any) => {
      if (message.attachments && Array.isArray(message.attachments)) {
        allAttachments.push(...message.attachments);
      }
    });

    return mapAttachments(allAttachments);
  }, [getMessages]);

  // 通知父组件是否有数据需要渲染
  useEffect(() => {
    if (toolCallsByMessage.length > 0) {
      onRenderChange(true);
    }
  }, [toolCallsByMessage, onRenderChange]);

  // 自动展开最新的轮次
  useEffect(() => {
    if (toolCallsByMessage.length > 0) {
      const latestKey = `round-${toolCallsByMessage.length - 1}`;
      setExpandedKeys((prev) => {
        if (!prev.includes(latestKey)) {
          return [...prev, latestKey];
        }
        return prev;
      });
    }
  }, [toolCallsByMessage.length]);

  if (!shouldRender) {
    return null;
  }

  if (toolCallsByMessage.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-sm">暂无思维链数据</p>
        </div>
      </div>
    );
  }

  // 构建 ThoughtChain 项目 - 按对话轮次分组
  // 只展示「包含工具调用」的轮次；纯文本轮次不进入思维链
  const chainItems: ExtendedThoughtChainItemType[] = toolCallsByMessage
    .filter((messageData) => messageData.toolCalls && messageData.toolCalls.length > 0)
    .map((messageData, roundIdx) => {
      const roundKey = `round-${roundIdx}`;
      const toolCount = messageData.toolCalls.length;
      // messageData.isStreaming 在终止后仍可能为 true（parseDatServerResponse 不感知 isSubmitting），
      // 需要与 isSubmitting 联合判断，防止终止后轮次图标仍显示转圈
      const isStreaming = messageData.isStreaming && isSubmitting;

      // 只有在提交中时，"无输出"才代表正在加载；终止后"无输出"应视为已取消
      const hasAnyLoading =
        isSubmitting &&
        messageData.toolCalls.some(
          (tc) => tc.toolCall.output == null || tc.toolCall.output.length === 0,
        );

      // 终止后，存在无输出的工具调用 → 轮次状态标记为 error（已取消）
      const hasAnyCancelled =
        !isSubmitting &&
        messageData.toolCalls.some(
          (tc) => tc.toolCall.output == null || tc.toolCall.output.length === 0,
        );

      // 构建描述文本
      const descriptionParts: string[] = [];
      if (toolCount > 0) {
        descriptionParts.push(`${toolCount} 个工具调用`);
      }
      const textCount = messageData.contentItems?.filter((item) => item.type === 'text').length || 0;
      if (textCount > 0) {
        descriptionParts.push(`${textCount} 段思考`);
      }
      const description = descriptionParts.join('，') || '无内容';

      // 按照 contentItems 的顺序渲染内容
      const renderContentItems = () => {
        if (!messageData.contentItems || messageData.contentItems.length === 0) {
          return null;
        }

        return (
          <Flex gap="small" vertical style={{ width: '100%' }}>
            {messageData.contentItems.map((item, itemIdx) => {
              if (item.type === 'text') {
                // 渲染文本内容（说明类文案：字号与轮次标题一致，但颜色更浅）
                return (
                  <Text
                    key={`${roundKey}-text-${itemIdx}`}
                    type="secondary"
                    className="text-sm leading-5 text-text-tertiary"
                    style={{ width: '100%', wordBreak: 'break-word' }}
                  >
                    <div className="prose prose-sm max-w-none text-text-tertiary [&_*]:!text-text-tertiary [&_p]:mb-1.5 [&_p]:last:mb-0">
                      <MarkdownLite content={item.text || ''} />
                    </div>
                  </Text>
                );
              } else if (item.type === 'toolCall' && item.toolCall) {
                // 渲染工具调用
                const tcKey = `${roundKey}-tc-${itemIdx}`;
                const tcAttachments = item.toolCall.toolCall.id
                  ? attachmentsMap[item.toolCall.toolCall.id]
                  : undefined;

                return (
                  <SidePanelToolCallItem
                    key={tcKey}
                    itemKey={tcKey}
                    toolCall={item.toolCall.toolCall}
                    thoughtChain={item.toolCall.thoughtChain}
                    attachments={tcAttachments}
                    isSubmitting={isSubmitting}
                  />
                );
              }
              return null;
            })}
          </Flex>
        );
      };

      return {
        key: roundKey,
        title: `第 ${messageData.messageIndex} 轮对话`,
        description,
        status: isStreaming || hasAnyLoading ? 'loading' : hasAnyCancelled ? 'error' : 'success',
        collapsible: true,
        content: renderContentItems(),
      };
    },
  );

  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgContainer: 'var(--bg-surface-secondary)',
          colorText: 'var(--text-primary)',
          colorBorder: 'var(--border-light)',
          colorTextDescription: 'var(--text-secondary)',
        },
        components: {
          // ThoughtChain 是 @ant-design/x 的组件，这里通过 any 绕过 antd 类型检查
          ...( {
          ThoughtChain: {
            titleColor: 'var(--text-primary)',
            descriptionColor: 'var(--text-secondary)',
            itemBg: 'transparent',
            itemHoverBg: 'var(--surface-hover)',
              // 状态颜色配置
              successColor: '#10b981', // 绿色
              errorColor: '#ef4444', // 红色
              loadingColor: 'var(--text-secondary)', // 加载中颜色
          },
          } as any),
        },
      } as any}
    >
      <div className="flex h-full min-w-0 w-full flex-col overflow-hidden">
        {/* 标题 */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border-light bg-background px-4 py-3">
          <div className="text-base font-semibold text-text-primary">思维链</div>
          <div className="text-xs text-text-secondary">共 {toolCallsByMessage.length} 轮</div>
        </div>

        {/* 思维链内容 */}
        <div
          className="thought-chain-container min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 text-sm"
          style={{
            // 思维链整体基准文字颜色用三级文字色，更浅一些
            color: 'var(--text-tertiary)',
            // 使用与chat对话流一致的字体大小
            fontSize: 'var(--markdown-font-size)',
          } as React.CSSProperties}
        >
          <style dangerouslySetInnerHTML={{ __html: `
            /* ThoughtChain flex 链：允许内容区收缩到侧栏宽度，横滑发生在 .sql-result-scroll 内 */
            .thought-chain-container .ant-thought-chain,
            .thought-chain-container .ant-thought-chain-box,
            .thought-chain-container .ant-thought-chain-node,
            .thought-chain-container .ant-thought-chain-node-box,
            .thought-chain-container .ant-thought-chain-node-content,
            .thought-chain-container .ant-thought-chain-node-content-box,
            .thought-chain-container .ant-thought-chain-item,
            .thought-chain-container .ant-thought-chain-item-content {
              min-width: 0 !important;
              max-width: 100%;
            }
            .thought-chain-container .ant-thought-chain-node-box {
              flex: 1 1 0%;
              overflow-x: clip;
            }
            .thought-chain-container .sql-result-scroll {
              overflow-x: auto !important;
              -webkit-overflow-scrolling: touch;
            }
            .thought-chain-container .sql-result-scroll table {
              width: max-content;
            }
            .thought-chain-container .sql-result-scroll th,
            .thought-chain-container .sql-result-scroll td {
              white-space: nowrap;
            }
            /* 基础文字颜色：使用次级文字色，降低对比度 */
            .thought-chain-container,
            .thought-chain-container *,
            .thought-chain-container *::before,
            .thought-chain-container *::after {
              color: var(--text-tertiary) !important;
            }
            /* SQL / 执行结果内容使用主文字色，避免表格和代码块对比度不足 */
            .thought-chain-container .sql-chain-content,
            .thought-chain-container .sql-chain-content *,
            .thought-chain-container .sql-chain-content *::before,
            .thought-chain-container .sql-chain-content *::after {
              color: var(--text-primary) !important;
            }
            .thought-chain-container .sql-chain-content .text-text-secondary,
            .thought-chain-container .sql-chain-content .text-text-secondary * {
              color: var(--text-secondary) !important;
            }
            .thought-chain-container .sql-chain-content button,
            .thought-chain-container .sql-chain-content button * {
              color: var(--text-secondary) !important;
            }
            .thought-chain-container .sql-chain-content button:hover,
            .thought-chain-container .sql-chain-content button:hover * {
              color: var(--text-primary) !important;
            }
            /* SQL 代码块：保留格式、不拆中文词；关键字/字符串高亮 */
            .thought-chain-container .sql-chain-content .sql-code-pre {
              white-space: pre;
              word-break: keep-all;
              overflow-wrap: normal;
              color: var(--text-primary) !important;
            }
            .thought-chain-container .sql-chain-content .sql-tok-keyword {
              color: #38bdf8 !important; /* sky-400 */
            }
            .thought-chain-container .sql-chain-content .sql-tok-string {
              color: #86efac !important; /* green-300 */
            }
            .thought-chain-container .sql-chain-content .sql-tok-number {
              color: #fbbf24 !important; /* amber-400 */
            }
            .thought-chain-container .sql-chain-content .sql-tok-comment {
              color: var(--text-secondary) !important;
              font-style: italic;
            }
            /* 标题元素使用主文字色，保证层级感 */
            .thought-chain-container [class*="title"],
            .thought-chain-container [class*="Title"],
            .thought-chain-container [class*="title"] *,
            .thought-chain-container [class*="Title"] *,
            .thought-chain-container button span:first-child,
            .thought-chain-container div[role="button"] span:first-child,
            .thought-chain-container button > span:first-of-type,
            .thought-chain-container div[role="button"] > span:first-of-type {
              color: var(--text-primary) !important;
            }
            /* 描述、副文本维持为次级文字色 */
            .thought-chain-container [class*="description"],
            .thought-chain-container [class*="Description"],
            .thought-chain-container [class*="description"] *,
            .thought-chain-container [class*="Description"] *,
            .thought-chain-container button span:last-child,
            .thought-chain-container div[role="button"] span:last-child,
            .thought-chain-container button > span:last-of-type,
            .thought-chain-container div[role="button"] > span:last-of-type {
              color: var(--text-tertiary) !important;
            }
            /* 覆盖内联颜色为三级文字色，进一步降低对比 */
            .thought-chain-container [style*="color"] {
              color: var(--text-tertiary) !important;
            }
            .thought-chain-container [style*="color"] [class*="description"],
            .thought-chain-container [style*="color"] [class*="Description"] {
              color: var(--text-tertiary) !important;
            }
            /* 工具调用图标颜色 - 根据状态设置 */
            .thought-chain-container [class*="anticon"][style*="color: rgb(239, 68, 68)"],
            .thought-chain-container [class*="anticon"][style*="color:#ef4444"],
            .thought-chain-container [class*="anticon"][style*="color: #ef4444"] {
              color: #ef4444 !important;
            }
            .thought-chain-container [class*="anticon"][style*="color: rgb(16, 185, 129)"],
            .thought-chain-container [class*="anticon"][style*="color:#10b981"],
            .thought-chain-container [class*="anticon"][style*="color: #10b981"] {
              color: #10b981 !important;
            }
            /* 通过 data-tool-call-status 属性设置图标颜色 - 使用更高优先级 */
            .thought-chain-container [data-tool-call-status="error"] [class*="anticon"],
            .thought-chain-container [data-tool-call-status="error"] [class*="anticon"] svg,
            .thought-chain-container [data-tool-call-status="error"] [class*="anticon"] path,
            .thought-chain-container [data-tool-call-status="error"] svg,
            .thought-chain-container [data-tool-call-status="error"] svg path,
            .thought-chain-container [data-tool-call-status="error"] path {
              color: #ef4444 !important;
              fill: #ef4444 !important;
              stroke: #ef4444 !important;
            }
            .thought-chain-container [data-tool-call-status="success"] [class*="anticon"],
            .thought-chain-container [data-tool-call-status="success"] [class*="anticon"] svg,
            .thought-chain-container [data-tool-call-status="success"] [class*="anticon"] path,
            .thought-chain-container [data-tool-call-status="success"] svg,
            .thought-chain-container [data-tool-call-status="success"] svg path,
            .thought-chain-container [data-tool-call-status="success"] path {
              color: #10b981 !important;
              fill: #10b981 !important;
              stroke: #10b981 !important;
            }
            /* 直接针对 Ant Design 图标类名和 SVG 元素 */
            .thought-chain-container .tool-call-icon-error [class*="anticon"],
            .thought-chain-container .tool-call-icon-error [class*="anticon"] svg,
            .thought-chain-container .tool-call-icon-error [class*="anticon"] svg path,
            .thought-chain-container .tool-call-icon-error svg,
            .thought-chain-container .tool-call-icon-error svg path,
            .thought-chain-container .tool-call-icon-error path {
              color: #ef4444 !important;
              fill: #ef4444 !important;
              stroke: #ef4444 !important;
            }
            .thought-chain-container .tool-call-icon-success [class*="anticon"],
            .thought-chain-container .tool-call-icon-success [class*="anticon"] svg,
            .thought-chain-container .tool-call-icon-success [class*="anticon"] svg path,
            .thought-chain-container .tool-call-icon-success svg,
            .thought-chain-container .tool-call-icon-success svg path,
            .thought-chain-container .tool-call-icon-success path {
              color: #10b981 !important;
              fill: #10b981 !important;
              stroke: #10b981 !important;
            }
            /* 针对 Ant Design 图标的具体类名 */
            .thought-chain-container .anticon-close-circle svg,
            .thought-chain-container .anticon-close-circle svg path {
              fill: #ef4444 !important;
              color: #ef4444 !important;
            }
            .thought-chain-container .anticon-check-circle svg,
            .thought-chain-container .anticon-check-circle svg path {
              fill: #10b981 !important;
              color: #10b981 !important;
            }
            /* TwoTone 图标颜色支持 */
            .thought-chain-container .anticon-check-circle-two-tone svg path[fill*="#"],
            .thought-chain-container .anticon-check-circle-two-tone svg path[fill*="rgb"] {
              fill: #10b981 !important;
            }
            .thought-chain-container .anticon-close-circle-two-tone svg path[fill*="#"],
            .thought-chain-container .anticon-close-circle-two-tone svg path[fill*="rgb"] {
              fill: #ef4444 !important;
            }
          `}} />
          <ThoughtChain items={chainItems} expandedKeys={expandedKeys} onExpand={setExpandedKeys} />
        </div>
      </div>
    </ConfigProvider>
  );
});

ThoughtChainPanel.displayName = 'ThoughtChainPanel';

export default ThoughtChainPanel;
