import assert from "node:assert/strict";
import test from "node:test";
import {
  civilServiceStudyModuleCatalog,
  civilServiceStudyModules,
  getDefaultEnabledStudyModuleIds,
  getStudyModuleCatalog,
  isStudyModuleView,
  resolveEnabledStudyModuleIds,
  resolveEnabledStudyModules,
  scheduledWorkspaceDefinition,
  studyDomainDefinitions,
} from "./study-registry.ts";

test("公考 registry 保留完整模块目录并声明稳定默认集合", () => {
  assert.equal(studyDomainDefinitions[0]?.id, "civil-service");
  assert.equal(studyDomainDefinitions[0]?.label, "公考");
  assert.deepEqual(civilServiceStudyModuleCatalog.map((module) => module.id), [
    "dashboard",
    "fenbi",
    "import",
    "library",
    "review",
    "knowledge",
    "knowledgeTraining",
    "interview",
    "tutoring",
    "stats",
  ]);
  assert.deepEqual(getStudyModuleCatalog("civil-service"), civilServiceStudyModuleCatalog);
  assert.deepEqual(getDefaultEnabledStudyModuleIds("civil-service"), [
    "dashboard",
    "fenbi",
    "library",
    "review",
    "knowledgeTraining",
    "interview",
  ]);
  assert.deepEqual(civilServiceStudyModules.map((module) => module.id), getDefaultEnabledStudyModuleIds("civil-service"));
  assert.equal(civilServiceStudyModuleCatalog.find((module) => module.id === "library")?.label, "学习数据");
  assert.equal(civilServiceStudyModuleCatalog.every((module) => module.capabilities.length > 0), true);
  assert.equal(civilServiceStudyModuleCatalog.every((module) => module.healthSignals?.length), true);
});

test("项目模块偏好过滤未知 ID、去重、补齐总览并保留 registry 顺序", () => {
  assert.deepEqual(resolveEnabledStudyModuleIds("civil-service", ["review", "import", "review", "unknown"]), [
    "dashboard",
    "import",
    "review",
  ]);
  assert.deepEqual(resolveEnabledStudyModuleIds("civil-service", []), ["dashboard"]);
  assert.deepEqual(resolveEnabledStudyModules("civil-service", ["stats", "dashboard", "stats"]), [
    civilServiceStudyModuleCatalog.find((module) => module.id === "dashboard"),
    civilServiceStudyModuleCatalog.find((module) => module.id === "stats"),
  ]);
  assert.deepEqual(resolveEnabledStudyModuleIds("missing-domain", ["dashboard"]), []);
});

test("公考首页声明学习链路，已安排入口继续复用 automation 视图", () => {
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
  assert.equal(scheduledWorkspaceDefinition.viewKey, "automation");
  assert.equal(scheduledWorkspaceDefinition.label, "已安排");
  assert.equal(isStudyModuleView("automation"), false);
  assert.equal(isStudyModuleView("knowledge"), true);
  assert.equal(isStudyModuleView("library"), true);
});
