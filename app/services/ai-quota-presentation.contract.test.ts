import assert from "node:assert/strict";
import test from "node:test";
import type { AiQuotaSnapshot } from "../types/domains/ai-quota.ts";
import { deriveQuotaRingPresentation, formatQuotaMetricValue } from "./ai-quota-presentation.ts";

function snapshot(metrics: AiQuotaSnapshot["metrics"], stale = false): AiQuotaSnapshot {
  return { id: "deepseek", provider: "deepseek", label: "DeepSeek", status: "ready", source: "official", metrics, officialRemainingAvailable: true, message: "已刷新", refreshedAt: "2026-07-14T08:00:00.000Z", stale };
}

test("额度环优先使用剩余与上限比例，并保留精确币种和来源说明", () => {
  const presentation = deriveQuotaRingPresentation(snapshot([
    { id: "remaining_balance", label: "剩余", value: 82, unit: "CNY", source: "official" },
    { id: "spend_limit", label: "上限", value: 100, unit: "CNY", source: "manual" },
  ]));
  assert.equal(presentation.mode, "determinate");
  assert.equal(presentation.ratio, 0.82);
  assert.equal(presentation.centerLabel, "");
  assert.equal(presentation.tone, "normal");
  assert.match(presentation.accessibleLabel, /官方/);
  assert.match(presentation.accessibleLabel, /手动/);
});

test("只有余额时显示完整状态环，不伪造百分比；旧快照继续标记过期", () => {
  const presentation = deriveQuotaRingPresentation(snapshot([{ id: "remaining_balance", label: "可用余额", value: 12.5, unit: "USD", source: "official" }], true));
  assert.equal(presentation.mode, "status");
  assert.equal(presentation.ratio, undefined);
  assert.equal(presentation.centerLabel, "");
  assert.equal(presentation.tone, "stale");
  assert.match(presentation.accessibleLabel, /已过期/);
});

test("只有已用金额时换算为剩余比例并使用绿橙红阈值", () => {
  const warning = deriveQuotaRingPresentation(snapshot([
    { id: "used_cost", label: "已用", value: 73, unit: "USD", source: "official" },
    { id: "spend_limit", label: "上限", value: 100, unit: "USD", source: "manual" },
  ]));
  assert.equal(warning.ratio, 0.27);
  assert.equal(warning.centerLabel, "");
  assert.equal(warning.tone, "warning");

  const danger = deriveQuotaRingPresentation(snapshot([
    { id: "used_cost", label: "已用", value: 88, unit: "USD", source: "official" },
    { id: "spend_limit", label: "上限", value: 100, unit: "USD", source: "manual" },
  ]));
  assert.equal(danger.centerLabel, "");
  assert.equal(danger.tone, "danger");
});

test("Token 只在有官方分母时形成比例，紧凑值不丢失单位语义", () => {
  const tokens = { id: "token_usage" as const, label: "Token 用量", value: 12500, unit: "tokens", source: "official" as const };
  const presentation = deriveQuotaRingPresentation(snapshot([tokens]));
  assert.equal(presentation.mode, "status");
  assert.equal(presentation.ratio, undefined);
  assert.match(formatQuotaMetricValue(tokens), /12,500 tokens/);
});
