"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useEffect, useState } from "react";
import { providerPresets } from "../services/api-client";
import { createDefaultAppearanceSettings } from "../services/appearance-settings-repository";
import type { ApiProvider, ApiSetting, ApiSettingsForm, AppearanceSettings, ThemeConfig } from "../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
type SettingsSectionKey =
  | "general"
  | "profile"
  | "appearance"
  | "configuration"
  | "personalization"
  | "shortcuts"
  | "mcp"
  | "hooks"
  | "connections"
  | "git"
  | "environment"
  | "workspace"
  | "browser"
  | "computer"
  | "archived"
  | "usage";
type SettingsIconName = SettingsSectionKey | "back";

const settingsSections: Array<{ key: SettingsSectionKey; label: string; icon: SettingsIconName }> = [
  { key: "general", label: "常规", icon: "general" },
  { key: "profile", label: "个人资料", icon: "profile" },
  { key: "appearance", label: "外观", icon: "appearance" },
  { key: "configuration", label: "配置", icon: "configuration" },
  { key: "personalization", label: "个性化", icon: "personalization" },
  { key: "shortcuts", label: "键盘快捷键", icon: "shortcuts" },
  { key: "mcp", label: "MCP 服务器", icon: "mcp" },
  { key: "hooks", label: "钩子", icon: "hooks" },
  { key: "connections", label: "连接", icon: "connections" },
  { key: "git", label: "Git", icon: "git" },
  { key: "environment", label: "环境", icon: "environment" },
  { key: "workspace", label: "工作树", icon: "workspace" },
  { key: "browser", label: "浏览器", icon: "browser" },
  { key: "computer", label: "电脑操控", icon: "computer" },
  { key: "archived", label: "已归档对话", icon: "archived" },
  { key: "usage", label: "使用情况和计费", icon: "usage" },
];

const placeholderCopy: Record<Exclude<SettingsSectionKey, "appearance" | "configuration">, string> = {
  general: "这里会承载应用启动、默认行为和本地数据策略。",
  profile: "这里会承载本地个人资料和显示名称等信息。",
  personalization: "这里会承载个性化偏好和复盘体验细节。",
  shortcuts: "这里会承载快捷键查看与自定义。",
  mcp: "这里会承载后续 MCP 服务状态和接入说明。",
  hooks: "这里会承载自动化钩子和导入处理流程。",
  connections: "这里会承载外部连接状态；AI/OCR API 已放在配置页。",
  git: "这里会承载项目版本管理相关设置。",
  environment: "这里会承载运行环境和本地路径信息。",
  workspace: "这里会承载工作区和数据目录设置。",
  browser: "这里会承载浏览器验证与预览偏好。",
  computer: "这里会承载电脑操控相关权限说明。",
  archived: "这里会承载归档记录入口。",
  usage: "这里会承载使用情况统计入口。",
};

type SettingsWorkspaceProps = {
  apiSetting?: ApiSetting;
  appearanceSettings: AppearanceSettings;
  form: ApiSettingsForm;
  settingsBusy: boolean;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onBack: () => void;
  onChangeForm: (form: ApiSettingsForm) => void;
  onClearLocalRecords: () => void;
  onSaveApi: (event: SubmitReactEvent) => void;
  onTestApi: () => void;
};

type ThemePreset = {
  theme: ThemeConfig;
};

const lightThemePresets: ThemePreset[] = [
  {
    theme: createDefaultAppearanceSettings().lightTheme,
  },
  {
    theme: {
      name: "GitHub Light",
      accent: "#0969DA",
      background: "#FFFFFF",
      foreground: "#24292F",
      uiFont: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
      codeFont: "ui-monospace, SFMono-Regular, Consolas, monospace",
      translucentSidebar: true,
      contrast: 22,
    },
  },
  {
    theme: {
      name: "Minimal Light",
      accent: "#111827",
      background: "#FFFFFF",
      foreground: "#111827",
      uiFont: "Geist, Inter, system-ui, sans-serif",
      codeFont: '"Geist Mono", ui-monospace, monospace',
      translucentSidebar: false,
      contrast: 12,
    },
  },
];

