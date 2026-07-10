import assert from "node:assert/strict";
import test from "node:test";
import { getImportProviderPlugin, importProviderPlugins } from "./import-provider-plugins.ts";

test("粉笔导入以内置插件注册并声明公考专项边界", () => {
  const plugin = getImportProviderPlugin("fenbi");
  assert.equal(importProviderPlugins.length, 1);
  assert.equal(plugin.category, "civil-service");
  assert.equal(plugin.supportedInputs.includes("image"), true);
  assert.equal(plugin.requiredConnections.includes("vision"), true);
  assert.equal(plugin.retryPolicy, "safe-reparse");
  assert.equal(plugin.draftSink, "import-drafts");
  assert.deepEqual(plugin.aiCapabilities, ["text-parse", "vision-ocr"]);
  assert.match(plugin.diagnosticCapabilities.join("、"), /低置信度/);
  assert.match(plugin.privacyNote, /不把原文写入插件配置/);
});

test("粉笔本地文本解析返回统一插件结果和诊断", async () => {
  const plugin = getImportProviderPlugin("fenbi");
  const result = await plugin.parseText({
    mode: "local",
    rawText: "【题目】行政复议机关应当依法审查。\n【答案】正确\n【解析】依法行政要求合法性审查。",
  });
  assert.equal(result.providerId, "fenbi");
  assert.equal(result.sourceLabel, "粉笔导入");
  assert.equal(result.mode, "local");
  assert.equal(result.diagnostics.length > 0, true);
});
