import { reviewDb } from "../db/review-db.ts";
import type { AppearanceSettings, ThemeConfig } from "../types/review";

const SETTINGS_ID = "default";

export const DEFAULT_UI_FONT_STACK = 'var(--font-noto-sans-sc), "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';

// 这些字体栈只来自旧版内置主题；命中时升级为新默认字体，其他用户自定义值原样保留。
const LEGACY_BUILT_IN_UI_FONTS = new Set([
  "Geist, Inter, system-ui, sans-serif",
  "-apple-system, BlinkMacSystemFont, Geist, Inter, system-ui, sans-serif",
  "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
]);

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type LegacyThemeConfig = Partial<ThemeConfig> & {
  translucentSidebar?: boolean;
};

const LEGACY_PRESET_CONTRAST = new Map<string, number>([
  ["纯白极简", 12],
  ["GitHub Light", 22],
  ["米白极简", 12],
  ["Codex", 60],
  ["VS Code Dark", 54],
  ["Graphite", 72],
]);

const LEGACY_PRESET_NAMES = new Map<string, string>([
  ["纯白极简", "晴空"],
  ["GitHub Light", "晴空"],
  ["米白极简", "米白"],
  ["Codex", "深海"],
  ["VS Code Dark", "石墨"],
  ["Graphite", "石墨"],
]);

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

// 旋转强调色的色相，为弥散背景生成协调但不单调的辅助色。
function shiftHue(color: RgbColor, degrees: number): RgbColor {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  let hue = 0;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  hue = (hue + degrees + 360) % 360;

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const sectors = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ];
  const [shiftedRed, shiftedGreen, shiftedBlue] = sectors[Math.floor(hue / 60) % 6];
  return {
    r: Math.round((shiftedRed + offset) * 255),
    g: Math.round((shiftedGreen + offset) * 255),
    b: Math.round((shiftedBlue + offset) * 255),
  };
}

// 在两个颜色间做线性混合，用主题本身的背景和前景生成稳定的中性侧栏。
function mixRgb(background: RgbColor, foreground: RgbColor, foregroundRatio: number): RgbColor {
  return {
    r: Math.round(background.r * (1 - foregroundRatio) + foreground.r * foregroundRatio),
    g: Math.round(background.g * (1 - foregroundRatio) + foreground.g * foregroundRatio),
    b: Math.round(background.b * (1 - foregroundRatio) + foreground.b * foregroundRatio),
  };
}

// 把 RGB 转回不透明颜色，侧栏不再依赖透明背景或 backdrop-filter。
function rgbHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// 公开侧栏底色解析供迁移契约验证；所有主题遵循同一套中性混合规则。
export function resolveSidebarBackground(theme: ThemeConfig, key: "light" | "dark"): string {
  const isDark = key === "dark";
  const background = hexToRgb(theme.background, isDark ? { r: 24, g: 24, b: 24 } : { r: 255, g: 255, b: 255 });
  const foreground = hexToRgb(theme.foreground, isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });
  return rgbHex(mixRgb(background, foreground, isDark ? 0.055 : 0.035));
}

// 返回截图规格中的浅色主题默认值，避免调用方直接修改共享对象。
function defaultLightTheme(): ThemeConfig {
  return {
    name: "晴空",
    accent: "#2563EB",
    background: "#FFFFFF",
    foreground: "#111827",
    uiFont: DEFAULT_UI_FONT_STACK,
    codeFont: '"Geist Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
    diffuseGradient: false,
    contrast: 0,
  };
}

// 返回截图规格中的深色主题默认值，供系统深色模式和手动深色模式使用。
function defaultDarkTheme(): ThemeConfig {
  return {
    name: "深海",
    accent: "#339CFF",
    background: "#181818",
    foreground: "#FFFFFF",
    uiFont: DEFAULT_UI_FONT_STACK,
    codeFont: 'ui-monospace, "SFMono-Regular", "Geist Mono", Consolas, monospace',
    diffuseGradient: false,
    contrast: 0,
  };
}

