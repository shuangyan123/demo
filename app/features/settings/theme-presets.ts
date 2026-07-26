import { createDefaultAppearanceSettings } from "../../services/appearance-settings-repository.ts";
import { DEFAULT_CODE_FONT_STACK, DEFAULT_UI_FONT_STACK } from "../../services/appearance-theme-fonts.ts";
import type { ThemeConfig } from "../../types/domains/appearance.ts";

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
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
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
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
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
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
      contrast: 0,
    },
  },
  ...[
    ["桃雾", "#C85D72", "#FFF6F7", "#3C2329"],
    ["琥珀", "#B66A18", "#FFF8EE", "#382713"],
    ["淡紫", "#7562B8", "#F8F6FC", "#2E2A3C"],
    ["海盐", "#0B7EA4", "#F2FAFC", "#17313A"],
  ].map(([name, accent, background, foreground]) => ({
    theme: {
      name,
      accent,
      background,
      foreground,
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
      contrast: 0,
    },
  })),
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
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
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
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
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
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
      contrast: 0,
    },
  },
  ...[
    ["极光", "#45D6B5", "#101B1A", "#ECFFFA"],
    ["靛夜", "#7C9BFF", "#11172A", "#F3F6FF"],
    ["熔金", "#F3A847", "#1D1710", "#FFF6E8"],
    ["松林", "#72C98B", "#121A15", "#F0FFF4"],
  ].map(([name, accent, background, foreground]) => ({
    theme: {
      name,
      accent,
      background,
      foreground,
      uiFont: DEFAULT_UI_FONT_STACK,
      codeFont: DEFAULT_CODE_FONT_STACK,
      diffuseGradient: false,
      contrast: 0,
    },
  })),
];

// 每次选择预设都返回新对象，避免后续表单写入改动共享预设。
export function cloneTheme(theme: ThemeConfig): ThemeConfig {
  return { ...theme };
}
