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
  assert.match(defaults, /provider=\{selectedProfile\?\.provider\}/);
  assert.doesNotMatch(defaults, /<select/);
  assert.match(defaults, /手动模型 ID/);
  assert.match(compactCard, /w-\[min\(22rem,calc\(100vw-1\.25rem\)\)\]/);
  assert.doesNotMatch(compactCard, /AI 会话列表|添加附件/);
});

test("AI connection page excludes quota details and exposes transcription purpose", async () => {
  const source = await readSource();

  assert.match(source, /录音转写/);
  assert.doesNotMatch(source, /AiQuotaSettingsPanel/);
  assert.doesNotMatch(source, /额度与用量/);
  assert.doesNotMatch(source, /清空错题和导入记录/);
});
