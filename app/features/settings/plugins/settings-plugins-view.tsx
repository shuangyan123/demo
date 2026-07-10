"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import type { ApiConnectionProfile, ImportJob, KnowledgeImportDraft, KnowledgeEntry, Mistake, PersonalizationSettings } from "../../../types/review";
import { Button, Chip, EmptyState, IconButton, cx } from "../../shared/ui-primitives";
import {
  settingsPluginDefinitions,
  type SettingsPluginCategory,
  type SettingsPluginDefinition,
  type SettingsPluginId,
  type SettingsPluginRuntimeContext,
  type SettingsPluginSurface,
} from "./settings-plugin-registry";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const AiQuotaSettingsPanel = dynamic(() => import("./quota/ai-quota-settings-panel").then((module) => module.AiQuotaSettingsPanel), {
  loading: () => <EmptyState>正在加载额度插件...</EmptyState>,
});

const ObsidianPluginPanel = dynamic(() => import("./obsidian/obsidian-plugin-panel").then((module) => module.ObsidianPluginPanel), {
  loading: () => <EmptyState>正在加载 Obsidian 插件...</EmptyState>,
});

const ImportWorkspace = dynamic(() => import("../../import/import-workspace").then((module) => module.ImportWorkspace), {
  loading: () => <EmptyState>正在加载粉笔导入插件...</EmptyState>,
});

type SettingsPluginsViewProps = {
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
  onConfirmKnowledgeDrafts: () => void;
  onDeleteKnowledgeDraft: (id: string) => void;
  onImportKnowledgeText: (event: SubmitReactEvent) => void;
  onNotice: (message: string) => void;
  onOpenConnections: () => void;
  onRefreshWorkspace: () => Promise<void>;
  onUpdateKnowledgeDraft: (id: string, patch: Partial<KnowledgeImportDraft>) => void;
  onUpdateKnowledgeDraftList: (id: string, value: string) => void;
};

type DirectorySection = {
  key: SettingsPluginCategory;
  label: string;
};

const directorySections: DirectorySection[] = [
  { key: "featured", label: "Featured" },
  { key: "knowledge-sync", label: "知识同步" },
  { key: "import-source", label: "导入源" },
  { key: "quota", label: "额度" },
  { key: "study-extension", label: "专项学习" },
];

const surfaceTabs: Array<{ key: SettingsPluginSurface; label: string }> = [
  { key: "plugin", label: "插件" },
  { key: "skill", label: "技能" },
];

function pluginMatchesSearch(plugin: SettingsPluginDefinition, keyword: string) {
  if (!keyword) return true;
  const haystack = [
    plugin.label,
    plugin.shortDescription,
    plugin.description,
    plugin.providerLabel,
    plugin.category,
    plugin.capabilities.join(" "),
  ].join(" ").toLowerCase();
  return haystack.includes(keyword);
}

function categoryPlugins(section: DirectorySection, plugins: SettingsPluginDefinition[], searchKeyword: string) {
  if (section.key === "featured") {
    return searchKeyword ? [] : plugins.filter((plugin) => plugin.featured);
  }
  return plugins.filter((plugin) => plugin.category === section.key);
}

