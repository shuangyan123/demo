"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { officialDeclarativeExtensionCatalog } from "../../../services/declarative-extension-catalog.ts";
import {
  declarativeExtensionRepository,
  MAX_EXTENSION_PACKAGE_BYTES,
  validateExtensionPackage,
} from "../../../services/declarative-extension-service.ts";
import { personalizationSettingsRepository, removeCustomPersona } from "../../../services/personalization-settings-repository.ts";
import type { AppearanceSettings } from "../../../types/domains/appearance.ts";
import type { DeclarativeExtensionPackage, InstalledExtensionRecord, PersonaExtensionData, ThemeExtensionData } from "../../../types/domains/declarative-extension.ts";
import type { PersonalizationSettings } from "../../../types/domains/personalization.ts";
import { Button, Chip, EmptyState } from "../../shared/ui-primitives.tsx";

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
  onPersonalizationChange: (settings: PersonalizationSettings) => void;
  onNotice: (message: string) => void;
};

type ThemeRollback = Pick<AppearanceSettings, "lightTheme" | "darkTheme">;

function isThemeRollback(value: unknown): value is ThemeRollback {
  return Boolean(value && typeof value === "object" && "lightTheme" in value && "darkTheme" in value);
}

function downloadJson(filename: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PackageSummary({ extensionPackage, source }: { extensionPackage: DeclarativeExtensionPackage; source: "官方目录" | "本地文件" }) {
  const { manifest } = extensionPackage;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{manifest.name}</strong>
        <Chip tone="neutral">{kindLabels[manifest.kind]}</Chip>
        <Chip tone="green">签名有效</Chip>
      </div>
      <p className="mt-1 text-sm text-muted">{manifest.description}</p>
      <p className="mt-2 text-xs text-muted">
        {source} · {manifest.author.name} · v{manifest.version} · 权限：{manifest.permissions.map((permission) => permissionLabels[permission]).join("、")}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted">SHA-256 {manifest.contentSha256.slice(0, 16)}…</p>
    </div>
  );
}

