"use client";

import type { ApiConnectionProfile, KnowledgeEntry, PersonalizationSettings } from "../../../../types/review";
import { ObsidianKnowledgePanel } from "../../../knowledge/obsidian-knowledge-panel";
import { useObsidianKnowledgeBridge } from "../../../knowledge/use-obsidian-knowledge-bridge";

type ObsidianPluginPanelProps = {
  entries: KnowledgeEntry[];
  personalization: PersonalizationSettings;
  textConnection?: ApiConnectionProfile;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
};

/** 设置插件中的 Obsidian 面板复用知识库桥接 hook，仍不让 React 持有目录句柄。 */
export function ObsidianPluginPanel({ entries, personalization, textConnection, onChanged, onNotice }: ObsidianPluginPanelProps) {
  const controller = useObsidianKnowledgeBridge({ entries, personalization, textConnection, onChanged, onNotice });
  return <ObsidianKnowledgePanel controller={controller} />;
}
