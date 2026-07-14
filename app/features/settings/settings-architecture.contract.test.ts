import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { darkThemePresets, lightThemePresets } from "./theme-presets.ts";

test("设置导航独立展示角色与额度并兼容旧入口", async () => {
  const source = await readFile(new URL("./settings-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /"roles"/);
  assert.match(source, /"quota"/);
  assert.match(source, /section === "personalization" \? "roles"/);
  assert.match(source, /dynamic\(\(\) => import\("\.\/personalization-settings-view"\)/);
  assert.match(source, /dynamic\(\(\) => import\("\.\/plugins\/quota\/ai-quota-settings-panel"\)/);
});

test("十六个内置主题默认零对比度且切换预设保留弥散开关", async () => {
  const presets = [...lightThemePresets, ...darkThemePresets];
  assert.equal(presets.length, 16);
  assert.equal(presets.every(({ theme }) => theme.contrast === 0 && theme.diffuseGradient === false), true);
  const source = await readFile(new URL("./appearance-settings-view.tsx", import.meta.url), "utf8");
  assert.match(source, /diffuseGradient: theme\.diffuseGradient/);
});