/** 声明式扩展市场只解释已校验数据，不执行包内 JavaScript、HTML 或远程资源。 */
export function DeclarativeExtensionMarketplace({
  appearanceSettings,
  personalization,
  onAppearanceChange,
  onChanged,
  onPersonalizationChange,
  onNotice,
}: MarketplaceProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [installed, setInstalled] = useState<InstalledExtensionRecord[]>([]);
  const [importPreview, setImportPreview] = useState<DeclarativeExtensionPackage>();
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => setInstalled(await declarativeExtensionRepository.list()), []);

  useEffect(() => {
    let active = true;
    declarativeExtensionRepository.list().then((records) => {
      if (active) setInstalled(records);
    }).catch((error) => onNotice(error instanceof Error ? error.message : "扩展目录读取失败"));
    return () => {
      active = false;
    };
  }, [onNotice]);

  async function install(extensionPackage: DeclarativeExtensionPackage, source: InstalledExtensionRecord["source"]): Promise<void> {
    setBusyId(extensionPackage.manifest.id);
    try {
      await declarativeExtensionRepository.install(extensionPackage, source);
      await refresh();
      setImportPreview(undefined);
      onNotice(`${extensionPackage.manifest.name} 已安装，启用前不会改变应用`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "扩展安装失败");
    } finally {
      setBusyId("");
    }
  }

  async function applyPersona(record: InstalledExtensionRecord): Promise<void> {
    const data = record.package.data as PersonaExtensionData;
    if (personalization.customPersonas.some((persona) => persona.id === data.persona.id)) return;
    const next: PersonalizationSettings = {
      ...personalization,
      personaDisplayMode: "custom",
      customPersonas: [...personalization.customPersonas, data.persona],
      personaCustomizations: data.voiceRef ? {
        ...personalization.personaCustomizations,
        [data.persona.id]: {
          ...personalization.personaCustomizations[data.persona.id],
          voice: { rate: 0.95, volume: 1, model: data.voiceRef.model, voiceId: data.voiceRef.voiceId, style: data.voiceRef.style ?? "" },
        },
      } : personalization.personaCustomizations,
    };
    onPersonalizationChange(await personalizationSettingsRepository.save(next));
  }

  async function removePersona(record: InstalledExtensionRecord): Promise<void> {
    const data = record.package.data as PersonaExtensionData;
    onPersonalizationChange(await personalizationSettingsRepository.save(removeCustomPersona(personalization, data.persona.id)));
  }

  function applyTheme(record: InstalledExtensionRecord): ThemeRollback {
    const data = record.package.data as ThemeExtensionData;
    const rollback = { lightTheme: appearanceSettings.lightTheme, darkTheme: appearanceSettings.darkTheme };
    onAppearanceChange({
      ...appearanceSettings,
      lightTheme: data.target === "dark" ? appearanceSettings.lightTheme : data.theme,
      darkTheme: data.target === "light" ? appearanceSettings.darkTheme : data.theme,
    });
    return rollback;
  }

  function restoreTheme(record: InstalledExtensionRecord): void {
    if (!isThemeRollback(record.rollbackData)) return;
    onAppearanceChange({ ...appearanceSettings, ...record.rollbackData });
  }

  async function disable(record: InstalledExtensionRecord): Promise<void> {
    if (record.kind === "theme") restoreTheme(record);
    if (record.kind === "persona") await removePersona(record);
    await declarativeExtensionRepository.setEnabled(record.id, false);
  }

  async function toggle(record: InstalledExtensionRecord): Promise<void> {
    setBusyId(record.id);
    try {
      if (record.enabled) {
        await disable(record);
      } else {
        if (record.kind === "theme") {
          for (const active of installed.filter((item) => item.kind === "theme" && item.enabled)) await disable(active);
        }
        const rollbackData = record.kind === "theme" ? applyTheme(record) : undefined;
        if (record.kind === "persona") await applyPersona(record);
        await declarativeExtensionRepository.setEnabled(record.id, true, rollbackData);
      }
      await Promise.all([refresh(), onChanged()]);
      onNotice(`${record.package.manifest.name} 已${record.enabled ? "停用" : "启用"}`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "扩展状态更新失败");
    } finally {
      setBusyId("");
    }
  }

  async function uninstall(record: InstalledExtensionRecord): Promise<void> {
    setBusyId(record.id);
    try {
      if (record.enabled) await disable(record);
      await declarativeExtensionRepository.uninstall(record.id);
      await Promise.all([refresh(), onChanged()]);
      onNotice(`${record.package.manifest.name} 已卸载`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "扩展卸载失败");
    } finally {
      setBusyId("");
    }
  }

  async function rollback(record: InstalledExtensionRecord): Promise<void> {
    setBusyId(record.id);
    try {
      if (record.enabled) await disable(record);
      await declarativeExtensionRepository.rollback(record.id);
      await refresh();
      onNotice(`${record.package.manifest.name} 已回滚，需重新启用`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "扩展回滚失败");
    } finally {
      setBusyId("");
    }
  }

  async function readImport(file: File): Promise<void> {
    try {
      if (file.size > MAX_EXTENSION_PACKAGE_BYTES) throw new Error("扩展包不能超过 5MB");
      const parsed: unknown = JSON.parse(await file.text());
      setImportPreview(await validateExtensionPackage(parsed));
    } catch (error) {
      setImportPreview(undefined);
      onNotice(error instanceof Error ? error.message : "扩展包读取失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-7">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">声明式扩展市场</h3>
            <p className="mt-1 text-sm text-muted">只安装签名数据包；不执行第三方 JavaScript、HTML、远程字体或 CDN。</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>导入签名包</Button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void readImport(file);
            }}
          />
        </div>
        {importPreview ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-foreground/40 bg-[var(--interactive-selected-bg)] p-4">
            <PackageSummary extensionPackage={importPreview} source="本地文件" />
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === importPreview.manifest.id} onClick={() => void install(importPreview, "local")}>确认安装</Button>
              <Button size="sm" variant="ghost" onClick={() => setImportPreview(undefined)}>取消</Button>
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold">官方静态目录</h3>
        <div className="mt-3 grid gap-3">
          {officialDeclarativeExtensionCatalog.map((extensionPackage) => {
            const current = installed.find((record) => record.id === extensionPackage.manifest.id);
            return (
              <article key={extensionPackage.manifest.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-line p-4 max-sm:grid-cols-1">
                <PackageSummary extensionPackage={extensionPackage} source="官方目录" />
                <Button size="sm" variant={current ? "soft" : "outline"} disabled={busyId === extensionPackage.manifest.id || current?.package.manifest.version === extensionPackage.manifest.version} onClick={() => void install(extensionPackage, "catalog")}>
                  {current ? "已安装" : "安装"}
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">已安装</h3>
        <div className="mt-3 grid gap-3">
          {installed.length ? installed.map((record) => (
            <article key={record.id} className="grid gap-3 rounded-xl border border-line p-4">
              <PackageSummary extensionPackage={record.package} source={record.source === "catalog" ? "官方目录" : "本地文件"} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busyId === record.id} variant={record.enabled ? "soft" : "outline"} onClick={() => void toggle(record)}>{record.enabled ? "停用" : "启用"}</Button>
                <Button size="sm" variant="ghost" onClick={() => void declarativeExtensionRepository.exportPackage(record.id).then((value) => downloadJson(`${record.id}-${record.package.manifest.version}.json`, value))}>导出</Button>
                {record.previousPackage ? <Button size="sm" variant="ghost" disabled={busyId === record.id} onClick={() => void rollback(record)}>回滚</Button> : null}
                <Button size="sm" variant="ghost" disabled={busyId === record.id} onClick={() => void uninstall(record)}>卸载</Button>
              </div>
            </article>
          )) : <EmptyState>还没有安装声明式扩展。</EmptyState>}
        </div>
      </section>
    </div>
  );
}
