import { reviewDb } from "../db/review-db";
import type { AppearanceSettings, ThemeConfig } from "../types/review";

const SETTINGS_ID = "default";

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

// 生成 ISO 时间戳，供外观设置保存时记录最近更新时间。
function nowStamp(): string {
  return new Date().toISOString();
}

// 把百分比限制在 0 到 100 之间，供主题对比度和透明度计算复用。
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// 解析十六进制颜色为 RGB；非法颜色回退到传入默认值，避免 CSS 变量写入坏值。
function hexToRgb(hex: string, fallback: RgbColor): RgbColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return fallback;
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

// 生成 rgba 字符串，用于把强调色和前景色按对比度映射为边框、选中态和差异背景。
function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
}

// 返回截图规格中的浅色主题默认值，避免调用方直接修改共享对象。
function defaultLightTheme(): ThemeConfig {
  return {
    name: "VS Code Plus",
    accent: "#007ACC",
    background: "#FFFFFF",
    foreground: "#000000",
    uiFont: "Geist, Inter, system-ui, sans-serif",
    codeFont: '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
    translucentSidebar: true,
    contrast: 0,
  };
}

// 返回截图规格中的深色主题默认值，供系统深色模式和手动深色模式使用。
function defaultDarkTheme(): ThemeConfig {
  return {
    name: "Codex",
    accent: "#339CFF",
    background: "#181818",
    foreground: "#FFFFFF",
    uiFont: "-apple-system, BlinkMacSystemFont, Geist, Inter, system-ui, sans-serif",
    codeFont: 'ui-monospace, "SFMono-Regular", "Geist Mono", Consolas, monospace',
    translucentSidebar: true,
    contrast: 60,
  };
}

// 创建完整默认外观配置，首次打开或旧数据缺字段时使用。
export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    id: SETTINGS_ID,
    mode: "system",
    lightTheme: defaultLightTheme(),
    darkTheme: defaultDarkTheme(),
    pointerCursor: false,
    reducedMotion: "system",
    uiFontSize: 14,
    codeFontSize: 12,
    diffMarker: "color",
    pet: "codex",
    updatedAt: nowStamp(),
  };
}

// 合并主题字段，保证旧版本 IndexedDB 中缺少的新字段能自动补齐。
function mergeThemeConfig(input: Partial<ThemeConfig> | undefined, fallback: ThemeConfig): ThemeConfig {
  return {
    ...fallback,
    ...input,
    name: input?.name?.trim() || fallback.name,
    accent: input?.accent || fallback.accent,
    background: input?.background || fallback.background,
    foreground: input?.foreground || fallback.foreground,
    uiFont: input?.uiFont?.trim() || fallback.uiFont,
    codeFont: input?.codeFont?.trim() || fallback.codeFont,
    translucentSidebar: input?.translucentSidebar ?? fallback.translucentSidebar,
    contrast: Number.isFinite(input?.contrast) ? Number(input?.contrast) : fallback.contrast,
  };
}

// 归一化外观配置，保护 UI 控件和 CSS 变量不会收到空值或旧结构。
export function normalizeAppearanceSettings(input?: Partial<AppearanceSettings> | null): AppearanceSettings {
  const fallback = createDefaultAppearanceSettings();
  return {
    ...fallback,
    ...input,
    id: SETTINGS_ID,
    mode: input?.mode ?? fallback.mode,
    lightTheme: mergeThemeConfig(input?.lightTheme, fallback.lightTheme),
    darkTheme: mergeThemeConfig(input?.darkTheme, fallback.darkTheme),
    pointerCursor: input?.pointerCursor ?? fallback.pointerCursor,
    reducedMotion: input?.reducedMotion ?? fallback.reducedMotion,
    uiFontSize: Number.isFinite(input?.uiFontSize) ? Number(input?.uiFontSize) : fallback.uiFontSize,
    codeFontSize: Number.isFinite(input?.codeFontSize) ? Number(input?.codeFontSize) : fallback.codeFontSize,
    diffMarker: input?.diffMarker ?? fallback.diffMarker,
    pet: input?.pet ?? fallback.pet,
    updatedAt: input?.updatedAt ?? fallback.updatedAt,
  };
}

// 根据用户选择和系统偏好解析当前真正应该生效的主题。
export function resolveActiveTheme(settings: AppearanceSettings): { key: "light" | "dark"; theme: ThemeConfig } {
  if (settings.mode === "light") return { key: "light", theme: settings.lightTheme };
  if (settings.mode === "dark") return { key: "dark", theme: settings.darkTheme };
  const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? { key: "dark", theme: settings.darkTheme } : { key: "light", theme: settings.lightTheme };
}