const darkThemePresets: ThemePreset[] = [
  {
    theme: createDefaultAppearanceSettings().darkTheme,
  },
  {
    theme: {
      name: "VS Code Dark",
      accent: "#007ACC",
      background: "#1E1E1E",
      foreground: "#F3F4F6",
      uiFont: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
      codeFont: "Consolas, ui-monospace, SFMono-Regular, monospace",
      translucentSidebar: true,
      contrast: 54,
    },
  },
  {
    theme: {
      name: "Graphite",
      accent: "#A78BFA",
      background: "#111113",
      foreground: "#F8FAFC",
      uiFont: "Geist, Inter, system-ui, sans-serif",
      codeFont: '"Geist Mono", ui-monospace, monospace',
      translucentSidebar: false,
      contrast: 72,
    },
  },
];

// 复制主题对象，避免预设对象被后续表单输入直接改写。
function cloneTheme(theme: ThemeConfig): ThemeConfig {
  return { ...theme };
}

// 判断输入是否为完整十六进制颜色，避免非法颜色写入 CSS 变量。
function isValidHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

// 把数字限制在控件允许范围内，防止字号和对比度写入异常值。
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// 清洗导入主题 JSON，只接受主题允许的字段和合法颜色。
function sanitizeImportedTheme(input: Partial<ThemeConfig>): Partial<ThemeConfig> {
  const patch: Partial<ThemeConfig> = {};
  if (typeof input.name === "string" && input.name.trim()) patch.name = input.name.trim();
  if (typeof input.accent === "string" && isValidHexColor(input.accent)) patch.accent = input.accent.trim().toUpperCase();
  if (typeof input.background === "string" && isValidHexColor(input.background)) patch.background = input.background.trim().toUpperCase();
  if (typeof input.foreground === "string" && isValidHexColor(input.foreground)) patch.foreground = input.foreground.trim().toUpperCase();
  if (typeof input.uiFont === "string" && input.uiFont.trim()) patch.uiFont = input.uiFont.trim();
  if (typeof input.codeFont === "string" && input.codeFont.trim()) patch.codeFont = input.codeFont.trim();
  if (typeof input.translucentSidebar === "boolean") patch.translucentSidebar = input.translucentSidebar;
  if (Number.isFinite(input.contrast)) patch.contrast = clampNumber(Number(input.contrast), 0, 100);
  return patch;
}

