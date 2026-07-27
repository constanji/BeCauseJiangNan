import { ChevronLeft } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useToastContext } from '@because/client';
import {
  useGetAgentByIdQuery,
  useRevertAgentVersionMutation,
  useUpdateAgentVersionNoteMutation,
} from '~/data-provider';
import type { AgentWithVersions, VersionContext } from './types';
import { isActiveVersion } from './isActiveVersion';
import { buildVersionChangeMap, sortVersionsAscending } from './getVersionChanges';
import { useAgentPanelContext } from '~/Providers';
import VersionContent from './VersionContent';
import { useLocalize } from '~/hooks';
import { Panel } from '~/common';

export default function VersionPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { agent_id, setActivePanel } = useAgentPanelContext();

  const selectedAgentId = agent_id ?? '';

  const { data: agent, isLoading, error, refetch } = useGetAgentByIdQuery(selectedAgentId);

  const revertAgentVersion = useRevertAgentVersionMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_agent_version_restore_success'),
        status: 'success',
      });
      refetch();
    },
    onError: () => {
      showToast({
        message: localize('com_ui_agent_version_restore_error'),
        status: 'error',
      });
    },
  });

  const updateVersionNote = useUpdateAgentVersionNoteMutation({
    onSuccess: () => {
      showToast({ message: '备注已保存', status: 'success' });
      refetch();
    },
    onError: (err: Error) => {
      showToast({
        message: err?.message || '保存备注失败',
        status: 'error',
      });
    },
  });

  const agentWithVersions = agent as AgentWithVersions;

  const currentAgent = useMemo(() => {
    if (!agentWithVersions) return null;
    return {
      name: agentWithVersions.name,
      description: agentWithVersions.description,
      instructions: agentWithVersions.instructions,
      artifacts: agentWithVersions.artifacts,
      capabilities: agentWithVersions.capabilities,
      tools: agentWithVersions.tools,
    };
  }, [agentWithVersions]);

  const versions = useMemo(() => {
    const versionsCopy = [...(agentWithVersions?.versions || [])];
    return versionsCopy.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [agentWithVersions?.versions]);

  const changeMap = useMemo(() => {
    const ascending = sortVersionsAscending(agentWithVersions?.versions || []);
    return buildVersionChangeMap(ascending);
  }, [agentWithVersions?.versions]);

  const activeVersion = useMemo(() => {
    return versions.length > 0
      ? versions.find((v) => isActiveVersion(v, currentAgent, versions)) || null
      : null;
  }, [versions, currentAgent]);

  const versionIds = useMemo(() => {
    if (versions.length === 0) return [];

    const matchingVersions = versions.filter((v) => isActiveVersion(v, currentAgent, versions));

    const activeVersionId =
      matchingVersions.length > 0 ? versions.findIndex((v) => v === matchingVersions[0]) : -1;

    return versions.map((version, displayIndex) => {
      const originalIndex =
        agentWithVersions?.versions?.findIndex(
          (v) =>
            v.updatedAt === version.updatedAt &&
            v.createdAt === version.createdAt &&
            v.name === version.name,
        ) ?? displayIndex;

      return {
        id: displayIndex,
        originalIndex,
        version,
        isActive: displayIndex === activeVersionId,
      };
    });
  }, [versions, currentAgent, agentWithVersions?.versions]);

  const versionContext: VersionContext = useMemo(
    () => ({
      versions,
      versionIds,
      currentAgent,
      selectedAgentId,
      activeVersion,
    }),
    [versions, versionIds, currentAgent, selectedAgentId, activeVersion],
  );

  const handleRestore = useCallback(
    (displayIndex: number) => {
      const versionWithId = versionIds.find((v) => v.id === displayIndex);

      if (versionWithId) {
        const originalIndex = versionWithId.originalIndex;

        revertAgentVersion.mutate({
          agent_id: selectedAgentId,
          version_index: originalIndex,
        });
      }
    },
    [revertAgentVersion, selectedAgentId, versionIds],
  );

  const handleSaveNote = useCallback(
    async (originalIndex: number, note: string) => {
      await updateVersionNote.mutateAsync({
        agent_id: selectedAgentId,
        version_index: originalIndex,
        versionNote: note,
      });
    },
    [selectedAgentId, updateVersionNote],
  );

  return (
    <div className="scrollbar-gutter-stable h-full min-h-[40vh] overflow-auto pb-12 text-sm text-text-primary dark:text-text-primary">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-3">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            className="btn btn-neutral border-token-border-light relative inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium"
            onClick={() => setActivePanel(Panel.builder)}
            aria-label={localize('com_ui_back_to_builder')}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            返回编辑
          </button>
          <div>
            <h2 className="text-token-text-primary dark:text-text-primary text-lg font-semibold">
              {localize('com_ui_agent_version_history')}
            </h2>
            <p className="text-xs text-text-secondary">按时间查看变更、备注，并恢复历史版本</p>
          </div>
        </div>

        <VersionContent
          selectedAgentId={selectedAgentId}
          isLoading={isLoading}
          error={error}
          versionContext={versionContext}
          changeMap={changeMap}
          onRestore={handleRestore}
          onSaveNote={handleSaveNote}
        />
      </div>
    </div>
  );
}
