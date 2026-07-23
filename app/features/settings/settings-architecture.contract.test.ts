import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { darkThemePresets, lightThemePresets } from "./theme-presets.ts";

test("设置导航独立展示个性化与额度并兼容旧角色入口", async () => {
  const [source, navigation] = await Promise.all([
    readFile(new URL("./settings-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/use-review-workspace-recovery-navigation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /"personalization"/);
  assert.match(source, /"quota"/);
  assert.match(navigation, /section === "roles" \? "personalization"/);
  assert.match(source, /dynamic\(\(\) => import\("\.\/personalization-settings-view"\)/);
  assert.match(source, /dynamic\(\(\) => import\("\.\/plugins\/quota\/ai-quota-settings-panel"\)/);
});

test("设置分区使用受控单一状态源且不通过异步 effect 回退", async () => {
  const [source, navigation, workspace] = await Promise.all([
    readFile(new URL("./settings-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/use-review-workspace-recovery-navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../review/review-workspace-view-router.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(source, /activeSection: SettingsSectionKey/);
  assert.match(source, /onSectionChange: \(section: SettingsSectionKey\) => void/);
  assert.doesNotMatch(source, /initialSection|setActiveSection|setTimeout\(\(\) => setActiveSection/);
  assert.match(navigation, /const \[settingsSection, setSettingsSection\]/);
  assert.match(workspace, /activeSection=\{workspace\.settingsSection\}/);
  assert.match(workspace, /onSectionChange=\{workspace\.setSettingsSection\}/);
  assert.match(source, /aria-label="设置分区"/);
  assert.match(source, /onSectionChange\(event\.currentTarget\.value as SettingsSectionKey\)/);
});

test("设置核心面板使用确认稿的紧凑表格和按需编辑层", async () => {
  const [defaults, quota, memory, data] = await Promise.all([
    readFile(new URL("./default-capability-selector.tsx", import.meta.url), "utf8"),
    readFile(new URL("./plugins/quota/ai-quota-settings-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("./personal-memory-settings-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../diagnostics/data-management-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(defaults, /primaryPurposes.*"text".*"vision"/);
  assert.match(defaults, /更多默认能力/);
  assert.match(defaults, /manualOpen/);
  assert.doesNotMatch(quota, /<details|<summary/);
  assert.match(quota, /配置\$\{plugin\.label\}额度/);
  assert.match(memory, /添加记忆/);
  assert.match(memory, /role="dialog"/);
  assert.doesNotMatch(data, /window\.confirm/);
});

test("十六个内置主题默认零对比度且切换预设保留弥散开关", async () => {
  const presets = [...lightThemePresets, ...darkThemePresets];
  assert.equal(presets.length, 16);
  assert.equal(presets.every(({ theme }) => theme.contrast === 0 && theme.diffuseGradient === false), true);
  const source = await readFile(new URL("./appearance-settings-view.tsx", import.meta.url), "utf8");
  assert.match(source, /diffuseGradient: theme\.diffuseGradient/);
  assert.doesNotMatch(source, /DiffPreview|settings-code-preview/);
});

test("AI 连接使用紧凑主从表格且详情不展示密钥", async () => {
  const source = await readFile(new URL("./api-connections-settings-view.tsx", import.meta.url), "utf8");
  assert.match(source, /connectionTable/);
  assert.match(source, /连接详情/);
  assert.match(source, /密钥仅保存在本机加密仓储/);
  assert.match(source, />添加连接</);
  assert.doesNotMatch(source, /selectedProfile\.apiKey/);
});