function PluginGlyph({ plugin, size = "md" }: { plugin: SettingsPluginDefinition; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-12 w-12 rounded-xl text-sm" : size === "sm" ? "h-9 w-9 rounded-lg text-xs" : "h-10 w-10 rounded-xl text-xs";
  return (
    <span
      aria-hidden="true"
      className={cx("grid shrink-0 place-items-center font-bold text-white shadow-sm", sizeClass)}
      style={{ backgroundColor: plugin.icon.background }}
    >
      {plugin.icon.assetPath ? (
        <span
          className="h-3/5 w-3/5 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${plugin.icon.assetPath})` }}
        />
      ) : plugin.icon.label}
    </span>
  );
}

function VectorIcon({ name }: { name: "search" | "refresh" | "settings" | "plus" | "more" | "close" | "filter" }) {
  const common = { className: "h-4 w-4", fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  if (name === "search") {
    return <svg viewBox="0 0 24 24" {...common}><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>;
  }
  if (name === "refresh") {
    return <svg viewBox="0 0 24 24" {...common}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M19 12a7 7 0 0 0-12-5l-3 3" /><path d="M5 12a7 7 0 0 0 12 5l3-3" /></svg>;
  }
  if (name === "settings") {
    return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="m4.9 4.9 2.1 2.1" /><path d="m17 17 2.1 2.1" /><path d="M2 12h3" /><path d="M19 12h3" /><path d="m4.9 19.1 2.1-2.1" /><path d="m17 7 2.1-2.1" /></svg>;
  }
  if (name === "plus") {
    return <svg viewBox="0 0 24 24" {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
  }
  if (name === "close") {
    return <svg viewBox="0 0 24 24" {...common}><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>;
  }
  if (name === "filter") {
    return <svg viewBox="0 0 24 24" {...common}><path d="M4 7h16" /><path d="M7 12h10" /><path d="M10 17h4" /></svg>;
  }
  return <svg viewBox="0 0 24 24" {...common}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
}

function PluginMenu({ plugin, onNotice }: { plugin: SettingsPluginDefinition; onNotice: (message: string) => void }) {
  return (
    <details className="relative">
      <summary
        aria-label={`${plugin.label} 更多操作`}
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-muted transition hover:bg-surface-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <VectorIcon name="more" />
      </summary>
      <div className="absolute right-0 top-9 z-20 w-40 rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
        {plugin.menuActions.map((action) => action.href ? (
          <a key={action.kind} className="block rounded-md px-3 py-2 hover:bg-surface-muted" href={action.href} rel="noreferrer" target={action.href.startsWith("http") ? "_blank" : undefined}>
            {action.label}
          </a>
        ) : (
          <button
            key={action.kind}
            className="block w-full rounded-md px-3 py-2 text-left hover:bg-surface-muted"
            type="button"
            onClick={() => onNotice(action.kind === "privacy" ? plugin.privacyNote : `${plugin.label} ${action.label} 已在详情中提供`)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function PluginListItem({
  context,
  plugin,
  onOpen,
  onNotice,
}: {
  context: SettingsPluginRuntimeContext;
  plugin: SettingsPluginDefinition;
  onOpen: (plugin: SettingsPluginDefinition) => void;
  onNotice: (message: string) => void;
}) {
  const runtimeStatus = plugin.statusProvider?.(context) ?? "ready";
  const badge = plugin.statusBadgeProvider?.(context) ?? plugin.statusBadge;
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line/70 py-4 last:border-b-0 max-sm:grid-cols-[minmax(0,1fr)_auto]">
      <button className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 text-left" type="button" onClick={() => onOpen(plugin)}>
        <PluginGlyph plugin={plugin} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-sm">{plugin.label}</strong>
            <Chip tone={badge.tone}>{badge.label}</Chip>
          </span>
          <span className="mt-1 block truncate text-sm text-muted">{plugin.shortDescription}</span>
        </span>
      </button>
      <Button className="min-w-[5.25rem]" size="sm" variant={runtimeStatus === "ready" ? "outline" : "soft"} onClick={() => onOpen(plugin)}>
        {plugin.primaryAction.label}
      </Button>
      <div className="max-sm:hidden">
        <PluginMenu plugin={plugin} onNotice={onNotice} />
      </div>
    </article>
  );
}

function InstalledPluginStrip({
  context,
  plugins,
  onOpen,
}: {
  context: SettingsPluginRuntimeContext;
  plugins: SettingsPluginDefinition[];
  onOpen: (plugin: SettingsPluginDefinition) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {plugins.map((plugin) => {
        const runtimeStatus = plugin.statusProvider?.(context) ?? "ready";
        return (
          <button
            key={plugin.id}
            aria-label={plugin.label}
            className={cx(
              "relative rounded-xl p-1 transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2",
              runtimeStatus !== "ready" && "after:absolute after:right-1 after:top-1 after:h-2.5 after:w-2.5 after:rounded-full after:bg-yellow"
            )}
            title={plugin.label}
            type="button"
            onClick={() => onOpen(plugin)}
          >
            <PluginGlyph plugin={plugin} size="lg" />
          </button>
        );
      })}
    </div>
  );
}

function PluginInlineDetail({
  children,
  context,
  onClose,
  plugin,
}: {
  children: ReactNode;
  context: SettingsPluginRuntimeContext;
  onClose: () => void;
  plugin: SettingsPluginDefinition;
}) {
  const badge = plugin.statusBadgeProvider?.(context) ?? plugin.statusBadge;
  const recentActivity = plugin.recentActivityProvider?.(context);
  return (
    <section className="plugin-detail-inline mt-8 overflow-hidden" aria-label={`${plugin.label} 插件详情`}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
            <PluginGlyph plugin={plugin} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-base font-semibold">{plugin.label}</h2>
                <Chip tone={badge.tone}>{badge.label}</Chip>
              </div>
              <p className="mt-1 truncate text-sm text-muted">{plugin.providerLabel}</p>
            </div>
          </div>
          <IconButton aria-label="关闭插件详情" onClick={onClose}>
            <VectorIcon name="close" />
          </IconButton>
        </header>
        <div className="grid grid-cols-3 gap-2 border-b border-line px-5 py-3 text-xs text-muted max-sm:grid-cols-1">
          <span className="truncate">状态：{badge.label}</span>
          <span className="truncate">来源：{plugin.providerLabel}</span>
          <span className="truncate">活动：{recentActivity ?? "暂无"}</span>
        </div>
        <div className="p-5">
          {children}
        </div>
    </section>
  );
}

/** 设置插件目录只渲染轻量注册表数据，重型插件面板等用户打开详情后再按需加载。 */
export function SettingsPluginsView({
  entries,
  initialPluginId,
  importJobs,
  knowledgeDrafts,
  mistakes,
  personalization,
  textConnection,
  visionConnection,
  today,
  onChanged,
  onConfirmKnowledgeDrafts,
  onDeleteKnowledgeDraft,
  onImportKnowledgeText,
  onNotice,
  onOpenConnections,
  onRefreshWorkspace,
  onUpdateKnowledgeDraft,
  onUpdateKnowledgeDraftList,
}: SettingsPluginsViewProps) {
  const [activeSurface, setActiveSurface] = useState<SettingsPluginSurface>("plugin");
  const [query, setQuery] = useState("");
  const [activePluginId, setActivePluginId] = useState<SettingsPluginId | undefined>(initialPluginId);
  const pluginContext: SettingsPluginRuntimeContext = {
    entryCount: entries.length,
    importJobCount: importJobs.length,
    knowledgeDraftCount: knowledgeDrafts.length,
    mistakeCount: mistakes.length,
    hasTextConnection: Boolean(textConnection),
    hasVisionConnection: Boolean(visionConnection),
  };
  const selectedPlugin = settingsPluginDefinitions.find((plugin) => plugin.id === activePluginId);
  const activePlugin = selectedPlugin?.surface === activeSurface ? selectedPlugin : undefined;
  const searchKeyword = query.trim().toLowerCase();
  const visiblePlugins = useMemo(
    () => settingsPluginDefinitions.filter((plugin) => plugin.surface === activeSurface && pluginMatchesSearch(plugin, searchKeyword)),
    [activeSurface, searchKeyword]
  );
  const installedPlugins = useMemo(
    () => settingsPluginDefinitions.filter((plugin) => plugin.surface === activeSurface && plugin.installed),
    [activeSurface]
  );

  function openPlugin(plugin: SettingsPluginDefinition) {
    setActivePluginId(plugin.id);
  }

  function selectSurface(surface: SettingsPluginSurface) {
    setActiveSurface(surface);
    setActivePluginId(undefined);
  }

  function renderPanel(plugin: SettingsPluginDefinition) {
    if (plugin.detailPanelLoader === "quota") {
      return <AiQuotaSettingsPanel />;
    }
    if (plugin.detailPanelLoader === "fenbi-import") {
      return (
        <ImportWorkspace
          textConnection={textConnection}
          visionConnection={visionConnection}
          importJobs={importJobs}
          knowledgeDrafts={knowledgeDrafts}
          mistakes={mistakes}
          today={today}
          onConfirmKnowledgeDrafts={onConfirmKnowledgeDrafts}
          onDeleteKnowledgeDraft={onDeleteKnowledgeDraft}
          onImportKnowledgeText={onImportKnowledgeText}
          onRefreshWorkspace={onRefreshWorkspace}
          onSwitchSettings={onOpenConnections}
          onUpdateKnowledgeDraft={onUpdateKnowledgeDraft}
          onUpdateKnowledgeDraftList={onUpdateKnowledgeDraftList}
          setNotice={onNotice}
        />
      );
    }
    return (
      <ObsidianPluginPanel
        entries={entries}
        personalization={personalization}
        textConnection={textConnection}
        onChanged={onChanged}
        onNotice={onNotice}
      />
    );
  }

  return (
    <section aria-label="插件目录" className="mx-auto min-h-[76vh] w-full max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-surface-muted p-1">
          {surfaceTabs.map((tab) => (
            <button
              key={tab.key}
              className={cx("rounded-lg px-3 py-1.5 text-sm text-muted transition", activeSurface === tab.key && "bg-surface text-foreground shadow-sm")}
              type="button"
              onClick={() => selectSurface(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-muted">
          <IconButton aria-label="刷新插件状态" onClick={() => void onRefreshWorkspace()}>
            <VectorIcon name="refresh" />
          </IconButton>
          <IconButton aria-label="打开 AI 连接设置" onClick={onOpenConnections}>
            <VectorIcon name="settings" />
          </IconButton>
          <IconButton aria-label="添加插件" onClick={() => onNotice("当前仅支持应用内插件")}>
            <VectorIcon name="plus" />
          </IconButton>
        </div>
      </div>

      <header className="mx-auto mt-10 max-w-3xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight max-sm:text-3xl">插件</h1>
        <p className="mt-3 text-base text-muted">在常用工具中使用学习工作台能力</p>
        <label className="mx-auto mt-6 grid h-11 max-w-2xl grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 rounded-full border border-line bg-surface px-4 text-muted">
          <VectorIcon name="search" />
          <input
            className="min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            placeholder="搜索插件"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </header>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">已安装</h2>
          <IconButton aria-label="筛选插件" onClick={() => onNotice("可通过搜索框筛选插件")}>
            <VectorIcon name="filter" />
          </IconButton>
        </div>
        {installedPlugins.length ? (
          <InstalledPluginStrip context={pluginContext} plugins={installedPlugins} onOpen={openPlugin} />
        ) : (
          <EmptyState>暂无已安装技能。</EmptyState>
        )}
      </section>

      <div className="mt-8 flex flex-wrap gap-3 text-sm text-muted">
        <Chip tone="neutral">由应用提供</Chip>
        <Chip tone="neutral">个人</Chip>
        <Chip tone="neutral">本地优先</Chip>
      </div>

      {activePlugin ? (
        <PluginInlineDetail context={pluginContext} plugin={activePlugin} onClose={() => setActivePluginId(undefined)}>
          {renderPanel(activePlugin)}
        </PluginInlineDetail>
      ) : null}

      <div className="mt-9 grid gap-10 pb-16">
        {directorySections.map((section) => {
          const plugins = categoryPlugins(section, visiblePlugins, searchKeyword);
          if (!plugins.length) return null;
          return (
            <section key={section.key}>
              <h2 className="text-lg font-semibold">{section.label}</h2>
              <div className="mt-3 grid grid-cols-2 gap-x-12 border-t border-line max-lg:grid-cols-1">
                {plugins.map((plugin) => (
                  <PluginListItem key={`${section.key}:${plugin.id}`} context={pluginContext} plugin={plugin} onOpen={openPlugin} onNotice={onNotice} />
                ))}
              </div>
            </section>
          );
        })}
        {!visiblePlugins.length ? <EmptyState>没有匹配的插件。</EmptyState> : null}
      </div>

    </section>
  );
}
