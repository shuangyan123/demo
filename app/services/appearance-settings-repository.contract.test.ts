import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultAppearanceSettings,
  DEFAULT_UI_FONT_STACK,
  normalizeAppearanceSettings,
  resolveSidebarBackground,
} from "./appearance-settings-repository.ts";

/** 验证旧内置字体栈只迁移到新的中文默认字体。 */
test("旧内置主题字体栈升级为 Noto Sans SC", () => {
  const defaults = createDefaultAppearanceSettings();
  const normalized = normalizeAppearanceSettings({
    ...defaults,
    lightTheme: { ...defaults.lightTheme, uiFont: "Geist, Inter, system-ui, sans-serif" },
    darkTheme: { ...defaults.darkTheme, uiFont: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif" },
  });
  assert.equal(normalized.lightTheme.uiFont, DEFAULT_UI_FONT_STACK);
  assert.equal(normalized.darkTheme.uiFont, DEFAULT_UI_FONT_STACK);
});

/** 验证用户手写字体不会被内置迁移覆盖。 */
test("用户自定义主题字体保留原值", () => {
  const defaults = createDefaultAppearanceSettings();
  const normalized = normalizeAppearanceSettings({
    ...defaults,
    lightTheme: { ...defaults.lightTheme, uiFont: '"Custom Chinese Font", sans-serif' },
  });
  assert.equal(normalized.lightTheme.uiFont, '"Custom Chinese Font", sans-serif');
});

/** 验证所有新建内置主题的对比度从零开始。 */
test("新建内置主题对比度默认为零", () => {
  const defaults = createDefaultAppearanceSettings();
  assert.equal(defaults.lightTheme.contrast, 0);
  assert.equal(defaults.darkTheme.contrast, 0);
});

/** 验证旧侧栏开关只作为迁移输入读取。 */
test("旧侧栏字段迁移为弥散渐变", () => {
  const defaults = createDefaultAppearanceSettings();
  const normalized = normalizeAppearanceSettings({
    ...defaults,
    lightTheme: { ...defaults.lightTheme, diffuseGradient: undefined, translucentSidebar: true } as unknown as typeof defaults.lightTheme,
  });
  assert.equal(normalized.lightTheme.diffuseGradient, true);
});

/** 验证历史预设名称统一为中文，用户改过的对比度不被误清零。 */
test("历史主题改名且仅历史预设对比度归零", () => {
  const defaults = createDefaultAppearanceSettings();
  const migrated = normalizeAppearanceSettings({
    ...defaults,
    lightTheme: { ...defaults.lightTheme, name: "GitHub Light", contrast: 22 },
    darkTheme: { ...defaults.darkTheme, name: "Graphite", contrast: 35 },
  });
  assert.equal(migrated.lightTheme.name, "晴空");
  assert.equal(migrated.lightTheme.contrast, 0);
  assert.equal(migrated.darkTheme.name, "石墨");
  assert.equal(migrated.darkTheme.contrast, 35);
});

/** 验证 GitHub Light 迁移后不再锁定侧栏色，也不禁用弥散。 */
test("GitHub Light 迁移为可编辑晴空主题", () => {
  const defaults = createDefaultAppearanceSettings();
  const migrated = normalizeAppearanceSettings({
    ...defaults,
    lightTheme: {
      ...defaults.lightTheme,
      name: "GitHub Light",
      background: "#FFF7ED",
      foreground: "#431407",
      diffuseGradient: true,
    },
  });
  assert.equal(migrated.lightTheme.name, "晴空");
  assert.equal(migrated.lightTheme.diffuseGradient, true);
  assert.notEqual(resolveSidebarBackground(migrated.lightTheme, "light"), "#f6f8fa");
});
