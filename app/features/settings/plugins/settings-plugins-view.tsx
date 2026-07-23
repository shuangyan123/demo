"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { ApiConnectionProfile, AppearanceSettings, ImportJob, KnowledgeImportDraft, KnowledgeEntry, Mistake, PersonalizationSettings } from "../../../types/review";
import { AppIcon } from "../../shared/app-icon";
import { Button, Chip, EmptyState } from "../../shared/ui-primitives";
import { settingsPluginDefinitions, type SettingsPluginDefinition, type SettingsPluginId, type SettingsPluginRuntimeContext } from "./settings-plugin-registry";
import styles from "./settings-plugins-view.module.css";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const ObsidianPluginPanel = dynamic(() => import("./obsidian/obsidian-plugin-panel").then((module) => module.ObsidianPluginPanel), {
  loading: () => <EmptyState>正在加载 Obsidian Vault…</EmptyState>,
});
const ImportWorkspace = dynamic(() => import("../../import/import-workspace").then((module) => module.ImportWorkspace), {
  loading: () => <EmptyState>正在加载粉笔导入…</EmptyState>,
});
const DeclarativeExtensionMarketplace = dynamic(() => import("./declarative-extension-marketplace").then((module) => module.DeclarativeExtensionMarketplace), {
  loading: () => <EmptyState>正在加载声明式扩展市场…</EmptyState>,
});

type SettingsPluginsViewProps = {
  appearanceSettings: AppearanceSettings;
  entries: KnowledgeEntry[];
  initialPluginId?: SettingsPluginId;
  importJobs: ImportJob[];
  knowledgeDrafts: KnowledgeImportDraft[];
  mistakes: Mistake[];
  personalization: PersonalizationSettings;
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  today: Date;
  onChanged: () => Promise<void>;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onConfirmKnowledgeDrafts: () => void;
  onDeleteKnowledgeDraft: (id: string) => void;
  onImportKnowledgeText: (event: SubmitReactEvent) => void;
  onNotice: (message: string) => void;
  onOpenConnections: () => void;
  onPersonalizationChange: (settings: PersonalizationSettings) => void;
  onRefreshWorkspace: () => Promise<void>;
  onUpdateKnowledgeDraft: (id: string, patch: Partial<KnowledgeImportDraft>) => void;
  onUpdateKnowledgeDraftList: (id: string, value: string) => void;
};

function matchesPlugin(plugin: SettingsPluginDefinition, query: string) {
  if (!query) return true;
  return [plugin.label, plugin.shortDescription, plugin.description, plugin.providerLabel, ...plugin.capabilities]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(query);
}

function PluginGlyph({ plugin }: { plugin: SettingsPluginDefinition }) {
  return (
    <span className={styles.glyph} style={{ backgroundColor: plugin.icon.background }} aria-hidden="true">
      {plugin.icon.assetPath ? <span style={{ backgroundImage: `url(${plugin.icon.assetPath})` }} /> : plugin.icon.label}
    </span>
  );
}

