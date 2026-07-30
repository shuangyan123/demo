import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { uiReviewPopulatedViews, uiReviewScenarioDefinitions } from "./ui-review-scenario-registry.ts";

const FEATURES_ROOT = path.resolve(import.meta.dirname, "..");

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(absolute));
    else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) result.push(absolute);
  }
  return result;
}

test("所有显式 EmptyState 都有唯一且已分类的 UI 审查 stateId", async () => {
  const registered = new Set<string>(uiReviewScenarioDefinitions.map((scenario) => scenario.id));
  assert.equal(registered.size, uiReviewScenarioDefinitions.length, "UI 审查 stateId 必须唯一");
  const used: string[] = [];
  for (const file of await sourceFiles(FEATURES_ROOT)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/<EmptyState\b[^>]*\bstateId="([^"]+)"/g)) used.push(match[1]);
    for (const match of source.matchAll(/\bdata-review-state="([^"]+)"/g)) used.push(match[1]);
    assert.equal(source.match(/<EmptyState\b(?![^>]*\bstateId=)[^>]*>/g), null, `${path.relative(FEATURES_ROOT, file)} 存在未登记的 EmptyState`);
  }
  assert.ok(used.length >= 55, `至少应覆盖现有 55 个 EmptyState，实际 ${used.length}`);
  for (const stateId of used) assert.ok(registered.has(stateId), `未登记的 EmptyState stateId: ${stateId}`);
});

test("所有一级业务视图都有正常有数据的审查入口", () => {
  assert.deepEqual([...uiReviewPopulatedViews], [
    "dashboard", "conversation", "library", "review", "knowledgeTraining", "stats", "knowledge",
    "automation", "interview", "tutoring", "import", "plugins", "settings",
  ]);
});

test("外部集成场景不得伪装成真实本地成功数据", () => {
  for (const scenario of uiReviewScenarioDefinitions) {
    if (/MCP|Obsidian|粉笔|AI 连接|额度/.test(scenario.target)) {
      assert.notEqual(scenario.safety, "local-data", `${scenario.id} 不得伪装成真实外部成功态`);
    }
  }
});
