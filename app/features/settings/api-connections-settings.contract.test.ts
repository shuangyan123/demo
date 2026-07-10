import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource() {
  return readFile(new URL("./api-connections-settings-view.tsx", import.meta.url), "utf8");
}

test("AI connection model picker uses a select with manual model fallback", async () => {
  const source = await readSource();

  assert.match(source, /<select[\s\S]*value=\{selectedModelValue\}/);
  assert.match(source, /手动填写模型 ID/);
  assert.match(source, /manualModelActive/);
  assert.doesNotMatch(source, /datalist id="provider-model-options"/);
  assert.doesNotMatch(source, /modelCatalog\.slice\(0,\s*8\)\.map/);
});
