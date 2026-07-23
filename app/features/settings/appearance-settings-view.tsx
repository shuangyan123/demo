"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { createDefaultAppearanceSettings } from "../../services/appearance-settings-repository";
import type { AppearanceSettings, ThemeConfig } from "../../types/review";
import { ColorPickerField, isValidHexColor } from "./color-picker-field";
import { cloneTheme, darkThemePresets, lightThemePresets, type ThemePreset } from "./theme-presets";
import { ThemePresetSelect } from "./theme-preset-select";
import { AppIcon } from "../shared/app-icon";
import { SettingsSectionHeader } from "./settings-section-header";

export type SettingsIconName = "appearance" | "back" | "configuration" | "diagnostics" | "mcp" | "personalization" | "plugins" | "dark" | "light" | "motion" | "none" | "system";

// 把数字限制在控件允许范围内，防止字号和对比度写入异常值。
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// 清洗导入主题 JSON，只接受主题允许的字段和合法颜色。
function sanitizeImportedTheme(input: Partial<ThemeConfig> & { translucentSidebar?: boolean }): Partial<ThemeConfig> {
  const patch: Partial<ThemeConfig> = {};
  if (typeof input.name === "string" && input.name.trim()) patch.name = input.name.trim();
  if (typeof input.accent === "string" && isValidHexColor(input.accent)) patch.accent = input.accent.trim().toUpperCase();
  if (typeof input.background === "string" && isValidHexColor(input.background)) patch.background = input.background.trim().toUpperCase();
  if (typeof input.foreground === "string" && isValidHexColor(input.foreground)) patch.foreground = input.foreground.trim().toUpperCase();
  if (typeof input.uiFont === "string" && input.uiFont.trim()) patch.uiFont = input.uiFont.trim();
  if (typeof input.codeFont === "string" && input.codeFont.trim()) patch.codeFont = input.codeFont.trim();
  if (typeof input.diffuseGradient === "boolean") patch.diffuseGradient = input.diffuseGradient;
  else if (typeof input.translucentSidebar === "boolean") patch.diffuseGradient = input.translucentSidebar;
  if (Number.isFinite(input.contrast)) patch.contrast = clampNumber(Number(input.contrast), 0, 100);
  return patch;
}

type AppearanceSettingsViewProps = {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  onNotify: (message: string) => void;
};

// 渲染外观页，并把每次控件变化提升给父组件保存和应用到 CSS 变量。
export function AppearanceSettingsView({ settings, onChange, onNotify }: AppearanceSettingsViewProps) {
  // 合并外观设置顶层字段，保持每个控件都能即时生效。
  function updateSettings(patch: Partial<AppearanceSettings>) {
    onChange({ ...settings, ...patch });
  }

  // 更新浅色或深色主题卡片中的局部字段。
  function updateTheme(themeKey: "lightTheme" | "darkTheme", patch: Partial<ThemeConfig>) {
    onChange({
      ...settings,
      [themeKey]: {
        ...settings[themeKey],
        ...patch,
      },
    });
  }

  return (
    <section>
      <SettingsSectionHeader title="外观" description="统一管理主题、字体、弥散效果和动态偏好。" />

      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 max-md:flex-col max-md:items-stretch">
          <div>
            <h2 className="text-base font-semibold">主题</h2>
            <p className="mt-1 text-sm text-muted">使用浅色、深色，或匹配系统设置</p>
          </div>
          <SegmentedControl
            value={settings.mode}
            options={[
              ["light", "浅色", "light"],
              ["dark", "深色", "dark"],
              ["system", "系统", "system"],
            ]}
            onChange={(value) => updateSettings({ mode: value as AppearanceSettings["mode"] })}
          />
        </div>

        <ThemeEditor
          label="浅色主题"
          theme={settings.lightTheme}
          themeKey="lightTheme"
          presets={lightThemePresets}
          onChange={updateTheme}
          onNotify={onNotify}
          onReset={() => updateTheme("lightTheme", cloneTheme(createDefaultAppearanceSettings().lightTheme))}
        />
        <ThemeEditor
          label="深色主题"
          theme={settings.darkTheme}
          themeKey="darkTheme"
          presets={darkThemePresets}
          onChange={updateTheme}
          onNotify={onNotify}
          onReset={() => updateTheme("darkTheme", cloneTheme(createDefaultAppearanceSettings().darkTheme))}
        />

        <SettingsRow
          title="使用指针光标"
          description="悬停交互元素时切换为指针光标"
          control={<ToggleSwitch ariaLabel="使用指针光标" checked={settings.pointerCursor} onChange={(checked) => updateSettings({ pointerCursor: checked })} />}
        />
        <SettingsRow
          title="减少动态效果"
          description="减少动画效果或匹配系统设置"
          control={
            <SegmentedControl
              value={settings.reducedMotion}
              options={[
                ["system", "系统", "system"],
                ["on", "开启", "motion"],
                ["off", "关闭", "none"],
              ]}
              onChange={(value) => updateSettings({ reducedMotion: value as AppearanceSettings["reducedMotion"] })}
            />
          }
        />
        <SettingsRow
          title="UI 字号"
          description="调整界面使用的基准字号"
          control={<NumberControl value={settings.uiFontSize} min={12} max={18} suffix="px" onChange={(value) => updateSettings({ uiFontSize: value })} />}
        />
        <SettingsRow
          title="代码字体大小"
          description="调整主题预览和代码内容使用的基准字号"
          control={<NumberControl value={settings.codeFontSize} min={10} max={18} suffix="px" onChange={(value) => updateSettings({ codeFontSize: value })} />}
        />
      </div>
    </section>
  );
}

