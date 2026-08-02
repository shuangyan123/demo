"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { declarativeExtensionRepository } from "../../../services/declarative-extension-service.ts";
import { personalizationSettingsRepository, removeCustomPersona } from "../../../services/personalization-settings-repository.ts";
import { settingsPluginPreferencesRepository } from "../../../services/settings-plugin-preferences-repository.ts";
import type { ApiConnectionProfile } from "../../../types/domains/ai-connection.ts";
import type { AppearanceSettings } from "../../../types/domains/appearance.ts";
import type { InstalledExtensionRecord, PersonaExtensionData, ThemeExtensionData } from "../../../types/domains/declarative-extension.ts";
import type { ImportJob } from "../../../types/domains/import.ts";
import type { KnowledgeImportDraft, KnowledgeEntry } from "../../../types/domains/knowledge.ts";
import type { Mistake } from "../../../types/domains/review.ts";
import type { PersonalizationSettings } from "../../../types/domains/personalization.ts";
import { AppIcon } from "../../shared/app-icon";
import { Button, EmptyState } from "../../shared/ui-primitives";
import { buildPluginDirectory, type PluginDirectoryItem } from "./settings-plugin-directory.ts";
import { settingsPluginDefinitions, type SettingsPluginDefinition, type SettingsPluginId } from "./settings-plugin-registry.ts";
import styles from "./settings-plugins-view.module.css";
import { useSettingsPluginPreferences } from "./use-settings-plugin-preferences.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
type ThemeRollback = Pick<AppearanceSettings, "lightTheme" | "darkTheme">;
type ActivePlugin = { kind: "plugin"; id: string } | { kind: "browse" };

const kindLabels = {
  theme: "主题",
  persona: "教师人设",
  "study-pack": "学习路径",
  "automation-pack": "已安排模板",
  "rubric-pack": "评分标准",
} as const;

