import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource() {
  return readFile(new URL("./api-connections-settings-view.tsx", import.meta.url), "utf8");
}

test("AI connection model picker uses a select with manual model fallback", async () => {
  const source = await readSource();

  assert.match(source, /aria-label="用途"/);
  assert.match(source, /aria-label="厂商"/);
  assert.match(source, /aria-label="模型"/);
  assert.match(source, /手动模型 ID/);
  assert.match(source, /manualModelActive/);
  assert.match(source, /ProviderIcon/);
  assert.match(source, /refreshOfficialModels/);
  assert.doesNotMatch(source, /datalist id="provider-model-options"/);
  assert.doesNotMatch(source, /modelCatalog\.slice\(0,\s*8\)\.map/);
});

test("AI connection page owns quota details and exposes transcription purpose", async () => {
  const source = await readSource();

  assert.match(source, /录音转写/);
  assert.match(source, /AiQuotaSettingsPanel/);
  assert.match(source, /AI 额度与用量/);
});