// 渲染设置工作台，负责内部设置导航、返回应用和当前设置分类内容。
export function SettingsWorkspace({
  apiSetting,
  appearanceSettings,
  form,
  settingsBusy,
  onAppearanceChange,
  onBack,
  onChangeForm,
  onClearLocalRecords,
  onSaveApi,
  onTestApi,
}: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("appearance");
  const [toast, setToast] = useState("");
  const activeMeta = settingsSections.find((item) => item.key === activeSection);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 写入短提示，用于复制主题、导入主题和保存失败这类轻量反馈。
  function notify(message: string) {
    setToast(message);
  }

  // 根据设置导航选中项决定右侧具体内容，避免占位分类误用真实配置数据。
  function renderSection() {
    if (activeSection === "appearance") {
      return <AppearanceSettingsView settings={appearanceSettings} onChange={onAppearanceChange} onNotify={notify} />;
    }
    if (activeSection === "configuration") {
      return (
        <ConfigurationSettingsView
          apiSetting={apiSetting}
          form={form}
          settingsBusy={settingsBusy}
          onChangeForm={onChangeForm}
          onClearLocalRecords={onClearLocalRecords}
          onSave={onSaveApi}
          onTest={onTestApi}
        />
      );
    }
    return <PlaceholderSettingsView title={activeMeta?.label ?? "设置"}>{placeholderCopy[activeSection]}</PlaceholderSettingsView>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <WindowMenuBar />
      <div className="grid min-h-[calc(100vh-44px)] grid-cols-[216px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="sticky top-[44px] flex h-[calc(100vh-44px)] flex-col overflow-y-auto bg-[var(--settings-sidebar-bg)] px-4 py-4 text-[var(--settings-sidebar-text)] max-lg:static max-lg:h-auto max-lg:overflow-visible">
          <button
            className="mb-5 grid min-h-10 grid-cols-[26px_1fr] items-center gap-2 rounded-xl px-2 text-left text-[17px] text-muted transition hover:bg-[var(--settings-selected-bg)]"
            type="button"
            onClick={onBack}
          >
            <SettingsNavIcon name="back" />
            <span>返回应用</span>
          </button>

          <nav className="scrollbar-none grid gap-1 max-lg:flex max-lg:overflow-x-auto max-lg:pb-2" aria-label="设置导航">
            {settingsSections.map((item) => (
              <button
                key={item.key}
                className={`grid min-h-11 grid-cols-[28px_1fr] items-center gap-3 rounded-xl px-2 text-left text-[17px] font-medium transition max-lg:min-w-36 ${
                  activeSection === item.key ? "bg-[var(--settings-selected-bg)] text-[var(--settings-sidebar-text)]" : "hover:bg-[var(--settings-selected-bg)]"
                }`}
                type="button"
                onClick={() => setActiveSection(item.key)}
              >
                <SettingsNavIcon name={item.icon} />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-content min-w-0 overflow-y-auto px-6 py-[92px] max-lg:px-4 max-lg:py-8">
          <div className="mx-auto max-w-[1008px]">{renderSection()}</div>
        </main>
      </div>
      {toast && <div className="fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-full border border-line bg-[var(--surface)] px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}

// 渲染仿 Codex 桌面菜单栏；第一版作为视觉壳，不展开菜单。
function WindowMenuBar() {
  return (
    <header className="sticky top-0 z-40 flex h-11 items-center gap-5 border-b border-line bg-[var(--settings-sidebar-bg)] px-3 text-[17px] text-muted">
      <WindowGlyph />
      <button className="rounded-lg p-1 transition hover:bg-[var(--settings-selected-bg)]" type="button" aria-label="后退">
        <SettingsNavIcon name="back" small />
      </button>
      <button className="rounded-lg p-1 text-muted/50" type="button" aria-label="前进" disabled>
        <span className="block rotate-180">
          <SettingsNavIcon name="back" small />
        </span>
      </button>
      <nav className="flex items-center gap-9 max-sm:gap-5" aria-label="窗口菜单">
        {["文件", "编辑", "查看", "窗口"].map((label) => (
          <button key={label} className="text-muted transition hover:text-foreground" type="button">
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

// 渲染菜单栏最左侧的小窗口图标，复刻参考图里的桌面应用入口。
function WindowGlyph() {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-lg border border-muted/60">
      <span className="h-3 w-1 rounded-sm border border-muted/70" />
    </span>
  );
}

type AppearanceSettingsViewProps = {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  onNotify: (message: string) => void;
};

// 渲染外观页，并把每次控件变化提升给父组件保存和应用到 CSS 变量。
function AppearanceSettingsView({ settings, onChange, onNotify }: AppearanceSettingsViewProps) {
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
      <h1 className="text-2xl font-semibold">外观</h1>

      <div className="mt-16 overflow-hidden rounded-xl border border-line bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 max-md:flex-col max-md:items-stretch">
          <div>
            <h2 className="text-base font-semibold">主题</h2>
            <p className="mt-1 text-sm text-muted">使用浅色、深色，或匹配系统设置</p>
          </div>
          <SegmentedControl
            value={settings.mode}
            options={[
              ["light", "浅色", "appearance"],
              ["dark", "深色", "profile"],
              ["system", "系统", "browser"],
            ]}
            onChange={(value) => updateSettings({ mode: value as AppearanceSettings["mode"] })}
          />
        </div>

        <DiffPreview marker={settings.diffMarker} />

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
          control={<ToggleSwitch checked={settings.pointerCursor} onChange={(checked) => updateSettings({ pointerCursor: checked })} />}
        />
        <SettingsRow
          title="减少动态效果"
          description="减少动画效果或匹配系统设置"
          control={
            <SegmentedControl
              value={settings.reducedMotion}
              options={[
                ["system", "系统", "browser"],
                ["on", "开启", "general"],
                ["off", "关闭", "archived"],
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
          description="调整聊天和差异视图中代码使用的基准字号"
          control={<NumberControl value={settings.codeFontSize} min={10} max={18} suffix="px" onChange={(value) => updateSettings({ codeFontSize: value })} />}
        />
        <SettingsRow
          title="差异标记"
          description='使用彩色条和背景，或在每个更改行上显示 "+" 和 "-" 符号'
          control={
            <SegmentedControl
              value={settings.diffMarker}
              options={[
                ["color", "颜色", "appearance"],
                ["symbol", "+/-", "git"],
              ]}
              onChange={(value) => updateSettings({ diffMarker: value as AppearanceSettings["diffMarker"] })}
            />
          }
        />
      </div>

      <details className="mt-7 rounded-xl border border-line bg-[var(--surface)] px-5 py-4">
        <summary className="cursor-pointer list-none text-base font-semibold">宠物</summary>
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">已选择 {settings.pet === "codex" ? "Codex" : "无"}</p>
          <SegmentedControl
            value={settings.pet}
            options={[
              ["codex", "Codex", "profile"],
              ["none", "无", "archived"],
            ]}
            onChange={(value) => updateSettings({ pet: value as AppearanceSettings["pet"] })}
          />
        </div>
      </details>
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

// 渲染单个主题卡片，提供颜色、字体、侧栏透明和对比度编辑能力。
function ThemeEditor({ label, presets, theme, themeKey, onChange, onNotify, onReset }: ThemeEditorProps) {
  // 导入 JSON 主题片段，用于快速复用本地保存的主题配置。
  async function importTheme(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ThemeConfig>;
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
    onChange(themeKey, preset ? cloneTheme(preset.theme) : { name });
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
          <select
            className="min-h-10 min-w-64 rounded-xl border border-line bg-[var(--surface-muted)] px-3 text-sm max-md:min-w-0"
            value={theme.name}
            onChange={(event) => selectPreset(event.target.value)}
          >
            {presets.map((preset) => (
              <option key={preset.theme.name}>{preset.theme.name}</option>
            ))}
            {!presets.some((preset) => preset.theme.name === theme.name) && <option>{theme.name}</option>}
          </select>
        </div>
      </div>

      <ColorSetting label="强调色" value={theme.accent} onChange={(value) => onChange(themeKey, { accent: value })} />
      <ColorSetting label="背景" value={theme.background} onChange={(value) => onChange(themeKey, { background: value })} />
      <ColorSetting label="前景" value={theme.foreground} onChange={(value) => onChange(themeKey, { foreground: value })} />
      <SettingsRow title="UI 字体" control={<InlineTextControl value={theme.uiFont} onChange={(value) => onChange(themeKey, { uiFont: value })} />} />
      <SettingsRow title="代码字体" control={<InlineTextControl value={theme.codeFont} onChange={(value) => onChange(themeKey, { codeFont: value })} />} />
      <SettingsRow
        title="半透明侧边栏"
        control={<ToggleSwitch checked={theme.translucentSidebar} onChange={(checked) => onChange(themeKey, { translucentSidebar: checked })} />}
      />
      <SettingsRow
        title="对比度"
        control={<SliderControl value={theme.contrast} min={0} max={100} onChange={(value) => onChange(themeKey, { contrast: value })} />}
      />
    </section>
  );
}

type ConfigurationSettingsViewProps = {
  apiSetting?: ApiSetting;
  form: ApiSettingsForm;
  settingsBusy: boolean;
  onChangeForm: (form: ApiSettingsForm) => void;
  onClearLocalRecords: () => void;
  onSave: (event: SubmitReactEvent) => void;
  onTest: () => void;
};

// 渲染配置页，把原应用内 API 设置搬入设置工作台。
function ConfigurationSettingsView({
  apiSetting,
  form,
  settingsBusy,
  onChangeForm,
  onClearLocalRecords,
  onSave,
  onTest,
}: ConfigurationSettingsViewProps) {
  // 合并 API 表单局部变更，确保 Key 输入框保持受控且默认隐藏。
  function updateForm(patch: Partial<ApiSettingsForm>) {
    onChangeForm({ ...form, ...patch });
  }

  // 切换厂商时带出默认 Base URL 和模型，减少手动输入成本。
  function changeProvider(value: string) {
    const provider = value as ApiProvider;
    const preset = providerPresets.find((item) => item.provider === provider);
    updateForm({
      provider,
      baseUrl: preset?.baseUrl ?? form.baseUrl,
      model: preset?.model ?? form.model,
    });
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold">配置</h1>
      <div className="mt-16 grid grid-cols-[minmax(0,1fr)_320px] gap-5 max-xl:grid-cols-1">
        <form className="rounded-xl border border-line bg-[var(--surface)] p-5" onSubmit={onSave}>
          <p className="text-xs font-semibold uppercase text-muted">OpenAI-compatible</p>
          <h2 className="mt-1 text-lg font-semibold">应用内 API 设置</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            <SettingsSelectField label="厂商" name="provider" value={form.provider} options={providerPresets.map((item) => [item.provider, item.label])} onChange={changeProvider} />
            <SettingsTextField label="模型" name="model" autoComplete="off" value={form.model} onChange={(value) => updateForm({ model: value })} required />
          </div>
          <div className="mt-4">
            <SettingsTextField label="Base URL" name="baseUrl" autoComplete="url" type="url" value={form.baseUrl} onChange={(value) => updateForm({ baseUrl: value })} required />
          </div>
          <div className="mt-4">
            <SettingsTextField
              label="API Key"
              name="apiKey"
              type="password"
              autoComplete="current-password"
              value={form.apiKey}
              placeholder={apiSetting ? `已保存：${apiSetting.maskedKey}，留空则保留` : "首次保存需要填写"}
              onChange={(value) => updateForm({ apiKey: value })}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="rounded-xl bg-blue px-4 py-2 font-semibold text-white disabled:opacity-60" type="submit" disabled={settingsBusy}>
              保存设置
            </button>
            <button className="rounded-xl border border-line bg-[var(--surface)] px-4 py-2 font-semibold disabled:opacity-60" type="button" disabled={settingsBusy || !apiSetting} onClick={onTest}>
              测试连接
            </button>
          </div>
        </form>

        <section className="rounded-xl border border-line bg-[var(--surface)] p-5">
          <p className="text-xs font-semibold uppercase text-muted">Security</p>
          <h2 className="mt-1 text-lg font-semibold">当前状态</h2>
          <div className="mt-5 grid gap-3 text-sm">
            <StatusRow label="Key 显示" value={apiSetting?.maskedKey ?? "未配置"} />
            <StatusRow label="存储方式" value="Web Crypto AES-GCM" />
            <StatusRow label="更新时间" value={apiSetting?.updatedAt ?? "-"} />
            <StatusRow label="测试状态" value={apiSetting?.testMessage ?? apiSetting?.testStatus ?? "未测试"} />
            <button className="mt-3 rounded-xl border border-red/30 bg-[var(--surface)] px-4 py-2 font-semibold text-red" type="button" onClick={onClearLocalRecords}>
              清空错题和导入记录
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

// 渲染尚未完整接入的设置分类，保留导航结构但避免伪造功能。
function PlaceholderSettingsView({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-16 rounded-xl border border-line bg-[var(--surface)] p-6">
        <p className="text-sm leading-6 text-muted">{children}</p>
      </div>
    </section>
  );
}

// 渲染代码差异预览，让差异标记设置可以即时反映到示例区域。
function DiffPreview({ marker }: { marker: AppearanceSettings["diffMarker"] }) {
  const showSymbol = marker === "symbol";
  return (
    <div className="grid grid-cols-2 overflow-hidden border-b border-line font-mono text-[var(--app-code-font-size)] max-md:grid-cols-1">
      <pre className="m-0 overflow-x-auto border-r border-line bg-[var(--surface-muted)] p-0 max-md:border-r-0 max-md:border-b">
        {[
          ["1", "const themePreview: ThemeConfig = {"],
          ["2", '  surface: "sidebar",'],
          ["3", '  accent: "#2563eb",'],
          ["4", "  contrast: 42,"],
          ["5", "};"],
        ].map(([line, code], index) => (
          <DiffLine key={line} code={code} line={line} marker={showSymbol && index > 0 && index < 4 ? "-" : ""} tone={index > 0 && index < 4 ? "removed" : "neutral"} />
        ))}
      </pre>
      <pre className="m-0 overflow-x-auto bg-[var(--surface-muted)] p-0">
        {[
          ["1", "const themePreview: ThemeConfig = {"],
          ["2", '  surface: "sidebar-elevated",'],
          ["3", '  accent: "#0ea5e9",'],
          ["4", "  contrast: 68,"],
          ["5", "};"],
        ].map(([line, code], index) => (
          <DiffLine key={line} code={code} line={line} marker={showSymbol && index > 0 && index < 4 ? "+" : ""} tone={index > 0 && index < 4 ? "added" : "neutral"} />
        ))}
      </pre>
    </div>
  );
}

// 渲染差异预览中的单行代码，按颜色或符号模式展示变更。
function DiffLine({ code, line, marker, tone }: { code: string; line: string; marker: string; tone: "added" | "removed" | "neutral" }) {
  const toneStyle =
    tone === "added"
      ? { background: "var(--diff-added-bg)", color: "var(--diff-added-text)" }
      : tone === "removed"
        ? { background: "var(--diff-removed-bg)", color: "var(--diff-removed-text)" }
        : undefined;
  const stripeColor = tone === "added" ? "var(--diff-added-line)" : tone === "removed" ? "var(--diff-removed-line)" : "transparent";
  return (
    <span className="grid grid-cols-[4px_44px_24px_minmax(420px,1fr)] px-0 py-1" style={toneStyle}>
      <span aria-hidden="true" style={{ background: stripeColor }} />
      <span className="text-right text-muted">{line}</span>
      <span className="text-center">{marker}</span>
      <code>{code}</code>
    </span>
  );
}

// 渲染通用设置行，左侧为说明，右侧为具体控件。
function SettingsRow({ control, description, title }: { control: ReactNode; description?: string; title: string }) {
  return (
    <div className="grid min-h-16 grid-cols-[1fr_minmax(220px,320px)] items-center gap-5 border-t border-line px-5 py-3 max-md:grid-cols-1 max-md:items-stretch">
      <div>
        <div className="font-medium">{title}</div>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="justify-self-end max-md:justify-self-stretch">{control}</div>
    </div>
  );
}

// 渲染颜色设置行，同时提供取色器和十六进制文本输入。
function ColorSetting({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draftState, setDraftState] = useState(() => ({ sourceValue: value, draft: value.toUpperCase() }));
  const normalizedValue = isValidHexColor(value) ? value.toUpperCase() : "#000000";
  const draft = draftState.sourceValue === value ? draftState.draft : normalizedValue;
  const isDraftValid = isValidHexColor(draft);

  // 文本框允许用户临时输入半截颜色；只有合法十六进制值才写回主题。
  function updateDraft(nextValue: string) {
    const nextDraft = nextValue.trim().toUpperCase();
    if (isValidHexColor(nextDraft)) {
      setDraftState({ sourceValue: nextDraft, draft: nextDraft });
      onChange(nextDraft);
    } else {
      setDraftState({ sourceValue: value, draft: nextDraft });
    }
  }

  return (
    <SettingsRow
      title={label}
      control={
        <div>
          <label
            className={`flex min-h-10 items-center gap-3 rounded-xl border bg-[var(--surface-muted)] px-3 ${
              isDraftValid ? "border-line" : "border-red/60"
            }`}
          >
            <input className="h-6 w-6 rounded-full border border-line bg-transparent" type="color" value={normalizedValue} onChange={(event) => updateDraft(event.target.value)} />
            <input
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
              aria-invalid={!isDraftValid}
              spellCheck={false}
              value={draft}
              onBlur={() => setDraftState({ sourceValue: normalizedValue, draft: normalizedValue })}
              onChange={(event) => updateDraft(event.target.value)}
            />
          </label>
          {!isDraftValid && <p className="mt-1 text-xs text-red">请输入 #RRGGBB 格式</p>}
        </div>
      }
    />
  );
}

// 渲染轻量分段控件，用于主题模式、动态效果和差异标记。
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
    <div className="inline-flex rounded-full bg-[var(--surface-muted)] p-1">
      {options.map(([optionValue, label, icon]) => (
        <button
          key={optionValue}
          className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-sm transition ${
            value === optionValue ? "bg-[var(--surface)] text-foreground shadow-sm" : "text-muted hover:text-foreground"
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
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      className={`relative h-8 w-14 rounded-full transition ${checked ? "bg-blue" : "bg-slate-200"}`}
      role="switch"
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${checked ? "left-7" : "left-1"}`} />
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
        className="w-24 rounded-xl border border-line bg-[var(--surface)] px-3 py-2 text-center"
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
  return (
    <div className="grid grid-cols-[1fr_44px] items-center gap-3">
      <input className="accent-blue" max={max} min={min} type="range" value={value} onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))} />
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

// 渲染主题卡片内的短文本输入，主要用于字体栈配置。
function InlineTextControl({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  return (
    <input
      className="w-full rounded-xl border border-line bg-[var(--surface)] px-3 py-2 text-sm"
      spellCheck={false}
      title={value}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

// 渲染配置页的状态行，处理较长的 Key 脱敏文本和测试信息。
function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
      <span className="text-muted">{label}</span>
      <strong className="break-all font-medium">{value}</strong>
    </div>
  );
}

// 渲染配置页使用的单行输入框。
function SettingsTextField({
  autoComplete,
  label,
  name,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  autoComplete?: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <input
        className="rounded-xl border border-line bg-[var(--surface)] px-3 py-2.5"
        autoComplete={autoComplete}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  );
}

// 渲染配置页使用的下拉选择框。
function SettingsSelectField({
  label,
  name,
  onChange,
  options,
  value,
}: {
  label: string;
  name?: string;
  onChange: (value: string) => void;
  options: Array<[string, string]> | string[];
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <select className="rounded-xl border border-line bg-[var(--surface)] px-3 py-2.5" name={name} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

// 渲染设置导航图标，保持截图里的细线图标气质且不额外引入依赖。
function SettingsNavIcon({ name, small = false }: { name: SettingsIconName; small?: boolean }) {
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
    general: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v3m0 12v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M3 12h3m12 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />,
    profile: <path d="M18 20a6 6 0 0 0-12 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />,
    appearance: <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m0-12.8L7 7m10 10 1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
    configuration: <path d="M4 7h16M7 12h10M10 17h4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />,
    personalization: <path d="M4 14c5-8 11-8 16 0M8 15a4 4 0 0 0 8 0M12 3v3" />,
    shortcuts: <path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 8h4m-2-2v4" />,
    mcp: <path d="m8 7 4-4 4 4M12 3v13M5 13l7 8 7-8" />,
    hooks: <path d="M8 4c0 7-4 7-4 12a4 4 0 0 0 8 0V4m0 12a4 4 0 0 0 8 0c0-5-4-5-4-12" />,
    connections: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c3 3 4 6 4 10s-1 7-4 10M2 12h20M4 7h16M4 17h16" />,
    git: <path d="M6 3v6m0 0a3 3 0 1 0 0 .1M18 15a3 3 0 1 0 0 .1M6 9c0 4 12 2 12 6" />,
    environment: <path d="M5 7h14M5 17h14M7 7v10m10-10v10M4 5h16v14H4z" />,
    workspace: <path d="M4 4h7v7H4zM13 13h7v7h-7zM14 4h6v6M4 20h6v-6" />,
    browser: <path d="M4 6h16v12H4zM4 9h16M8 6v3" />,
    computer: <path d="M9 3 5 7l4 4M15 13l4 4-4 4M14 5h4v4M10 19H6v-4" />,
    archived: <path d="M4 7h16M6 7v12h12V7M9 11h6M5 4h14v3H5z" />,
    usage: <path d="M4 19a8 8 0 1 1 16 0M12 19l4-7" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
