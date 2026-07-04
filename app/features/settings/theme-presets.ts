import { createDefaultAppearanceSettings, DEFAULT_UI_FONT_STACK } from "../../services/appearance-settings-repository";
import type { ThemeConfig } from "../../types/review";

export type ThemePreset = {
  theme: ThemeConfig;
};

const defaults = createDefaultAppearanceSettings();

export const lightThemePresets: ThemePreset[] = [
  { theme: defaults.lightTheme },
  {
    theme: {
      name: "米白",
      accent: "#A06B3B",
      background: "#FAF7F0",
      foreground: "#292524",
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: "ui-monospace, SFMono-Regular, Consolas, monospace",
      diffuseGradient: true,
      contrast: 0,
    },
  },
  {
    theme: {
      name: "薄荷",
      accent: "#16866F",
      background: "#F3FBF8",
      foreground: "#16332D",
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: '"Geist Mono", ui-monospace, monospace',
      diffuseGradient: true,
      contrast: 0,
    },
  },
  {
    theme: {
      name: "晨雾",
      accent: "#6676A8",
      background: "#F5F7FB",
      foreground: "#252A38",
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: '"Geist Mono", ui-monospace, monospace',
      diffuseGradient: true,
      contrast: 0,
    },
  },
];

export const darkThemePresets: ThemePreset[] = [
  { theme: defaults.darkTheme },
  {
    theme: {
      name: "暮紫",
      accent: "#A78BFA",
      background: "#181522",
      foreground: "#F5F0FF",
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: "Consolas, ui-monospace, SFMono-Regular, monospace",
      diffuseGradient: true,
      contrast: 0,
    },
  },
  {
    theme: {
      name: "石墨",
      accent: "#8B9BB4",
      background: "#111113",
      foreground: "#F8FAFC",
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: '"Geist Mono", ui-monospace, monospace',
      diffuseGradient: true,
      contrast: 0,
    },
  },
  {
    theme: {
      name: "夜樱",
      accent: "#E879A6",
      background: "#1B141B",
      foreground: "#FFF1F6",
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: '"Geist Mono", ui-monospace, monospace',
      diffuseGradient: true,
      contrast: 0,
    },
  },
];

// 每次选择预设都返回新对象，避免后续表单写入改动共享预设。
export function cloneTheme(theme: ThemeConfig): ThemeConfig {
  return { ...theme };
}