/** 设置插件页只读取静态注册表；详情面板在用户选择后才动态加载。 */
export function SettingsPluginsView(props: SettingsPluginsViewProps) {
  const [query, setQuery] = useState("");
  const [activePluginId, setActivePluginId] = useState<SettingsPluginId | undefined>(props.initialPluginId);
  const detailRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const context: SettingsPluginRuntimeContext = {
    entryCount: props.entries.length,
    importJobCount: props.importJobs.length,
    knowledgeDraftCount: props.knowledgeDrafts.length,
    mistakeCount: props.mistakes.length,
    hasTextConnection: Boolean(props.textConnection),
    hasVisionConnection: Boolean(props.visionConnection),
  };
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  const plugins = useMemo(() => settingsPluginDefinitions.filter((plugin) => matchesPlugin(plugin, keyword)), [keyword]);
  const activePlugin = settingsPluginDefinitions.find((plugin) => plugin.id === activePluginId);

  useEffect(() => {
    if (!activePlugin) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => detailRef.current?.focus(), 0);
    return () => restoreFocusRef.current?.focus();
  }, [activePlugin]);

  function openPlugin(plugin: SettingsPluginDefinition) {
    setActivePluginId(plugin.id);
  }

  function renderPanel(plugin: SettingsPluginDefinition) {
    if (plugin.detailPanelLoader === "declarative-marketplace") {
      return (
        <DeclarativeExtensionMarketplace
          appearanceSettings={props.appearanceSettings}
          personalization={props.personalization}
          onAppearanceChange={props.onAppearanceChange}
          onChanged={props.onChanged}
          onPersonalizationChange={props.onPersonalizationChange}
          onNotice={props.onNotice}
        />
      );
    }
    if (plugin.detailPanelLoader === "fenbi-import") {
      return (
        <ImportWorkspace
          textConnection={props.textConnection}
          visionConnection={props.visionConnection}
          importJobs={props.importJobs}
          knowledgeDrafts={props.knowledgeDrafts}
          mistakes={props.mistakes}
          today={props.today}
          onConfirmKnowledgeDrafts={props.onConfirmKnowledgeDrafts}
          onDeleteKnowledgeDraft={props.onDeleteKnowledgeDraft}
          onImportKnowledgeText={props.onImportKnowledgeText}
          onRefreshWorkspace={props.onRefreshWorkspace}
          onSwitchSettings={props.onOpenConnections}
          onUpdateKnowledgeDraft={props.onUpdateKnowledgeDraft}
          onUpdateKnowledgeDraftList={props.onUpdateKnowledgeDraftList}
          setNotice={props.onNotice}
        />
      );
    }
    return (
      <ObsidianPluginPanel
        entries={props.entries}
        personalization={props.personalization}
        textConnection={props.textConnection}
        onChanged={props.onChanged}
        onNotice={props.onNotice}
      />
    );
  }

  return (
    <section className={styles.workspace} aria-label="插件管理">
      <header className={styles.header}>
        <div><h1>插件管理</h1><p>只展示应用已登记的本地扩展；MCP 仍在设置中单独管理。</p></div>
        <Button variant="outline" onClick={() => void props.onRefreshWorkspace()}><AppIcon name="refresh" size={16} />刷新状态</Button>
      </header>

      <div className={styles.toolbar}>
        <label><AppIcon name="search" size={16} /><input aria-label="搜索插件" placeholder="搜索名称、能力或来源" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
        <span>{plugins.length} 个已登记扩展</span>
      </div>

      <div className={styles.layout}>
        <div className={styles.list} role="list">
          {plugins.map((plugin) => {
            const badge = plugin.statusBadgeProvider?.(context) ?? plugin.statusBadge;
            const health = plugin.healthSummaryProvider?.(context) ?? plugin.description;
            return (
              <button
                key={plugin.id}
                className={activePlugin?.id === plugin.id ? styles.activeRow : styles.row}
                type="button"
                onClick={() => openPlugin(plugin)}
              >
                <PluginGlyph plugin={plugin} />
                <span className={styles.rowBody}><strong>{plugin.label}</strong><small>{plugin.shortDescription}</small><em>{health}</em></span>
                <Chip tone={badge.tone}>{badge.label}</Chip>
                <AppIcon name="chevronRight" size={16} />
              </button>
            );
          })}
          {!plugins.length ? <EmptyState>没有匹配的已登记扩展。</EmptyState> : null}
        </div>

        {activePlugin ? (
          <div className={styles.detailBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActivePluginId(undefined); }}>
            <aside
              ref={detailRef}
              className={styles.detail}
              tabIndex={-1}
              aria-label={`${activePlugin.label} 详情`}
              onKeyDown={(event) => { if (event.key === "Escape") setActivePluginId(undefined); }}
            >
              <header className={styles.detailHeader}>
                <PluginGlyph plugin={activePlugin} />
                <div><h2>{activePlugin.label}</h2><p>{activePlugin.providerLabel}</p></div>
                <button aria-label="关闭插件详情" type="button" onClick={() => setActivePluginId(undefined)}><AppIcon name="close" size={18} /></button>
              </header>
              <div className={styles.auditGrid}>
                <div><span>状态</span><strong>{(activePlugin.statusBadgeProvider?.(context) ?? activePlugin.statusBadge).label}</strong></div>
                <div><span>权限</span><strong>{activePlugin.capabilities.join("、")}</strong></div>
                <div><span>签名摘要</span><strong>{activePlugin.id === "declarative-marketplace" ? "安装时校验 SHA-256 与签名" : "应用内固定登记"}</strong></div>
                <div><span>本地数据边界</span><strong>{activePlugin.privacyNote}</strong></div>
              </div>
              {activePlugin.recommendedActionProvider?.(context) ? (
                <div className={styles.recovery}><strong>下一步</strong><span>{activePlugin.recommendedActionProvider(context)}</span></div>
              ) : null}
              <div className={styles.panel}>{renderPanel(activePlugin)}</div>
            </aside>
          </div>
        ) : (
          <aside className={styles.placeholder}><AppIcon name="plugins" size={22} /><strong>选择一个扩展</strong><span>查看来源、权限、签名摘要和本地数据边界。</span></aside>
        )}
      </div>
    </section>
  );
}
