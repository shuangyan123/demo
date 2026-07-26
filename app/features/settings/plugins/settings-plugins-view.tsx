"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { ApiConnectionProfile } from "../../../types/domains/ai-connection.ts";
import type { AppearanceSettings } from "../../../types/domains/appearance.ts";
import type { ImportJob } from "../../../types/domains/import.ts";
import type { KnowledgeImportDraft, KnowledgeEntry } from "../../../types/domains/knowledge.ts";
import type { Mistake } from "../../../types/domains/review.ts";
import type { PersonalizationSettings } from "../../../types/domains/personalization.ts";
import { AppIcon } from "../../shared/app-icon";
import { DevelopmentExampleSwitcher, useDevelopmentExample, type DevelopmentExampleOption } from "../../shared/development-example-switcher";
import { Button, Chip, EmptyState } from "../../shared/ui-primitives";
import { settingsPluginDefinitions, type SettingsPluginDefinition, type SettingsPluginId, type SettingsPluginRuntimeContext } from "./settings-plugin-registry.ts";
import styles from "./settings-plugins-view.module.css";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
const fenbiExampleOptions: DevelopmentExampleOption[] = [
  { id: "fenbi-configured", label: "已配置账户" },
  { id: "fenbi-syncing", label: "同步进度" },
  { id: "fenbi-error", label: "错误恢复" },
  { id: "draft-review", label: "待确认草稿" },
];

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
  developmentExample?: string;
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
  const example = useDevelopmentExample(props.developmentExample, fenbiExampleOptions);
  const [query, setQuery] = useState("");
  const [activePluginId, setActivePluginId] = useState<SettingsPluginId | undefined>(() => example.value ? "fenbi-import" : props.initialPluginId);
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
      if (example.value) return <FenbiDevelopmentExample scenario={example.value} />;
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
      {example.enabled ? (
        <DevelopmentExampleSwitcher
          options={fenbiExampleOptions}
          value={example.value}
          onChange={(value) => {
            example.select(value);
            if (value) setActivePluginId("fenbi-import");
          }}
        />
      ) : null}

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

/** 粉笔详情的纯内存示例覆盖账户、同步、错误与草稿确认状态。 */
function FenbiDevelopmentExample({ scenario }: { scenario: string }) {
  const syncing = scenario === "fenbi-syncing";
  const failed = scenario === "fenbi-error";
  const drafts = scenario === "draft-review";
  return (
    <section className="grid min-w-0 gap-4" aria-label="粉笔导入开发示例">
      <header className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-semibold">导入资料</h1><p className="mt-1 text-xs text-muted">示例数据只展示输入后的组件状态，不会写入题库或知识库。</p></div><Chip tone={failed ? "red" : syncing ? "yellow" : "green"}>{failed ? "同步失败" : syncing ? "同步中 46%" : drafts ? "3 条待确认" : "账户已配置"}</Chip></header>
      <div className="grid min-w-0 gap-4 @container">
        <section className="ui-card grid min-w-0 gap-3 p-4">
          <div className="flex items-center justify-between gap-3"><div><strong>粉笔账户</strong><p className="text-xs text-muted">Cookie 仅在本机加密保存</p></div><span className="text-xs text-muted">已配置 · 账号尾号 0824</span></div>
          {syncing ? <div><div className="mb-1 flex justify-between text-xs"><span>正在同步错题</span><span>46 / 100</span></div><progress className="w-full" max={100} value={46} /></div> : null}
          {failed ? <div className="rounded-lg bg-surface-muted p-3 text-sm"><strong className="text-red">页面结构发生变化</strong><p className="mt-1 text-muted">请改用 PDF/Word 导入，原凭据和既有草稿未被覆盖。</p><Button className="mt-3" size="sm" variant="outline">选择文件</Button></div> : null}
          {!syncing && !failed ? <Button variant="primary"><AppIcon name="refresh" size={16} />同步错题</Button> : null}
        </section>
        <section className="ui-card min-w-0 overflow-hidden">
          <header className="border-b border-line p-4"><h2 className="font-semibold">知识资料草稿</h2><p className="text-xs text-muted">确认前可以编辑、删除或调整分类。</p></header>
          {drafts ? <div className="divide-y divide-line">{["判断推理：加强论证", "资料分析：增长率", "申论：基层治理"].map((title, index) => <article className="grid gap-2 p-4" key={title}><div className="flex justify-between gap-3"><strong>{title}</strong><span className="text-xs text-muted">草稿 {index + 1}</span></div><textarea aria-label={`${title} 示例内容`} className="ui-input min-h-20" defaultValue="这是用于界面批注的脱敏示例摘要，可在确认前编辑。" /></article>)}</div> : <EmptyState>{syncing ? "同步完成后草稿会显示在这里。" : "账户已就绪，尚无待确认草稿。"}</EmptyState>}
        </section>
      </div>
    </section>
  );
}
