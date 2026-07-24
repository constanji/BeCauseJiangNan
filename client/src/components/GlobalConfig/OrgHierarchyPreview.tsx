import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '~/utils';

export type OrgPreviewRow = {
  rowIndex: number;
  fullRow: string;
  sheetName: string;
  rowKey?: string;
  aliases?: string[];
};

export type OrgTreeNode = {
  orgCode: string;
  orgName: string;
  parentOrgCode: string;
  orgLevelName: string;
  row: OrgPreviewRow;
  children: OrgTreeNode[];
};

function matchField(fullRow: string, key: string): string {
  const re = new RegExp(`(?:^|\\|\\s*)${key}:\\s*([^|]+)`, 'i');
  const m = String(fullRow || '').match(re);
  return m?.[1]?.trim() || '';
}

export function parseOrgFields(fullRow: string) {
  return {
    orgCode: matchField(fullRow, 'org_code'),
    orgName: matchField(fullRow, 'org_name'),
    parentOrgCode: matchField(fullRow, 'parent_org_code'),
    orgLevelName: matchField(fullRow, 'org_level_name'),
  };
}

export function buildOrgTree(rows: OrgPreviewRow[]): OrgTreeNode[] {
  const byCode = new Map<string, OrgTreeNode>();

  for (const row of rows) {
    const fields = parseOrgFields(row.fullRow);
    const orgCode = (row.rowKey || fields.orgCode || '').trim();
    if (!orgCode) continue;
    byCode.set(orgCode, {
      orgCode,
      orgName: fields.orgName || orgCode,
      parentOrgCode: fields.parentOrgCode,
      orgLevelName: fields.orgLevelName,
      row,
      children: [],
    });
  }

  const roots: OrgTreeNode[] = [];
  for (const node of byCode.values()) {
    const parent = node.parentOrgCode ? byCode.get(node.parentOrgCode) : undefined;
    if (parent && parent.orgCode !== node.orgCode) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: OrgTreeNode[]) => {
    nodes.sort((a, b) => a.orgCode.localeCompare(b.orgCode, 'zh-CN'));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function nodeMatches(
  node: OrgTreeNode,
  q: string,
  aliasFilter: 'all' | 'has' | 'none',
): boolean {
  const aliases = node.row.aliases || [];
  if (aliasFilter === 'has' && aliases.length === 0) return false;
  if (aliasFilter === 'none' && aliases.length > 0) return false;
  if (!q) return true;
  const hay = `${node.orgCode} ${node.orgName} ${node.orgLevelName} ${aliases.join(' ')}`.toLowerCase();
  return hay.includes(q);
}

/** 保留匹配节点及其祖先；子树中有匹配也保留该节点 */
export function filterOrgTree(
  roots: OrgTreeNode[],
  opts: { q?: string; aliasFilter?: 'all' | 'has' | 'none' },
): { tree: OrgTreeNode[]; expandKeys: Set<string> } {
  const q = String(opts.q || '')
    .trim()
    .toLowerCase();
  const aliasFilter = opts.aliasFilter || 'all';
  const expandKeys = new Set<string>();

  const walk = (nodes: OrgTreeNode[]): OrgTreeNode[] => {
    const out: OrgTreeNode[] = [];
    for (const node of nodes) {
      const filteredChildren = walk(node.children);
      const selfMatch = nodeMatches(node, q, aliasFilter);
      // 无搜索词时：别名过滤作用于自身；有子保留则仍展示父以保层级
      if (selfMatch || filteredChildren.length > 0) {
        if (filteredChildren.length > 0) {
          expandKeys.add(node.orgCode);
        }
        out.push({ ...node, children: filteredChildren });
      }
    }
    return out;
  };

  // 无筛选时不过滤
  if (!q && aliasFilter === 'all') {
    return { tree: roots, expandKeys };
  }

  return { tree: walk(roots), expandKeys };
}

function defaultExpandKeys(roots: OrgTreeNode[]): Set<string> {
  const keys = new Set<string>();
  for (const root of roots) {
    keys.add(root.orgCode);
    for (const child of root.children) {
      keys.add(child.orgCode);
    }
  }
  return keys;
}

type OrgHierarchyPreviewProps = {
  rows: OrgPreviewRow[];
  searchQuery: string;
  aliasFilter: 'all' | 'has' | 'none';
  onManageAlias: (row: OrgPreviewRow) => void;
};

function OrgTreeNodeView({
  node,
  depth,
  expanded,
  onToggle,
  onManageAlias,
  highlightQuery,
}: {
  node: OrgTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (code: string) => void;
  onManageAlias: (row: OrgPreviewRow) => void;
  highlightQuery: string;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.orgCode);
  const aliases = node.row.aliases || [];
  const q = highlightQuery.trim().toLowerCase();
  const selfHit =
    !!q &&
    `${node.orgCode} ${node.orgName} ${aliases.join(' ')}`.toLowerCase().includes(q);

  return (
    <li className="flex flex-col">
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors',
          'hover:bg-sky-500/15 hover:ring-1 hover:ring-inset hover:ring-sky-500/30',
          selfHit && 'bg-sky-500/10',
        )}
        style={{ paddingLeft: 4 + depth * 16 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.orgCode)}
            className="shrink-0 rounded p-0 text-text-secondary hover:text-text-primary"
            aria-label={isOpen ? '折叠' : '展开'}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block w-3.5 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-[13px] text-text-secondary group-hover:text-text-primary">
          {node.orgCode}
        </span>
        <span className="truncate text-[13px] text-text-primary">{node.orgName}</span>
        {node.orgLevelName ? (
          <span className="shrink-0 rounded bg-surface-secondary px-1.5 text-[11px] leading-5 text-text-tertiary group-hover:bg-surface-primary">
            {node.orgLevelName}
          </span>
        ) : null}
        {hasChildren ? (
          <span className="shrink-0 text-[11px] text-text-tertiary">{node.children.length}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-tertiary">
          {aliases.length > 0 ? aliases.join('、') : ''}
        </span>
        <button
          type="button"
          onClick={() => onManageAlias(node.row)}
          className="shrink-0 rounded px-1 py-0.5 text-[12px] text-sky-400 hover:bg-sky-500/20 hover:text-sky-300"
        >
          {aliases.length > 0 ? '别名' : '+别名'}
        </button>
      </div>
      {hasChildren && isOpen ? (
        <ul className="flex flex-col">
          {node.children.map((child) => (
            <OrgTreeNodeView
              key={child.orgCode}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onManageAlias={onManageAlias}
              highlightQuery={highlightQuery}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function OrgHierarchyPreview({
  rows,
  searchQuery,
  aliasFilter,
  onManageAlias,
}: OrgHierarchyPreviewProps) {
  const fullTree = useMemo(() => buildOrgTree(rows), [rows]);
  const { tree, expandKeys: filterExpandKeys } = useMemo(
    () => filterOrgTree(fullTree, { q: searchQuery, aliasFilter }),
    [fullTree, searchQuery, aliasFilter],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpandKeys(fullTree));

  // 数据重载时恢复默认展开（根 + 下一层）
  useEffect(() => {
    setExpanded(defaultExpandKeys(fullTree));
  }, [fullTree]);

  // 筛选时强制展开命中路径上的祖先
  useEffect(() => {
    if (filterExpandKeys.size === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const k of filterExpandKeys) next.add(k);
      return next;
    });
  }, [filterExpandKeys]);

  const onToggle = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">暂无数据</p>;
  }

  if (tree.length === 0) {
    return <p className="text-sm text-text-secondary">无匹配机构</p>;
  }

  return (
    <ul className="flex flex-col gap-px">
      {tree.map((node) => (
        <OrgTreeNodeView
          key={node.orgCode}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          onManageAlias={onManageAlias}
          highlightQuery={searchQuery}
        />
      ))}
    </ul>
  );
}
