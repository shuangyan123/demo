import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource() {
  return readFile(new URL("./api-connections-settings-view.tsx", import.meta.url), "utf8");
}

test("AI 连接编辑器、默认模型选择器和紧凑测试卡保持独立边界", async () => {
  const [source, defaults, compactCard] = await Promise.all([
    readSource(),
    readFile(new URL("./default-capability-selector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../shared/ai-interaction/compact-ai-test-card.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(source, /DefaultCapabilitySelector/);
  assert.match(source, /testConnectionDraft/);
  assert.match(source, /existingConnection/);
  assert.doesNotMatch(source, /generateWithConnection/);
  assert.match(defaults, /setDefaultSelection/);
  assert.match(defaults, /BrandedOptionSelect/);
  assert.match(defaults, /ModelCatalogSelect/);
  assert.match(defaults, /provider=\{selectedProfile\?\.provider\}/);
  assert.doesNotMatch(defaults, /<select/);
  assert.match(defaults, /手动模型 ID/);
  assert.match(compactCard, /w-\[min\(22rem,calc\(100vw-1\.25rem\)\)\]/);
  assert.doesNotMatch(compactCard, /AI 会话列表|添加附件/);
});

test("测试模型使用共享搜索列表且不再依赖会过滤当前值的 datalist", async () => {
  const source = await readSource();
  assert.match(source, /ModelCatalogSelect/);
  assert.doesNotMatch(source, /<datalist|connection-test-models/);
});

test("AI connection page excludes quota details and exposes transcription purpose", async () => {
  const source = await readSource();

  assert.match(source, /录音转写/);
  assert.doesNotMatch(source, /AiQuotaSettingsPanel/);
  assert.doesNotMatch(source, /额度与用量/);
  assert.doesNotMatch(source, /清空错题和导入记录/);
});

test("AI 连接保存反馈靠近提交按钮且切换厂商保留编辑记录", async () => {
  const source = await readSource();
  assert.match(source, /connectionSaveRow/);
  assert.match(source, /role=\{feedback\.tone === "error" \? "alert" : "status"\}/);
  assert.match(source, /id:\s*current\.id/);
  assert.match(source, /切换厂商后必须重新输入 API Key/);
  assert.match(source, /apiKeyInputRef\.current\?\.focus\(\)/);
});

test("AI 连接开发示例复用五列表格且真实仓储容器按示例状态隔离", async () => {
  const [source, styles] = await Promise.all([
    readSource(),
    readFile(new URL("./settings-compact.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /ApiConnectionsDevelopmentExample/);
  assert.match(source, /ApiConnectionsSettingsLiveView/);
  assert.match(source, /if \(example\.value\)/);
  assert.match(styles, /\.connectionTableHeader[\s\S]*text-align:\s*center/);
  assert.match(styles, /\.connectionActions[\s\S]*justify-content:\s*center/);
});

test("AI 连接操作列始终保留编辑、测试和删除三个稳定动作位", async () => {
  const [source, styles] = await Promise.all([
    readSource(),
    readFile(new URL("./settings-compact.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /重新输入密钥/);
  assert.match(source, /testSavedProfile\(profile\)/);
  assert.match(source, /removeProfile\(profile\)/);
  assert.match(styles, /\.connectionActions\s*\{[\s\S]*grid-template-columns:\s*minmax\(6\.5rem, auto\)[\s\S]*minmax\(3\.25rem, auto\)[\s\S]*minmax\(3\.25rem, auto\)/);
  assert.match(styles, /\.connectionActions > button\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.doesNotMatch(styles, /\.connectionActions > :last-child\s*\{[\s\S]*display:\s*none/);
});
