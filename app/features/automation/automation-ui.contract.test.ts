import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AutomationDefinition, AutomationRun, AutomationSnapshot } from "../../types/review.ts";
import { deriveAutomationOverview, filterAutomationDefinitions, latestRunsByAutomation } from "./automation-view-model.ts";

const now = "2026-07-23T08:00:00.000Z";

/** 构造最小任务，便于验证纯展示派生逻辑。 */
function definition(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "task-1",
    name: "申论采集",
    templateId: "shenlun_collection",
    prompt: "",
    sourceScopes: [],
    enabled: true,
    timeZone: "Asia/Shanghai",
    schedule: { kind: "daily", time: "20:30" },
    nextRunAt: "2026-07-23T12:30:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 构造最小运行摘要，不包含完整上下文或提示词。 */
function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "task-1",
    automationName: "申论采集",
    status: "succeeded",
    trigger: "manual",
    scheduledAt: now,
    startedAt: now,
    finishedAt: now,
    unread: true,
    missedCount: 0,
    proposalIds: [],
    createdAt: now,
    ...overrides,
  };
}

test("已安排摘要只从真实快照计算启用数、最近计划和未读数", () => {
  const snapshot: AutomationSnapshot = {
    definitions: [
      definition(),
      definition({ id: "task-2", enabled: true, nextRunAt: "2026-07-23T10:00:00.000Z" }),
      definition({ id: "task-3", enabled: false, nextRunAt: "2026-07-23T09:00:00.000Z" }),
    ],
    runs: [],
    unreadCount: 2,
  };
  assert.deepEqual(deriveAutomationOverview(snapshot), {
    enabledCount: 2,
    nextRunAt: "2026-07-23T10:00:00.000Z",
    pendingCount: 2,
  });
});

test("任务搜索、启停和最近失败筛选共享同一最近运行索引", () => {
  const definitions = [definition(), definition({ id: "task-2", name: "每日复盘", enabled: false })];
  const latest = latestRunsByAutomation([
    run({ id: "run-new", status: "failed" }),
    run({ id: "run-old", status: "succeeded", createdAt: "2026-07-22T08:00:00.000Z" }),
  ]);
  assert.equal(latest.get("task-1")?.id, "run-new");
  assert.deepEqual(filterAutomationDefinitions(definitions, "申论", "all", latest).map((item) => item.id), ["task-1"]);
  assert.deepEqual(filterAutomationDefinitions(definitions, "", "disabled", latest).map((item) => item.id), ["task-2"]);
  assert.deepEqual(filterAutomationDefinitions(definitions, "", "failed", latest).map((item) => item.id), ["task-1"]);
});

test("已安排编排状态、移动抽屉和独立编辑层保持专用边界", async () => {
  const [view, controller, overlays] = await Promise.all([
    readFile(new URL("./automation-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("./use-automation-view-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("./automation-overlays.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(view, /useAutomationViewController/);
  assert.match(view, /role="tablist"/);
  assert.match(controller, /mobileDetailOpen/);
  assert.match(overlays, /aria-modal="true"/);
  assert.match(overlays, /document\.body\.style\.overflow = "hidden"/);
  assert.match(overlays, /event\.key === "Escape"/);
});
