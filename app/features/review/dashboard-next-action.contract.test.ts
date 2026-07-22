import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardNextAction, type DashboardNextActionInput } from "./dashboard-next-action.ts";

const populated: DashboardNextActionInput = {
  automationUnreadCount: 0,
  dueKnowledgeCount: 0,
  dueMistakeCount: 0,
  importDraftCount: 0,
  importJobCount: 1,
  knowledgeTotal: 3,
  mistakeTotal: 5,
  pendingProposalCount: 0,
};

test("公考首页推荐操作遵循导入、复盘、训练、提案和已安排的固定优先级", () => {
  assert.equal(resolveDashboardNextAction({ ...populated, importDraftCount: 2, dueMistakeCount: 3 }).id, "confirm-import");
  assert.equal(resolveDashboardNextAction({ ...populated, dueMistakeCount: 3, dueKnowledgeCount: 4 }).id, "review");
  assert.equal(resolveDashboardNextAction({ ...populated, dueKnowledgeCount: 4, pendingProposalCount: 2 }).id, "training");
  assert.equal(resolveDashboardNextAction({ ...populated, pendingProposalCount: 2, automationUnreadCount: 1 }).id, "proposal");
  assert.equal(resolveDashboardNextAction({ ...populated, automationUnreadCount: 1 }).id, "scheduled");
});

test("空学习库优先导入，已有资料且无待办时进入对话辅导", () => {
  assert.equal(resolveDashboardNextAction({
    ...populated,
    importJobCount: 0,
    knowledgeTotal: 0,
    mistakeTotal: 0,
  }).id, "import");
  assert.equal(resolveDashboardNextAction(populated).id, "tutoring");
});

test("推荐文案只使用聚合数字且始终提供唯一按钮标签", () => {
  const action = resolveDashboardNextAction({ ...populated, dueMistakeCount: 3 });
  assert.match(action.description, /3 道错题/);
  assert.equal(action.label, "开始错题复盘");
  assert.equal(action.title, "下一步");
});
