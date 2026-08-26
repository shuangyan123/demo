import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { darkThemePresets, lightThemePresets } from "./theme-presets.ts";

test("设置导航独立展示个人资料、导入、已安装插件并兼容旧角色入口", async () => {
  const [source, navigation, sectionNavigation] = await Promise.all([
    readFile(new URL("./settings-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/use-review-workspace-recovery-navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("./settings-workspace-navigation.tsx", import.meta.url), "utf8"),
  ]);
  for (const label of ["个人资料", "导入", "已安装插件"]) assert.match(sectionNavigation, new RegExp(label));
  assert.match(source, /"personalization"/);
  assert.match(source, /"quota"/);
  assert.match(navigation, /section === "roles" \? "personalization"/);
  assert.match(source, /dynamic\(\(\) => import\("\.\/personalization-settings-view"\)/);
  assert.match(source, /dynamic\(\(\) => import\("\.\/plugins\/quota\/ai-quota-settings-panel"\)/);
});

test("粉笔导入从项目主导航移到通用导入设置，插件发现与管理语义分离", async () => {
  const [registry, sidebar, importView, secondaryViews, pluginView] = await Promise.all([
    readFile(new URL("../study/study-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../review/review-workspace-app-sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../import/review-import-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/review-workspace-secondary-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("./plugins/settings-plugins-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(registry, /\["import", "knowledge", "stats", "tutoring"\]/);
  assert.match(sidebar, /label: "插件与技能"/);
  assert.match(importView, /<h1>导入<\/h1>[\s\S]*来源：粉笔/);
  assert.match(secondaryViews, /initialMode="browse"/);
  assert.match(pluginView, /initialMode\?: "manage" \| "browse"/);
  assert.match(pluginView, /aria-label="已安装插件管理"/);
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

test("个人资料只从受控元数据生成厂商官方快捷入口", async () => {
  const [profile, shortcuts] = await Promise.all([
    readFile(new URL("./profile-usage-settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../services/provider-shortcuts.ts", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /个人资料 \/ 使用情况/);
  assert.match(profile, /不会使用对话内容或自定义 Base URL/);
  assert.match(profile, /target="_blank" rel="noreferrer"/);
  assert.match(shortcuts, /providerOfficialLinks/);
  assert.match(shortcuts, /getProviderContract\(provider\)\.documentationUrl/);
  assert.doesNotMatch(shortcuts, /baseUrl|connection|modelResponse/);
  assert.doesNotMatch(profile, /connection\.baseUrl/);
});

test("设置内容复用全站唯一外壳且真实示例由当前会话作用域驱动", async () => {
  const [shell, workspace, router, reviewWorkspace, sampleScope, example] = await Promise.all([
    readFile(new URL("../../styles/shell.css", import.meta.url), "utf8"),
    readFile(new URL("./settings-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/review-workspace-view-router.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/review-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../review/use-review-workspace-sample-scope.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/sample-scenario-controls.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(workspace, /WorkspaceShell/);
  assert.match(router, /const settingsMode = workspace\.view === "settings"/);
  assert.match(router, /SettingsWorkspaceSidebar/);
  assert.match(router, /<ReviewWorkspaceShell[\s\S]*\{settingsMode \? \(/);
  assert.match(shell, /--chrome-workspace-top-inset:\s*12px/);
  assert.match(shell, /\.chrome-shell \.chrome-content-frame\s*\{[\s\S]*?height:\s*100%/);
  assert.match(reviewWorkspace, /useReviewWorkspaceSampleScope/);
  assert.match(sampleScope, /PERSONAL_WORKSPACE_DATA_SCOPE/);
  assert.match(sampleScope, /sampleScenarioRepository\.seed/);
  assert.match(example, /UI 审查数据/);
  assert.match(example, /删除审查数据/);
  assert.doesNotMatch(reviewWorkspace, /ui-preview/);
});
