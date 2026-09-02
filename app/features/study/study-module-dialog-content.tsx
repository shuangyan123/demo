"use client";

import type { StudyModuleDefinition } from "../../types/domains/workspace.ts";
import { AppIcon, type AppIconName } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";

type ModuleId = StudyModuleDefinition["id"];

function moduleIcon(module: StudyModuleDefinition): AppIconName {
  return module.icon as AppIconName;
}

export function AddStudyModuleDialogContent({
  enabledModuleIds,
  modules,
  onAdd,
}: {
  enabledModuleIds: readonly ModuleId[];
  modules: readonly StudyModuleDefinition[];
  onAdd: (moduleId: ModuleId) => void | Promise<void>;
}) {
  const enabled = new Set(enabledModuleIds);
  return (
    <div className="mt-4 grid gap-1">
      <p className="mb-2 text-xs leading-5 text-muted">选择已注册的模块加入公考侧栏；添加模块不会安装新的代码或服务。</p>
      {modules.map((module) => {
        const isEnabled = enabled.has(module.id);
        return (
          <div
            key={module.id}
            className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--ui-radius)] border border-line px-3 py-2.5"
            data-study-module-id={module.id}
            data-study-module-row="true"
          >
            <AppIcon name={moduleIcon(module)} size={18} />
            <span className="min-w-0">
              <strong className="block truncate text-sm font-medium">{module.label}</strong>
              <span className="mt-0.5 block text-xs leading-5 text-muted">{module.description}</span>
            </span>
            <Button
              aria-label={isEnabled ? module.label + " 已添加" : "添加 " + module.label}
              disabled={isEnabled}
              size="sm"
              type="button"
              variant={isEnabled ? "ghost" : "outline"}
              onClick={() => onAdd(module.id)}
            >
              {isEnabled ? "已添加" : "添加"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function ManageStudyModuleDialogContent({
  defaultEnabledModuleIds,
  enabledModules,
  requiredModuleIds,
  onRemove,
  onReset,
}: {
  defaultEnabledModuleIds: readonly ModuleId[];
  enabledModules: readonly StudyModuleDefinition[];
  requiredModuleIds: readonly ModuleId[];
  onRemove: (moduleId: ModuleId) => void | Promise<void>;
  onReset: () => void | Promise<void>;
}) {
  const defaults = new Set(defaultEnabledModuleIds);
  const required = new Set(requiredModuleIds);
  return (
    <div className="mt-4 grid gap-3">
      <p className="text-xs leading-5 text-muted">移除只会隐藏公考侧栏入口，不会删除学习数据、对话、粉笔会话或全局能力。</p>
      <div className="grid gap-1" data-study-module-management-list="true">
        {enabledModules.map((module) => {
          const isRequired = required.has(module.id);
          return (
            <div
              key={module.id}
              className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--ui-radius)] border border-line px-3 py-2.5"
              data-study-module-id={module.id}
              data-study-module-row="true"
            >
              <AppIcon name={moduleIcon(module)} size={18} />
              <span className="min-w-0">
                <strong className="block truncate text-sm font-medium">{module.label}</strong>
                {defaults.has(module.id) ? <span className="mt-0.5 block text-xs text-muted">默认模块</span> : null}
              </span>
              {isRequired ? (
                <span className="text-xs text-muted">始终保留</span>
              ) : (
                <Button
                  aria-label={"移除 " + module.label}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onRemove(module.id)}
                >
                  移除
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-xs text-muted">需要时可恢复当前项目的默认模块。</span>
        <Button type="button" variant="outline" onClick={onReset}>恢复默认模块</Button>
      </div>
    </div>
  );
}