type ThemeEditorProps = {
  label: string;
  presets: ThemePreset[];
  theme: ThemeConfig;
  themeKey: "lightTheme" | "darkTheme";
  onChange: (themeKey: "lightTheme" | "darkTheme", patch: Partial<ThemeConfig>) => void;
  onNotify: (message: string) => void;
  onReset: () => void;
};

// 渲染单个主题卡片，提供颜色、字体、侧栏弥散渐变和对比度编辑能力。
function ThemeEditor({ label, presets, theme, themeKey, onChange, onNotify, onReset }: ThemeEditorProps) {
  // 导入 JSON 主题片段，用于快速复用本地保存的主题配置。
  async function importTheme(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ThemeConfig> & { translucentSidebar?: boolean };
      const patch = sanitizeImportedTheme(parsed);
      if (!Object.keys(patch).length) throw new Error("主题文件没有可用字段");
      onChange(themeKey, patch);
      onNotify("主题已导入");
    } catch {
      onNotify("主题文件格式不正确");
    }
  }

  // 将当前主题复制为 JSON，方便用户迁移到另一台设备。
  async function copyTheme() {
    try {
      if (!navigator.clipboard) throw new Error("当前浏览器不支持剪贴板 API");
      await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
      onNotify("主题 JSON 已复制");
    } catch {
      onNotify("复制失败，请检查浏览器剪贴板权限");
    }
  }

  // 选择内置主题时写入完整主题配置，而不是只改主题名称。
  function selectPreset(name: string) {
    const preset = presets.find((item) => item.theme.name === name);
    // 切换配色预设不改变用户当前的弥散偏好；只有显式重置主题才恢复关闭。
    onChange(themeKey, preset ? { ...cloneTheme(preset.theme), diffuseGradient: theme.diffuseGradient } : { name });
  }

  return (
    <section className="border-t border-line px-5 py-4">
      <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
        <h3 className="text-lg font-semibold">{label}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer text-sm text-muted hover:text-foreground">
            导入
            <input
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importTheme(event.currentTarget.files?.[0])}
            />
          </label>
          <button className="text-sm text-muted hover:text-foreground" type="button" onClick={() => void copyTheme()}>
            复制主题
          </button>
          <button
            className="text-sm text-muted hover:text-foreground"
            type="button"
            onClick={() => {
              onReset();
              onNotify("主题已重置");
            }}
          >
            重置主题
          </button>
          <ThemePresetSelect presets={presets} value={theme.name} onChange={selectPreset} />
        </div>
      </div>

      <SettingsRow title="强调色" control={<ColorPickerField label="强调色" value={theme.accent} onChange={(value) => onChange(themeKey, { accent: value })} />} />
      <SettingsRow title="背景" control={<ColorPickerField label="背景" value={theme.background} onChange={(value) => onChange(themeKey, { background: value })} />} />
      <SettingsRow title="前景" control={<ColorPickerField label="前景" value={theme.foreground} onChange={(value) => onChange(themeKey, { foreground: value })} />} />
      <SettingsRow title="UI 字体" control={<InlineTextControl value={theme.uiFont} onChange={(value) => onChange(themeKey, { uiFont: value })} />} />
      <SettingsRow title="代码字体" control={<InlineTextControl value={theme.codeFont} onChange={(value) => onChange(themeKey, { codeFont: value })} />} />
      <SettingsRow
        title="弥散渐变"
        description="在页面背景与不透明侧栏上叠加低透明度多色弥散色场"
        control={<ToggleSwitch ariaLabel={`${label}弥散渐变`} checked={theme.diffuseGradient} onChange={(checked) => onChange(themeKey, { diffuseGradient: checked })} />}
      />
      <SettingsRow
        title="对比度"
        control={<SliderControl value={theme.contrast} min={0} max={100} onChange={(value) => onChange(themeKey, { contrast: value })} />}
      />
    </section>
  );
}

