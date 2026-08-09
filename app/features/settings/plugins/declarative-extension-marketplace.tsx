"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { officialDeclarativeExtensionCatalog } from "../../../services/declarative-extension-catalog.ts";
import { declarativeExtensionRepository, MAX_EXTENSION_PACKAGE_BYTES, validateExtensionPackage } from "../../../services/declarative-extension-service.ts";
import type { AppearanceSettings } from "../../../types/domains/appearance.ts";
import type { DeclarativeExtensionPackage, InstalledExtensionRecord } from "../../../types/domains/declarative-extension.ts";
import type { PersonalizationSettings } from "../../../types/domains/personalization.ts";
import { AppIcon } from "../../shared/app-icon.tsx";
import { Button, EmptyState } from "../../shared/ui-primitives.tsx";
import styles from "./settings-plugins-view.module.css";

const kindLabels = {
  theme: "主题",
  persona: "教师人设",
  "study-pack": "学习路径",
  "automation-pack": "已安排模板",
  "rubric-pack": "评分标准",
} as const;

const permissionLabels = {
  "appearance.write": "修改当前主题",
  "persona.write": "添加一个可卸载教师人设",
  "study.read": "向学习模块提供声明式路径",
  "automation.template": "提供已安排任务模板，不自动启用",
  "rubric.read": "向面试和辅导提供评分标准",
} as const;

type MarketplaceProps = {
  appearanceSettings: AppearanceSettings;
  personalization: PersonalizationSettings;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onChanged: () => Promise<void>;
  onInstalled: (id: string) => void;
  onPersonalizationChange: (settings: PersonalizationSettings) => void;
  onNotice: (message: string) => void;
};

function PackageGlyph({ extensionPackage }: { extensionPackage: DeclarativeExtensionPackage }) {
  return <span className={styles.glyph} aria-hidden="true">{extensionPackage.manifest.name.slice(0, 1)}</span>;
}

/** 市场只负责发现、校验与安装；启停和卸载统一回到一级插件目录。 */
export function DeclarativeExtensionMarketplace({ onChanged, onInstalled, onNotice }: MarketplaceProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [installed, setInstalled] = useState<InstalledExtensionRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ extensionPackage: DeclarativeExtensionPackage; source: "官方目录" | "本地文件" }>();
  const [busyId, setBusyId] = useState("");
  const refresh = useCallback(async () => setInstalled(await declarativeExtensionRepository.list()), []);

  useEffect(() => {
    let active = true;
    declarativeExtensionRepository.list().then((records) => { if (active) setInstalled(records); }).catch((error) => onNotice(error instanceof Error ? error.message : "扩展目录读取失败"));
    return () => { active = false; };
  }, [onNotice]);

  useEffect(() => {
    const openImporter = () => fileInputRef.current?.click();
    window.addEventListener("review-workspace:open-extension-import", openImporter);
    return () => window.removeEventListener("review-workspace:open-extension-import", openImporter);
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return officialDeclarativeExtensionCatalog;
    return officialDeclarativeExtensionCatalog.filter((extensionPackage) => {
      const manifest = extensionPackage.manifest;
      return `${manifest.name} ${manifest.description} ${manifest.author.name} ${kindLabels[manifest.kind]}`.toLowerCase().includes(normalized);
    });
  }, [query]);

  async function install(extensionPackage: DeclarativeExtensionPackage, source: InstalledExtensionRecord["source"]): Promise<void> {
    setBusyId(extensionPackage.manifest.id);
    try {
      await declarativeExtensionRepository.install(extensionPackage, source);
      await Promise.all([refresh(), onChanged()]);
      onNotice(`${extensionPackage.manifest.name} 已安装，启用前不会改变应用`);
      onInstalled(extensionPackage.manifest.id);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "扩展安装失败");
    } finally {
      setBusyId("");
    }
  }

  async function readImport(file: File): Promise<void> {
    try {
      if (file.size > MAX_EXTENSION_PACKAGE_BYTES) throw new Error("扩展包不能超过 5MB");
      const parsed: unknown = JSON.parse(await file.text());
      setSelected({ extensionPackage: await validateExtensionPackage(parsed), source: "本地文件" });
    } catch (error) {
      setSelected(undefined);
      onNotice(error instanceof Error ? error.message : "扩展包读取失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (selected) {
    const { manifest } = selected.extensionPackage;
    const current = installed.find((record) => record.id === manifest.id);
    const sameVersion = current?.package.manifest.version === manifest.version;
    return (
      <section aria-label={`${manifest.name} 市场详情`}>
        <button className={styles.backButton} type="button" onClick={() => setSelected(undefined)}><AppIcon name="back" size={16} />返回市场</button>
        <header className={styles.detailHero}><PackageGlyph extensionPackage={selected.extensionPackage} /><div><p>{kindLabels[manifest.kind]} · {selected.source}</p><h2>{manifest.name}</h2><span>{manifest.description}</span></div></header>
        <dl className={styles.metadata}>
          <div><dt><AppIcon name="info" size={16} />作者</dt><dd>{manifest.author.name}</dd></div>
          <div><dt><AppIcon name="check" size={16} />版本</dt><dd>v{manifest.version}</dd></div>
          <div><dt><AppIcon name="configure" size={16} />权限</dt><dd>{manifest.permissions.map((permission) => permissionLabels[permission]).join("、")}</dd></div>
          <div><dt><AppIcon name="diagnostics" size={16} />签名与摘要</dt><dd>签名有效 · SHA-256 {manifest.contentSha256}</dd></div>
        </dl>
        <div className={styles.detailActions}>
          <Button disabled={busyId === manifest.id || sameVersion} onClick={() => void install(selected.extensionPackage, selected.source === "官方目录" ? "catalog" : "local")}>{sameVersion ? "已安装" : current ? "更新" : "安装"}</Button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.market} aria-label="插件市场">
      <header className={styles.header}>
        <div><h1>插件市场</h1><p>浏览经过签名校验的声明式扩展，不执行第三方代码。</p></div>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><AppIcon name="upload" size={16} />导入签名包</Button>
        <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void readImport(file);
        }} />
      </header>
      <label className={styles.marketSearch}><AppIcon name="search" size={16} /><span className="sr-only">搜索插件市场</span><input value={query} placeholder="搜索插件名称、作用或作者" onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      <div className={styles.list} role="list">
        {filtered.map((extensionPackage) => {
          const { manifest } = extensionPackage;
          const current = installed.find((record) => record.id === manifest.id);
          const sameVersion = current?.package.manifest.version === manifest.version;
          return (
            <article key={manifest.id} className={styles.row} role="listitem">
              <button className={styles.rowMain} type="button" onClick={() => setSelected({ extensionPackage, source: "官方目录" })}>
                <PackageGlyph extensionPackage={extensionPackage} />
                <span><strong>{manifest.name}</strong><small>{manifest.description}</small><em>{kindLabels[manifest.kind]} · 官方目录</em></span>
              </button>
              <Button size="sm" variant={sameVersion ? "ghost" : "outline"} disabled={busyId === manifest.id || sameVersion} onClick={() => void install(extensionPackage, "catalog")}>{sameVersion ? "已安装" : current ? "更新" : "安装"}</Button>
            </article>
          );
        })}
        {!filtered.length ? <EmptyState stateId="settings.plugins.filtered-empty">没有匹配的扩展。</EmptyState> : null}
      </div>
    </section>
  );
}
