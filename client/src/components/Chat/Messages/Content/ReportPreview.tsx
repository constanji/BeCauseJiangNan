import React, { memo, useRef, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, FileText, Copy, Check } from "lucide-react";
import copyToClipboard from "copy-to-clipboard";
import cn from "~/utils/cn";

interface ReportPreviewProps {
  content: string;
  className?: string;
}

/**
 * ReportPreview 组件
 * 用于将 report 代码块中的 markdown 内容渲染为 Word 文档样式
 * 支持实时预览和导出 Word 功能
 */
const ReportPreview = memo(({ content, className }: ReportPreviewProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 处理复制操作
  const handleCopy = useCallback(() => {
    // 复制纯文本内容（去除 markdown 标记）
    const textContent = contentRef.current?.innerText || content;
    copyToClipboard(textContent, { format: "text/plain" });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [content]);

  // 导出为 Word 文档
  const handleExportWord = useCallback(() => {
    if (!contentRef.current) return;

    setIsExporting(true);

    try {
      const htmlContent = contentRef.current.innerHTML;

      // 构建 Word 兼容的 HTML
      const wordDocument = `
        <!DOCTYPE html>
        <html xmlns:o='urn:schemas-microsoft-com:office:office' 
              xmlns:w='urn:schemas-microsoft-com:office:word' 
              xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <meta charset='utf-8'>
          <title>Document</title>
          <style>
            body {
              font-family: 'SimSun', 'STSong', serif;
              font-size: 12pt;
              line-height: 1.8;
              color: #000;
            }
            h1 {
              font-family: 'SimHei', sans-serif;
              font-size: 22pt;
              text-align: center;
              margin-bottom: 24pt;
              font-weight: bold;
            }
            h2 {
              font-family: 'SimHei', sans-serif;
              font-size: 16pt;
              margin-top: 18pt;
              margin-bottom: 12pt;
              font-weight: bold;
            }
            h3 {
              font-family: 'SimHei', sans-serif;
              font-size: 14pt;
              margin-top: 12pt;
              margin-bottom: 8pt;
              font-weight: bold;
            }
            p {
              text-indent: 2em;
              margin: 10pt 0;
              text-align: justify;
            }
            ul, ol {
              margin-left: 2em;
            }
            li {
              margin: 6pt 0;
            }
            strong {
              font-weight: bold;
            }
            em {
              font-style: italic;
            }
            pre {
              background: #f5f5f5;
              padding: 12pt;
              border: 1px solid #ddd;
              font-family: 'Consolas', 'Monaco', monospace;
              font-size: 10pt;
              overflow-x: auto;
            }
            code {
              font-family: 'Consolas', 'Monaco', monospace;
              background: #f5f5f5;
              padding: 2pt 4pt;
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `;

      // 创建 Blob 并下载
      const blob = new Blob(["\ufeff", wordDocument], {
        type: "application/msword;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // 从内容中提取标题作为文件名
      const titleMatch = content.match(/^#\s+(.+?)$/m);
      const fileName = titleMatch
        ? `${titleMatch[1].slice(0, 50).replace(/[<>:"/\\|?*]/g, "")}.doc`
        : `document_${Date.now()}.doc`;

      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export Word failed:", error);
    } finally {
      setIsExporting(false);
    }
  }, [content]);

  // 自定义 Markdown 组件 - 全部使用 Tailwind 类名
  const components = useMemo(
    () => ({
      h1: ({ children }: { children: React.ReactNode }) => (
        <h1 className="mb-5 text-center text-lg font-bold text-white">
          {children}
        </h1>
      ),
      h2: ({ children }: { children: React.ReactNode }) => (
        <h2 className="mb-3 mt-5 border-b border-gray-600 pb-2 text-base font-bold text-white">
          {children}
        </h2>
      ),
      h3: ({ children }: { children: React.ReactNode }) => (
        <h3 className="mb-2 mt-4 text-sm font-bold text-gray-200">
          {children}
        </h3>
      ),
      p: ({ children }: { children: React.ReactNode }) => (
        <p className="my-2 indent-8 text-justify text-gray-200 break-words whitespace-pre-wrap">
          {children}
        </p>
      ),
      ul: ({ children }: { children: React.ReactNode }) => (
        <ul className="my-2 list-disc pl-8 text-gray-200">{children}</ul>
      ),
      ol: ({ children }: { children: React.ReactNode }) => (
        <ol className="my-2 list-decimal pl-8 text-gray-200">{children}</ol>
      ),
      li: ({ children }: { children: React.ReactNode }) => (
        <li className="my-1 text-gray-200">{children}</li>
      ),
      strong: ({ children }: { children: React.ReactNode }) => (
        <strong className="font-bold text-white">{children}</strong>
      ),
      em: ({ children }: { children: React.ReactNode }) => (
        <em className="italic text-gray-300">{children}</em>
      ),
      blockquote: ({ children }: { children: React.ReactNode }) => (
        <blockquote className="my-3 border-l-4 border-gray-500 bg-gray-800 py-2 pl-4 italic text-gray-400">
          {children}
        </blockquote>
      ),
      // 处理代码 - writing 代码块内不应该有嵌套代码块，全部作为普通文本处理
      code: ({
        className,
        children,
        ...props
      }: {
        className?: string;
        children: React.ReactNode;
        inline?: boolean;
        node?: unknown;
      }) => {
        const isInline =
          !className ||
          (typeof children === "string" && !children.includes("\n"));

        // 行内代码 - 灰色背景
        if (isInline) {
          return (
            <code
              className="rounded bg-gray-700 px-1.5 py-0.5 font-mono text-xs text-gray-200"
              {...props}
            >
              {children}
            </code>
          );
        }

        // 代码块 - 在文章预览中不渲染为代码块样式，直接显示为普通段落
        // 这是兜底处理，防止大模型违规在 writing 内嵌套代码块
        return (
          <p className="my-2 text-gray-200 break-words whitespace-pre-wrap">
            {children}
          </p>
        );
      },
      // pre 标签直接渲染 children
      pre: ({ children }: { children: React.ReactNode }) => {
        return <>{children}</>;
      },
    }),
    [],
  );

  return (
    <div
      className={cn(
        "my-3 w-full rounded-md bg-gray-900 text-xs text-white/80",
        className,
      )}
    >
      {/* 工具栏 - 与 CodeBlock 的 CodeBar 完全一致 */}
      <div className="flex items-center justify-between rounded-tl-md rounded-tr-md bg-gray-700 px-4 py-2 font-sans text-xs text-gray-200">
        <div className="flex items-center gap-2">
          <FileText size={16} />
          <span>报告预览</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleCopy}
            className="ml-auto flex gap-2"
            title="复制文本"
          >
            {isCopied ? (
              <>
                <Check className="h-[18px] w-[18px]" />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-[18px] w-[18px]" />
                <span>复制</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleExportWord}
            disabled={isExporting}
            className="flex gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="导出为 Word 文档"
          >
            <Download className="h-[18px] w-[18px]" />
            <span>{isExporting ? "导出中..." : "导出 Word"}</span>
          </button>
        </div>
      </div>

      {/* 内容预览区域 - 与 CodeBlock 内容区域一致 */}
      <div
        className="overflow-y-auto p-4 text-sm leading-relaxed"
        ref={contentRef}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={components as Record<string, React.ElementType>}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
});

ReportPreview.displayName = "ReportPreview";

export default ReportPreview;