// 创建完整默认外观配置，首次打开或旧数据缺字段时使用。
export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    id: SETTINGS_ID,
    mode: "light",
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
function mergeThemeConfig(input: LegacyThemeConfig | undefined, fallback: ThemeConfig): ThemeConfig {
  const savedUiFont = input?.uiFont?.trim();
  const savedContrast = Number.isFinite(input?.contrast) ? Number(input?.contrast) : fallback.contrast;
  const legacyPresetContrast = input?.name ? LEGACY_PRESET_CONTRAST.get(input.name) : undefined;
  return {
    ...fallback,
    ...input,
    name: (LEGACY_PRESET_NAMES.get(input?.name?.trim() ?? "") ?? input?.name?.trim()) || fallback.name,
    accent: input?.accent || fallback.accent,
    background: input?.background || fallback.background,
    foreground: input?.foreground || fallback.foreground,
    uiFont: savedUiFont && !LEGACY_BUILT_IN_UI_FONTS.has(savedUiFont) ? savedUiFont : fallback.uiFont,
    codeFont: input?.codeFont?.trim() || fallback.codeFont,
    diffuseGradient: input?.diffuseGradient ?? input?.translucentSidebar ?? fallback.diffuseGradient,
    contrast: savedContrast === legacyPresetContrast ? 0 : savedContrast,
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
    lightTheme: mergeThemeConfig(input?.lightTheme as LegacyThemeConfig | undefined, fallback.lightTheme),
    darkTheme: mergeThemeConfig(input?.darkTheme as LegacyThemeConfig | undefined, fallback.darkTheme),
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
  const contrastRatio = contrast / 100;
  const accent = hexToRgb(theme.accent, isDark ? { r: 51, g: 156, b: 255 } : { r: 0, g: 122, b: 204 });
  const foreground = hexToRgb(theme.foreground, isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });
  const lineAlpha = isDark ? 0.16 + contrastRatio * 0.2 : 0.07 + contrastRatio * 0.16;
  const selectedAlpha = 0.08 + contrastRatio * 0.12;
  const hoverAlpha = 0.055 + contrastRatio * 0.085;
  const diffAlpha = isDark ? 0.2 + contrastRatio * 0.2 : 0.14 + contrastRatio * 0.12;
  const neutralColor = isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const chromeSelectedColor = accent;
  const chromeBorderAlpha = 0.1 + contrastRatio * 0.16;
  // 通用工作区与侧栏使用同一中性表面，主题背景只负责抬升面下方的窗口底层。
  const workspaceSurface = isDark ? "#202020" : "#ffffff";
  const sidebarBg = workspaceSurface;
  const diffuseEnabled = theme.diffuseGradient;
  const diffuseCompanionOne = shiftHue(accent, 46);
  const diffuseCompanionTwo = shiftHue(accent, -58);
  const diffuseWarm = shiftHue(accent, 156);
  const windowDiffuseBackground = diffuseEnabled
    ? `radial-gradient(ellipse 62% 48% at 8% 8%, ${rgba(accent, isDark ? 0.17 : 0.13)}, transparent 72%), radial-gradient(ellipse 48% 58% at 88% 16%, ${rgba(diffuseCompanionTwo, isDark ? 0.13 : 0.095)}, transparent 74%), radial-gradient(ellipse 58% 46% at 72% 88%, ${rgba(diffuseCompanionOne, isDark ? 0.12 : 0.085)}, transparent 76%), radial-gradient(ellipse 42% 38% at 24% 82%, ${rgba(diffuseWarm, isDark ? 0.095 : 0.06)}, transparent 75%), radial-gradient(ellipse 34% 28% at 54% 44%, ${rgba(accent, isDark ? 0.07 : 0.045)}, transparent 78%)`
    : "none";
  const sidebarDiffuseBackground = diffuseEnabled
    ? `radial-gradient(ellipse 92% 34% at 8% 8%, ${rgba(accent, isDark ? 0.09 : 0.065)}, transparent 76%), radial-gradient(ellipse 86% 38% at 92% 72%, ${rgba(diffuseCompanionTwo, isDark ? 0.065 : 0.04)}, transparent 78%)`
    : "none";
  const scrollbarTrackAlpha = 0.34 + contrastRatio * 0.28;
  const scrollbarThumbAlpha = 0.28 + contrastRatio * 0.38;
  const scrollbarHoverAlpha = 0.44 + contrastRatio * 0.28;

  body.dataset.theme = key;
  body.dataset.diffuseGradient = diffuseEnabled ? "true" : "false";
  body.dataset.pointerCursor = settings.pointerCursor ? "true" : "false";
  body.dataset.reducedMotion = resolveReducedMotion(settings) ? "true" : "false";
  root.style.colorScheme = key;
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--foreground", theme.foreground);
  root.style.setProperty("--blue", theme.accent);
  root.style.setProperty("--surface", workspaceSurface);
  root.style.setProperty("--surface-muted", isDark ? "#262626" : "#f7f8fa");
  root.style.setProperty("--muted", isDark ? "#b8b8b8" : "#667085");
  root.style.setProperty("--line", rgba(foreground, lineAlpha));
  root.style.setProperty("--app-ui-font", theme.uiFont);
  root.style.setProperty("--app-code-font", theme.codeFont);
  root.style.setProperty("--app-ui-font-size", `${settings.uiFontSize}px`);
  root.style.setProperty("--app-code-font-size", `${settings.codeFontSize}px`);
  root.style.setProperty("--chrome-sidebar-width", "248px");
  root.style.setProperty("--chrome-topbar-height", "52px");
  root.style.setProperty("--chrome-window-bg", theme.background);
  root.style.setProperty("--chrome-window-diffuse", windowDiffuseBackground);
  root.style.setProperty("--chrome-topbar-bg", theme.background);
  root.style.setProperty("--chrome-sidebar-bg", sidebarBg);
  root.style.setProperty("--chrome-workspace-surface", workspaceSurface);
  root.style.setProperty("--chrome-sidebar-diffuse", sidebarDiffuseBackground);
  root.style.setProperty("--chrome-sidebar-border", rgba(neutralColor, chromeBorderAlpha));
  root.style.setProperty("--chrome-selected-bg", rgba(chromeSelectedColor, selectedAlpha));
  root.style.setProperty("--chrome-hover-bg", rgba(chromeSelectedColor, hoverAlpha));
  root.style.setProperty("--settings-sidebar-bg", sidebarBg);
  root.style.setProperty("--settings-sidebar-text", isDark ? "#f4f4f5" : "#11181c");
  root.style.setProperty("--settings-selected-bg", rgba(chromeSelectedColor, selectedAlpha));
  root.style.setProperty("--app-sidebar-bg", sidebarBg);
  root.style.setProperty("--app-sidebar-text", isDark ? "#f4f4f5" : "#1f2a2e");
  root.style.setProperty("--app-sidebar-hover", rgba(chromeSelectedColor, hoverAlpha));
  root.style.setProperty("--diff-added-bg", isDark ? rgba({ r: 34, g: 197, b: 94 }, diffAlpha) : rgba({ r: 220, g: 252, b: 231 }, 0.78));
  root.style.setProperty("--diff-added-text", isDark ? "#dcfce7" : "#064e3b");
  root.style.setProperty("--diff-added-line", "#16a34a");
  root.style.setProperty("--diff-removed-bg", isDark ? rgba({ r: 248, g: 113, b: 113 }, diffAlpha) : rgba({ r: 254, g: 226, b: 226 }, 0.88));
  root.style.setProperty("--diff-removed-text", isDark ? "#fee2e2" : "#7f1d1d");
  root.style.setProperty("--diff-removed-line", "#ef4444");
  root.style.setProperty("--settings-scrollbar-track", isDark ? rgba({ r: 44, g: 44, b: 44 }, scrollbarTrackAlpha) : rgba({ r: 244, g: 246, b: 248 }, scrollbarTrackAlpha));
  root.style.setProperty("--settings-scrollbar-thumb", isDark ? rgba({ r: 150, g: 150, b: 150 }, scrollbarThumbAlpha) : rgba({ r: 142, g: 148, b: 154 }, scrollbarThumbAlpha));
  root.style.setProperty("--settings-scrollbar-thumb-hover", isDark ? rgba({ r: 170, g: 170, b: 170 }, scrollbarHoverAlpha) : rgba({ r: 118, g: 124, b: 132 }, scrollbarHoverAlpha));
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
