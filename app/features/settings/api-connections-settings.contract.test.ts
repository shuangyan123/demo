import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource() {
  return readFile(new URL("./api-connections-settings-view.tsx", import.meta.url), "utf8");
}

test("AI 连接只保存鉴权，默认能力单独保存模型", async () => {
  const source = await readSource();

  assert.match(source, /aria-label="用途"/);
  assert.match(source, /aria-label="厂商"/);
  assert.match(source, /setDefaultModel/);
  assert.match(source, /setDefaultSelection/);
  assert.match(source, /ProviderIcon/);
  assert.doesNotMatch(source, /form\.model/);
  assert.doesNotMatch(source, /refreshOfficialModels/);
  assert.doesNotMatch(source, /datalist id="provider-model-options"/);
  assert.doesNotMatch(source, /modelCatalog\.slice\(0,\s*8\)\.map/);
});

test("AI connection page owns quota details and exposes transcription purpose", async () => {
  const source = await readSource();

  assert.match(source, /录音转写/);
  assert.match(source, /AiQuotaSettingsPanel/);
  assert.match(source, /AI 额度与用量/);
});
