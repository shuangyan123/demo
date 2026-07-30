import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = readFileSync(new URL("./development-example-registry.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./development-example-workspace.tsx", import.meta.url), "utf8");
const root = readFileSync(new URL("../review/review-workspace.tsx", import.meta.url), "utf8");

test("类型化开发示例注册表覆盖全部内容型工作台与状态变体", () => {
  for (const id of [
    "dashboard-populated", "conversation-populated", "library-populated", "review-populated",
    "knowledge-populated", "knowledge-training-populated", "stats-populated", "import-populated",
    "import-needs-review", "automation-populated", "automation-run-failed",
    "interview-populated", "tutoring-populated",
  ]) assert.match(registry, new RegExp(`"${id}"`));
  assert.match(registry, /DevelopmentExampleDefinition/);
  assert.match(registry, /view: ViewKey/);
  assert.match(registry, /fixture: DevelopmentExampleFixtureVariant/);
});

test("总览与已安排示例直接渲染真实业务组件和非空 fixture", () => {
  assert.match(workspace, /<DashboardView/);
  assert.match(workspace, /<AutomationView/);
  assert.match(workspace, /今日队列和薄弱板块|真实总览组件/);
  assert.match(workspace, /每日错题复盘建议/);
  assert.match(workspace, /优先复盘判断推理/);
  assert.match(workspace, /useState<AutomationDefinition\[\]>/);
});

test("开发示例在 controller 挂载前动态分流且不访问持久化或外部服务", () => {
  assert.match(root, /isWorkspaceDevelopmentExample\(developmentExample\)[\s\S]*DevelopmentExampleWorkspace/);
  assert.match(root, /function ReviewWorkspaceLive[\s\S]*useReviewWorkspaceController/);
  assert.match(root, /dynamic\([\s\S]*development-example-workspace/);
  assert.doesNotMatch(workspace, /repository|fetch\(|indexedDB|reviewDb|localStorage|showDirectoryPicker/);
});

test("真实数据入口清除 example 参数后重新进入 live controller", () => {
  assert.match(workspace, /url\.searchParams\.delete\("example"\)/);
  assert.match(workspace, /window\.location\.assign\(url\)/);
});