// 渲染通用设置行，左侧为说明，右侧为具体控件。
function SettingsRow({ control, description, title }: { control: ReactNode; description?: string; title: string }) {
  return (
    <div className="grid min-h-14 grid-cols-[1fr_minmax(220px,300px)] items-center gap-5 border-t border-line px-5 py-2.5 max-md:grid-cols-1 max-md:items-stretch">
      <div>
        <div className="font-medium">{title}</div>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="justify-self-end max-md:justify-self-stretch">{control}</div>
    </div>
  );
}

// 渲染轻量分段控件，用于主题模式和动态效果等少量互斥选项。
function SegmentedControl({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: Array<[string, string, SettingsIconName]>;
  value: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-muted p-1">
      {options.map(([optionValue, label, icon]) => (
        <button
          key={optionValue}
          className={`inline-flex min-h-8 items-center gap-2 rounded-md px-3 text-sm ${
            value === optionValue ? "bg-surface text-foreground" : "text-muted hover:text-foreground"
          }`}
          type="button"
          onClick={() => onChange(optionValue)}
        >
          <SettingsNavIcon name={icon} small />
          {label}
        </button>
      ))}
    </div>
  );
}

// 渲染开关控件，使用按钮避免浏览器默认 checkbox 外观不一致。
function ToggleSwitch({ ariaLabel, checked, disabled = false, onChange }: { ariaLabel: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`relative h-8 w-14 rounded-full transition ${checked ? "bg-blue" : "bg-slate-200"} ${disabled ? "opacity-45" : ""}`}
      disabled={disabled}
      role="switch"
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${checked ? "left-7" : "left-1"}`} />
    </button>
  );
}

// 渲染数字输入控件，限制字号等数值落在合理范围内。
function NumberControl({ max, min, onChange, suffix, value }: { max: number; min: number; onChange: (value: number) => void; suffix: string; value: number }) {
  const [draftState, setDraftState] = useState(() => ({ sourceValue: value, draft: String(value) }));
  const draft = draftState.sourceValue === value ? draftState.draft : String(value);

  // 输入过程中即时更新合法数字；失焦时再把显示值归一到边界内。
  function updateValue(nextDraft: string) {
    const parsed = Number(nextDraft);
    if (Number.isFinite(parsed)) {
      const nextValue = clampNumber(parsed, min, max);
      setDraftState({ sourceValue: nextValue, draft: nextDraft });
      onChange(nextValue);
    } else {
      setDraftState({ sourceValue: value, draft: nextDraft });
    }
  }

  // 失焦时补回合法显示值，避免空字符串长期留在控件里。
  function normalizeDraft() {
    const parsed = Number(draft);
    const nextValue = clampNumber(Number.isFinite(parsed) ? parsed : value, min, max);
    setDraftState({ sourceValue: nextValue, draft: String(nextValue) });
    onChange(nextValue);
  }

  return (
    <label className="inline-flex min-h-10 items-center gap-2">
      <input
        className="settings-input w-24 rounded-lg border border-line bg-surface px-3 py-2 text-center"
        inputMode="numeric"
        type="text"
        value={draft}
        onBlur={normalizeDraft}
        onChange={(event) => updateValue(event.target.value)}
      />
      <span className="text-muted">{suffix}</span>
    </label>
  );
}

// 渲染滑杆控件，用于调整主题对比度。
function SliderControl({ max, min, onChange, value }: { max: number; min: number; onChange: (value: number) => void; value: number }) {
  const [draftState, setDraftState] = useState(() => ({ sourceValue: value, draft: value }));
  const draft = draftState.sourceValue === value ? draftState.draft : value;
  const progress = ((draft - min) / (max - min)) * 100;

  // 拖动时只更新本地草稿，让圆球和数值先保持顺滑，不把每一帧都写入 Dexie。
  function updateDraft(nextValue: number) {
    setDraftState({ sourceValue: value, draft: clampNumber(nextValue, min, max) });
  }

  // 松手或失焦时提交最终数值，避免拖动过程中频繁触发父组件持久化。
  function commitValue() {
    const nextValue = clampNumber(draft, min, max);
    setDraftState({ sourceValue: nextValue, draft: nextValue });
    onChange(nextValue);
  }

  return (
    <div className="grid grid-cols-[1fr_44px] items-center gap-3">
      <input
        className="contrast-slider"
        max={max}
        min={min}
        style={{ "--slider-progress": `${progress}%` } as CSSProperties}
        type="range"
        value={draft}
        onBlur={commitValue}
        onChange={(event) => updateDraft(Number(event.target.value))}
        onPointerUp={commitValue}
      />
      <span className="text-right tabular-nums">{draft}</span>
    </div>
  );
}

// 渲染主题卡片内的短文本输入，主要用于字体栈配置。
function InlineTextControl({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  return (
    <input
      className="settings-input w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
      spellCheck={false}
      title={value}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

// 渲染设置导航图标，保持截图里的细线图标气质且不额外引入依赖。
export function SettingsNavIcon({ name, small = false }: { name: SettingsIconName; small?: boolean }) {
  if (name) return <AppIcon name={name} size={small ? 16 : 22} />;
  const size = small ? 16 : 22;
  const common = {
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    width: size,
  };
  const paths: Record<SettingsIconName, ReactNode> = {
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    appearance: <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m0-12.8L7 7m10 10 1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
    configuration: <path d="M4 7h16M7 12h10M10 17h4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />,
    diagnostics: <path d="M4 19h16M6 17l3-7 4 4 3-8 2 5M5 5h14M5 5v14M19 5v14" />,
    mcp: <path d="M7 7h4v4H7zM13 13h4v4h-4zM13 7h4v4h-4zM7 13h4v4H7zM11 9h2M9 11v2M15 11v2M11 15h2" />,
    personalization: <path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM5 21a7 7 0 0 1 14 0M19 8v4m-2-2h4" />,
    plugins: <path d="M9 3h6v5h5v6h-5v7H9v-7H4V8h5V3Z" />,
    dark: <path d="M21 14.5A7.5 7.5 0 0 1 9.5 3a8 8 0 1 0 11.5 11.5Z" />,
    light: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m14.4-6.4 1.4-1.4M4.2 19.8l1.4-1.4m0-12.8L4.2 4.2m15.6 15.6-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
    motion: <path d="M4 12h6m-3-3 3 3-3 3m5-8h4a4 4 0 0 1 0 8h-4" />,
    none: <path d="M5 5l14 14M7 7a8 8 0 0 0 10 10M17 7A8 8 0 0 0 7 17" />,
    system: <path d="M4 5h16v12H4zM8 21h8m-4-4v4" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