// 判断减少动态效果最终是否生效，system 模式跟随浏览器系统设置。
function resolveReducedMotion(settings: AppearanceSettings): boolean {
  if (settings.reducedMotion === "on") return true;
  if (settings.reducedMotion === "off") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 把外观配置写入全局 CSS 变量和 body 数据属性，让 Tailwind 类也能跟随主题变化。
export function applyAppearanceSettings(settings: AppearanceSettings) {
  if (typeof document === "undefined") return;
  const { key, theme } = resolveActiveTheme(settings);
  const root = document.documentElement;
  const body = document.body;
  const isDark = key === "dark";
  const contrast = clampPercent(theme.contrast);
  const accent = hexToRgb(theme.accent, isDark ? { r: 51, g: 156, b: 255 } : { r: 0, g: 122, b: 204 });
  const foreground = hexToRgb(theme.foreground, isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });
  const lineAlpha = isDark ? 0.14 + contrast / 250 : 0.07 + contrast / 360;
  const selectedAlpha = isDark ? 0.16 + contrast / 420 : 0.08 + contrast / 520;
  const hoverAlpha = isDark ? 0.08 + contrast / 640 : 0.05 + contrast / 700;
  const diffAlpha = isDark ? 0.2 + contrast / 460 : 0.14 + contrast / 600;
  const sidebarBg = isDark
    ? theme.translucentSidebar
      ? "linear-gradient(180deg, rgba(24,24,24,0.90) 0%, rgba(24,30,36,0.90) 100%)"
      : "#181818"
    : theme.translucentSidebar
      ? "linear-gradient(180deg, rgba(234,248,251,0.88) 0%, rgba(244,252,216,0.88) 100%)"
      : "#eaf8fb";

  body.dataset.theme = key;
  body.dataset.pointerCursor = settings.pointerCursor ? "true" : "false";
  body.dataset.reducedMotion = resolveReducedMotion(settings) ? "true" : "false";
  root.style.colorScheme = key;
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--foreground", theme.foreground);
  root.style.setProperty("--blue", theme.accent);
  root.style.setProperty("--surface", isDark ? "#202020" : "#ffffff");
  root.style.setProperty("--surface-muted", isDark ? "#262626" : "#f7f8fa");
  root.style.setProperty("--muted", isDark ? "#b8b8b8" : "#667085");
  root.style.setProperty("--line", rgba(foreground, lineAlpha));
  root.style.setProperty("--app-ui-font", theme.uiFont);
  root.style.setProperty("--app-code-font", theme.codeFont);
  root.style.setProperty("--app-ui-font-size", `${settings.uiFontSize}px`);
  root.style.setProperty("--app-code-font-size", `${settings.codeFontSize}px`);
  root.style.setProperty("--settings-sidebar-bg", sidebarBg);
  root.style.setProperty("--settings-sidebar-text", isDark ? "#f4f4f5" : "#11181c");
  root.style.setProperty("--settings-selected-bg", rgba(accent, selectedAlpha));
  root.style.setProperty("--app-sidebar-bg", sidebarBg);
  root.style.setProperty("--app-sidebar-text", isDark ? "#f4f4f5" : "#1f2a2e");
  root.style.setProperty("--app-sidebar-hover", rgba(accent, hoverAlpha));
  root.style.setProperty("--diff-added-bg", isDark ? rgba({ r: 34, g: 197, b: 94 }, diffAlpha) : rgba({ r: 220, g: 252, b: 231 }, 0.78));
  root.style.setProperty("--diff-added-text", isDark ? "#dcfce7" : "#064e3b");
  root.style.setProperty("--diff-added-line", "#16a34a");
  root.style.setProperty("--diff-removed-bg", isDark ? rgba({ r: 248, g: 113, b: 113 }, diffAlpha) : rgba({ r: 254, g: 226, b: 226 }, 0.88));
  root.style.setProperty("--diff-removed-text", isDark ? "#fee2e2" : "#7f1d1d");
  root.style.setProperty("--diff-removed-line", "#ef4444");
}

export const appearanceSettingsRepository = {
  // 读取本地外观设置；不存在时写入一份默认值，方便 DevTools 直接看到表数据。
  async load(): Promise<AppearanceSettings> {
    const saved = await reviewDb.appearanceSettings.get(SETTINGS_ID);
    const settings = normalizeAppearanceSettings(saved);
    if (!saved) {
      await reviewDb.appearanceSettings.put(settings);
    }
    return settings;
  },

  // 保存完整外观设置，并补齐更新时间；调用方负责先把变化反馈到 UI。
  async save(settings: AppearanceSettings): Promise<AppearanceSettings> {
    const normalized = normalizeAppearanceSettings({
      ...settings,
      updatedAt: nowStamp(),
    });
    await reviewDb.appearanceSettings.put(normalized);
    return normalized;
  },
};
