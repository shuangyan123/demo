import assert from "node:assert/strict";
import test from "node:test";
import { civilServiceStudyModules, isStudyModuleView, scheduledWorkspaceDefinition, studyDomainDefinitions } from "./study-registry.ts";

test("公考作为首个专项学习项目聚合核心学习模块", () => {
  assert.equal(studyDomainDefinitions[0]?.id, "civil-service");
  assert.equal(studyDomainDefinitions[0]?.label, "公考");
  assert.deepEqual(civilServiceStudyModules.map((module) => module.id), [
    "dashboard",
    "fenbi",
    "library",
    "review",
    "knowledgeTraining",
    "interview",
  ]);
  assert.equal(civilServiceStudyModules.find((module) => module.id === "library")?.label, "学习数据");
  assert.equal(civilServiceStudyModules.every((module) => module.capabilities.length > 0), true);
  assert.equal(civilServiceStudyModules.every((module) => module.healthSignals?.length), true);
  assert.match(studyDomainDefinitions[0]?.dashboard.headline ?? "", /导入/);
  assert.deepEqual(studyDomainDefinitions[0]?.dashboard.flow.map((step) => step.id), [
    "import",
    "mistake",
    "knowledge",
    "training",
    "tutoring",
    "scheduled",
    "obsidian",
  ]);
});

test("已安排入口复用 automation 视图但对外显示新产品名称", () => {
  assert.equal(scheduledWorkspaceDefinition.viewKey, "automation");
  assert.equal(scheduledWorkspaceDefinition.label, "已安排");
  assert.equal(isStudyModuleView("automation"), false);
  assert.equal(isStudyModuleView("knowledge"), false);
  assert.equal(isStudyModuleView("library"), true);
});
