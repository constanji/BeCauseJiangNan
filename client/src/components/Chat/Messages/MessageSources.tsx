import React, { useState, useEffect, useCallback } from 'react';
import { Sources } from '@ant-design/x';
import { LocalStorageKeys } from '@because/data-provider';
import type { TMessage } from '@because/data-provider';
import useLocalStorage from '~/hooks/useLocalStorage';
import DatabaseSchemaDialog from '~/components/Nav/DatabaseSchemaDialog';
import { useAuthContext } from '~/hooks';

interface DatDatasource {
  _id: string;
  projectId: string;
  name: string;
  description?: string;
  provider: string;
  configuration: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    [key: string]: any;
  };
  enabled: boolean;
}

interface MessageSourcesProps {
  message: TMessage;
  isLast?: boolean;
}

export default function MessageSources({ message, isLast = false }: MessageSourcesProps) {
  const { token } = useAuthContext();
  const [tables, setTables] = useState<string[]>([]);
  const [datasources, setDatasources] = useState<DatDatasource[]>([]);

  const [selectedDataSourceId] = useLocalStorage<string | null>(
    LocalStorageKeys.LAST_DATA_SOURCE_ID,
    null
  );

  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [viewingDatasource, setViewingDatasource] = useState<DatDatasource | null>(null);
  const [activeTable, setActiveTable] = useState<string>('');

  useEffect(() => {
    let textToParse = '';

    if (message && message.content && Array.isArray(message.content)) {
      message.content.forEach((part: any) => {
        if (part && (part.type === 'tool_call' || part.tool_call)) {
          const toolCall = part.tool_call || part;
          const func = toolCall.function || toolCall;
          let output = func.output || toolCall.output;
          if (output && typeof output === 'string') {
            if (output.includes('\\n') || output.includes('\\"')) {
              output = output
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            }
            textToParse += '\n' + output;
          }
        }
      });
    }

    // Parse the --------------------- source --------------------- block
    const match = textToParse.match(/-{5,}\s*source\s*-{5,}\n([\s\S]*?)(?:\n-{5,}|$)/i);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.tables && Array.isArray(parsed.tables)) {
          setTables(parsed.tables);
        }
      } catch (e) {
        // ignore JSON parse error
      }
    } else {
      setTables([]);
    }
  }, [message]);

  const getApiBase = useCallback(() => {
    const baseEl = document.querySelector('base');
    const baseHref = baseEl?.getAttribute('href') || '/';
    return baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
  }, []);

  const getHeaders = useCallback((): HeadersInit => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  useEffect(() => {
    if (tables.length === 0 || !selectedDataSourceId) return;

    let isMounted = true;
    const fetchDatasources = async () => {
      try {
        const response = await fetch(`${getApiBase()}/api/dat-datasources`, {
          method: 'GET',
          headers: getHeaders(),
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to fetch datasources');
        }

        const data = await response.json();
        if (isMounted) {
          // If the datasources are fetched, set them
          setDatasources(data.datasources || []);
        }
      } catch (error) {
        console.error('Error fetching datasources in MessageSources:', error);
      }
    };

    fetchDatasources();

    return () => {
      isMounted = false;
    };
  }, [tables.length, selectedDataSourceId, getApiBase, getHeaders]);

  if (tables.length === 0) {
    return null;
  }

  const handleSourceClick = (table: string) => {
    if (!selectedDataSourceId) return;
    const ds = datasources.find(d => d._id === selectedDataSourceId);
    if (ds) {
      setViewingDatasource(ds);
      setActiveTable(table);
      // Wait for states to update, then open dialog
      setTimeout(() => setSchemaDialogOpen(true), 0);
    }
  };

  const items = tables.map(table => ({
    title: (
      <span
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleSourceClick(table);
        }}
        className="cursor-pointer hover:underline text-text-secondary"
      >
        {table}
      </span>
    ),
    url: '#',
  }));

  return (
    <>
      <style>{`
        .message-sources-wrapper * {
          color: var(--text-primary) !important;
        }
        .message-sources-wrapper .ant-collapse {
          background: transparent !important;
          border: none !important;
        }
        .message-sources-wrapper .ant-collapse-header {
          padding: 0 !important;
          align-items: center !important;
        }
        .message-sources-wrapper .ant-collapse-content-box {
          padding-top: 4px !important;
          padding-bottom: 4px !important;
        }
        .message-sources-wrapper .ant-sources-title-wrapper {
          margin-bottom: 0 !important;
        }
      `}</style>
      <div 
        className={`ml-2 flex items-center message-sources-wrapper transition-opacity duration-200 ${
          !isLast ? 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100' : ''
        }`}
      >
        <Sources
          items={items}
          title={`使用 ${tables.length} 个数据源`}
          defaultExpanded={false}
        />
      </div>
      <DatabaseSchemaDialog
        isOpen={schemaDialogOpen}
        onOpenChange={setSchemaDialogOpen}
        datasource={viewingDatasource}
        initialSearchQuery={activeTable}
      />
    </>
  );
}