const ObsidianPluginPanel = dynamic(() => import("./obsidian/obsidian-plugin-panel").then((module) => module.ObsidianPluginPanel), {
  loading: () => <EmptyState stateId="settings.plugins.loading-obsidian">正在加载 Obsidian Vault…</EmptyState>,
});
const ImportWorkspace = dynamic(() => import("../../import/import-workspace").then((module) => module.ImportWorkspace), {
  loading: () => <EmptyState stateId="settings.plugins.loading-fenbi">正在加载粉笔导入…</EmptyState>,
});
const DeclarativeExtensionMarketplace = dynamic(() => import("./declarative-extension-marketplace").then((module) => module.DeclarativeExtensionMarketplace), {
  loading: () => <EmptyState stateId="settings.plugins.loading-marketplace">正在加载声明式扩展市场…</EmptyState>,
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

function isThemeRollback(value: unknown): value is ThemeRollback {
  return Boolean(value && typeof value === "object" && "lightTheme" in value && "darkTheme" in value);
}

function itemLabel(item: PluginDirectoryItem): string {
  return item.kind === "builtin" ? item.definition.label : item.record.package.manifest.name;
}

function itemDescription(item: PluginDirectoryItem): string {
  return item.kind === "builtin" ? item.definition.shortDescription : item.record.package.manifest.description;
}

function PluginGlyph({ item }: { item: PluginDirectoryItem }) {
  if (item.kind === "declarative") return <span className={styles.glyph} aria-hidden="true">{item.record.package.manifest.name.slice(0, 1)}</span>;
  const { icon } = item.definition;
  return (
    <span className={styles.glyph} style={{ backgroundColor: icon.background }} aria-hidden="true">
      {icon.assetPath ? <span style={{ backgroundImage: `url(${icon.assetPath})` }} /> : icon.label}
    </span>
  );
}

/** 插件目录采用行主体、开关和菜单三个独立交互区，避免嵌套按钮与误触。 */
export function SettingsPluginsView(props: SettingsPluginsViewProps) {
  const preferences = useSettingsPluginPreferences();
  const [installed, setInstalled] = useState<InstalledExtensionRecord[]>([]);
  const [active, setActive] = useState<ActivePlugin | undefined>(() => props.initialPluginId ? { kind: "plugin", id: props.initialPluginId } : undefined);
  const [menuId, setMenuId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const detailRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const onNotice = props.onNotice;
  const directory = useMemo(
    () => buildPluginDirectory(settingsPluginDefinitions, preferences.enabled, installed),
    [installed, preferences.enabled],
  );
  const activeItem = active?.kind === "plugin" ? directory.find((item) => item.id === active.id) : undefined;

  const refreshInstalled = useCallback(async () => setInstalled(await declarativeExtensionRepository.list()), []);

  useEffect(() => {
    let current = true;
    declarativeExtensionRepository.list().then((records) => {
      if (current) setInstalled(records);
    }).catch((error) => onNotice(error instanceof Error ? error.message : "扩展目录读取失败"));
    return () => { current = false; };
  }, [onNotice]);

  useEffect(() => {
    if (!active) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => detailRef.current?.focus());
    return () => restoreFocusRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (!menuId) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setMenuId(undefined);
      window.requestAnimationFrame(() => menuButtonRefs.current.get(menuId)?.focus());
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuId]);

  async function disableDeclarative(record: InstalledExtensionRecord): Promise<void> {
    if (record.kind === "theme" && isThemeRollback(record.rollbackData)) {
      props.onAppearanceChange({ ...props.appearanceSettings, ...record.rollbackData });
    }
    if (record.kind === "persona") {
      const data = record.package.data as PersonaExtensionData;
      props.onPersonalizationChange(await personalizationSettingsRepository.save(removeCustomPersona(props.personalization, data.persona.id)));
    }
    await declarativeExtensionRepository.setEnabled(record.id, false);
  }

  async function toggleDeclarative(record: InstalledExtensionRecord): Promise<void> {
    setBusyId(record.id);
    try {
      if (record.enabled) {
        await disableDeclarative(record);
      } else {
        if (record.kind === "theme") {
          for (const current of installed.filter((item) => item.kind === "theme" && item.enabled)) await disableDeclarative(current);
        }
        let rollbackData: ThemeRollback | undefined;
        if (record.kind === "theme") {
          const data = record.package.data as ThemeExtensionData;
          rollbackData = { lightTheme: props.appearanceSettings.lightTheme, darkTheme: props.appearanceSettings.darkTheme };
          props.onAppearanceChange({
            ...props.appearanceSettings,
            lightTheme: data.target === "dark" ? props.appearanceSettings.lightTheme : data.theme,
            darkTheme: data.target === "light" ? props.appearanceSettings.darkTheme : data.theme,
          });
        }
        if (record.kind === "persona") {
          const data = record.package.data as PersonaExtensionData;
          const next = props.personalization.customPersonas.some((persona) => persona.id === data.persona.id)
            ? props.personalization
            : { ...props.personalization, personaDisplayMode: "custom" as const, customPersonas: [...props.personalization.customPersonas, data.persona] };
          props.onPersonalizationChange(await personalizationSettingsRepository.save(next));
        }
        await declarativeExtensionRepository.setEnabled(record.id, true, rollbackData);
      }
      await Promise.all([refreshInstalled(), props.onChanged()]);
      props.onNotice(`${record.package.manifest.name} 已${record.enabled ? "停用" : "启用"}`);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "扩展状态更新失败");
    } finally {
      setBusyId(undefined);
    }
  }

  async function toggle(item: PluginDirectoryItem): Promise<void> {
    if (item.kind === "builtin") {
      settingsPluginPreferencesRepository.setEnabled(item.id, !item.enabled);
      props.onNotice(`${item.definition.label} 已${item.enabled ? "停用" : "启用"}；现有数据与配置保持不变`);
      return;
    }
    await toggleDeclarative(item.record);
  }

  async function uninstall(item: Extract<PluginDirectoryItem, { kind: "declarative" }>): Promise<void> {
    setBusyId(item.id);
    try {
      if (item.record.enabled) await disableDeclarative(item.record);
      await declarativeExtensionRepository.uninstall(item.id);
      setActive(undefined);
      await Promise.all([refreshInstalled(), props.onChanged()]);
      props.onNotice(`${item.record.package.manifest.name} 已卸载`);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "扩展卸载失败");
    } finally {
      setBusyId(undefined);
    }
  }

  function closeDetail(): void {
    setActive(undefined);
  }

  function renderBuiltinPanel(definition: SettingsPluginDefinition) {
    if (definition.detailPanelLoader === "fenbi-import") {
      return (
        <ImportWorkspace
          textConnection={props.textConnection}
          visionConnection={props.visionConnection}
          importJobs={props.importJobs}
          mistakes={props.mistakes}
          today={props.today}
          onRefreshWorkspace={props.onRefreshWorkspace}
          onSwitchSettings={props.onOpenConnections}
          setNotice={props.onNotice}
        />
      );
    }
    return <ObsidianPluginPanel entries={props.entries} personalization={props.personalization} textConnection={props.textConnection} onChanged={props.onChanged} onNotice={props.onNotice} />;
  }

  if (active?.kind === "browse") {
    return (
      <section ref={detailRef} tabIndex={-1} className={styles.detailPage} aria-label="浏览和导入扩展" onKeyDown={(event) => { if (event.key === "Escape") closeDetail(); }}>
        <button className={styles.backButton} type="button" onClick={closeDetail}><AppIcon name="back" size={16} />返回插件</button>
        <header className={styles.detailHero}><span className={styles.glyph}>扩</span><div><p>扩展目录</p><h1>浏览与导入扩展</h1><span>只安装经过 SHA-256 与签名校验的数据包，不执行第三方代码。</span></div></header>
        <DeclarativeExtensionMarketplace
          appearanceSettings={props.appearanceSettings}
          personalization={props.personalization}
          onAppearanceChange={props.onAppearanceChange}
          onChanged={async () => { await Promise.all([props.onChanged(), refreshInstalled()]); }}
          onPersonalizationChange={props.onPersonalizationChange}
          onNotice={props.onNotice}
        />
      </section>
    );
  }

  if (activeItem) {
    const label = itemLabel(activeItem);
    const description = itemDescription(activeItem);
    const source = activeItem.kind === "builtin" ? activeItem.definition.providerLabel : activeItem.record.source === "catalog" ? "官方静态目录" : "本地签名包";
    const version = activeItem.kind === "builtin" ? "随应用版本更新" : `v${activeItem.record.package.manifest.version}`;
    const permissions = activeItem.kind === "builtin" ? activeItem.definition.capabilities.join("、") : activeItem.record.package.manifest.permissions.join("、");
    const privacy = activeItem.kind === "builtin" ? activeItem.definition.privacyNote : "扩展保存在独立 review_extensions 数据库；包内不允许脚本、HTML、远程字体或 Token。";
    return (
      <section ref={detailRef} tabIndex={-1} className={styles.detailPage} aria-label={`${label} 详情`} onKeyDown={(event) => { if (event.key === "Escape") closeDetail(); }}>
        <button className={styles.backButton} type="button" onClick={closeDetail}><AppIcon name="back" size={16} />返回插件</button>
        <header className={styles.detailHero}>
          <PluginGlyph item={activeItem} />
          <div><p>{activeItem.kind === "builtin" ? "内置插件" : kindLabels[activeItem.record.kind]}</p><h1>{label}</h1><span>{description}</span></div>
          <label className={styles.toggle}><input aria-label={`${label} 启用状态`} type="checkbox" checked={activeItem.enabled} disabled={busyId === activeItem.id} onChange={() => void toggle(activeItem)} /><span /></label>
        </header>
        <dl className={styles.metadata}>
          <div><dt><AppIcon name="info" size={16} />来源</dt><dd>{source}</dd></div>
          <div><dt><AppIcon name="check" size={16} />版本</dt><dd>{version}</dd></div>
          <div><dt><AppIcon name="configure" size={16} />权限与能力</dt><dd>{permissions}</dd></div>
          <div><dt><AppIcon name="library" size={16} />本地数据边界</dt><dd>{privacy}</dd></div>
        </dl>
        {activeItem.kind === "declarative" ? (
          <div className={styles.detailActions}><Button variant="outline" disabled={busyId === activeItem.id} onClick={() => void uninstall(activeItem)}><AppIcon name="trash" size={16} />卸载</Button></div>
        ) : activeItem.enabled ? <div className={styles.panel}>{renderBuiltinPanel(activeItem.definition)}</div> : <div className={styles.disabledNotice}><strong>插件已停用</strong><span>现有数据和配置仍保留。重新启用后才能执行同步或导入。</span><Button size="sm" onClick={() => void toggle(activeItem)}>重新启用</Button></div>}
      </section>
    );
  }

  return (
    <section className={styles.workspace} aria-label="插件管理">
      <header className={styles.header}>
        <div><h1>插件</h1><p>启用需要的本地集成，或管理已经安装的声明式扩展。</p></div>
        <Button variant="outline" onClick={() => setActive({ kind: "browse" })}><AppIcon name="plugins" size={16} />浏览 / 导入扩展</Button>
      </header>
      <div className={styles.list} role="list">
        {directory.map((item) => {
          const label = itemLabel(item);
          const open = () => setActive({ kind: "plugin", id: item.id });
          return (
            <article key={`${item.kind}-${item.id}`} className={styles.row} role="listitem">
              <button className={styles.rowMain} type="button" onClick={open}>
                <PluginGlyph item={item} />
                <span><strong>{label}</strong><small>{itemDescription(item)}</small></span>
              </button>
              <label className={styles.toggle} onClick={(event) => event.stopPropagation()}><input aria-label={`${label} 启用状态`} type="checkbox" checked={item.enabled} disabled={busyId === item.id} onChange={() => void toggle(item)} /><span /></label>
              <div className={styles.menuHost}>
                <button ref={(node) => { if (node) menuButtonRefs.current.set(item.id, node); }} className={styles.moreButton} type="button" aria-label={`${label} 更多操作`} aria-expanded={menuId === item.id} onClick={(event) => { event.stopPropagation(); setMenuId((current) => current === item.id ? undefined : item.id); }}><AppIcon name="more" size={16} /></button>
                {menuId === item.id ? <div className={styles.menu} role="menu" onMouseDown={(event) => event.stopPropagation()}><button role="menuitem" type="button" onClick={open}>打开详情</button><button role="menuitem" type="button" onClick={() => void toggle(item)}>{item.enabled ? "停用" : "启用"}</button>{item.kind === "declarative" ? <button role="menuitem" type="button" className={styles.danger} onClick={() => void uninstall(item)}>卸载</button> : null}</div> : null}
              </div>
            </article>
          );
        })}
        {!directory.length ? <EmptyState stateId="settings.plugins.filtered-empty">还没有可管理的插件。</EmptyState> : null}
      </div>
    </section>
  );
}
