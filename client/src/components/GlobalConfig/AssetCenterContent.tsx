import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TStartupConfig } from '@because/data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { cn } from '~/utils';
import KnowledgeBaseManagement from './KnowledgeBaseManagement';
import DataSourceManagement from './DataSourceManagement';
import PromptsManagement from './PromptsManagement';
import ProjectsManagement from './ProjectsManagement';
import DatContentDatasourceManagement from './DatContentDatasourceManagement';
import OrgPermissionManagement from './OrgPermissionManagement';

type TabType =
  | 'dataSources'
  | 'knowledgeBase'
  | 'prompts'
  | 'datProjects'
  | 'datDatasources'
  | 'orgPermission';

const isValidTab = (tab: string | null): tab is TabType => {
  return (
    tab === 'dataSources' ||
    tab === 'knowledgeBase' ||
    tab === 'prompts' ||
    tab === 'datProjects' ||
    tab === 'datDatasources' ||
    tab === 'orgPermission'
  );
};

export default function AssetCenterContent() {
  const { data: startupConfig } = useGetStartupConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: TabType = isValidTab(tabParam) ? tabParam : 'dataSources';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // 当 URL 参数变化时，更新活动标签页
  useEffect(() => {
    if (isValidTab(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // 处理标签页切换，同时更新 URL 参数
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const tabs: { id: TabType; label: string; description: string }[] = [
    {
      id: 'dataSources',
      label: '数据源管理',
      description: '管理数据库连接配置，支持 MySQL 和 PostgreSQL',
    },
    {
      id: 'knowledgeBase',
      label: '知识库管理',
      description: '管理向量数据库中的语义模型、QA对、同义词和业务知识',
    },
    {
      id: 'prompts',
      label: '提示集管理',
      description: '管理初始对话界面中显示的提示集',
    },
    {
      id: 'datProjects',
      label: 'DAT 项目管理',
      description: '管理 DAT 项目配置，包括 LLM、Agent、嵌入模型、内容管理等',
    },
    {
      id: 'datDatasources',
      label: 'DAT 数据源管理',
      description: '管理 DAT/MCP content-store 数据源，并绑定到智能体',
    },
    {
      id: 'orgPermission',
      label: '机构权限管理',
      description: '维护平台机构树与权限拦截开关（brchLv / dataScope）',
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标签页导航 */}
      <div className="border-b border-border-light bg-surface-secondary">
        <div className="flex gap-1 px-4 pt-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                'relative px-4 py-2 text-sm font-medium transition-colors',
                'border-b-2 border-transparent',
                activeTab === tab.id
                  ? 'border-primary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:border-border-subtle',
              )}
              aria-label={tab.label}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 标签页内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'dataSources' && (
          <div className="h-full overflow-hidden px-4 py-4">
            <DataSourceManagement />
          </div>
        )}
        {activeTab === 'knowledgeBase' && (
          <div className="h-full overflow-hidden px-4 py-4">
            <KnowledgeBaseManagement />
          </div>
        )}
        {activeTab === 'prompts' && (
          <div className="h-full overflow-hidden px-4 py-4">
            <PromptsManagement startupConfig={startupConfig} />
          </div>
        )}
        {activeTab === 'datProjects' && (
          <div className="h-full overflow-hidden px-4 py-4">
            <ProjectsManagement />
          </div>
        )}
        {activeTab === 'datDatasources' && (
          <div className="h-full overflow-hidden px-4 py-4">
            <DatContentDatasourceManagement />
          </div>
        )}
        {activeTab === 'orgPermission' && (
          <div className="h-full overflow-hidden px-4 py-4">
            <OrgPermissionManagement />
          </div>
        )}
      </div>
    </div>
  );
}
