"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { AppIcon, type AppIconName } from "../shared/app-icon";
import { announceInteractiveOverlayOpen } from "../shared/ui-overlay-events";
import {
  isStudyModuleView,
  studyDomainDefinitions,
  type StudyModuleId,
} from "./study-registry";
import { useStudyModulePreferences } from "./use-study-module-preferences";

const AddStudyModuleDialogContent = dynamic(
  () => import("./study-module-dialog-content").then((module) => module.AddStudyModuleDialogContent),
);
const ManageStudyModuleDialogContent = dynamic(
  () => import("./study-module-dialog-content").then((module) => module.ManageStudyModuleDialogContent),
);
const StudyModuleDialog = dynamic(
  () => import("./study-module-dialog").then((module) => module.StudyModuleDialog),
);

type StudyProjectNavigationProps = {
  onNotice: (message: string) => void;
  onPreloadView: (view: ViewKey) => void;
  onSelectView: (view: ViewKey) => void;
  view: ViewKey;
};

/** 公考项目树的低频管理边界；模块 registry、项目偏好和弹窗不进入主侧栏首屏入口。 */
export function StudyProjectNavigation({ onNotice, onPreloadView, onSelectView, view }: StudyProjectNavigationProps) {
  const civilServiceDomain = studyDomainDefinitions[0]!;
  const [moduleDialog, setModuleDialog] = useState<"add" | "manage" | null>(null);
  const {
    addModule,
    enabledModuleIds,
    enabledModules,
    removeModule,
    resetDefaults,
  } = useStudyModulePreferences(civilServiceDomain.id);
  const projectActive = view === "conversation" || isStudyModuleView(view);

  function openModuleDialog(nextDialog: "add" | "manage") {
    announceInteractiveOverlayOpen();
    setModuleDialog(nextDialog);
  }

  function moduleLabel(moduleId: StudyModuleId): string {
    return civilServiceDomain.moduleCatalog.find((module) => module.id === moduleId)?.label ?? moduleId;
  }

  async function handleAddModule(moduleId: StudyModuleId) {
    try {
      await addModule(moduleId);
      onNotice(moduleLabel(moduleId) + "已添加到公考侧栏");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "模块添加失败");
    }
  }

  async function handleRemoveModule(moduleId: StudyModuleId) {
    if (view === moduleId) onSelectView("dashboard");
    try {
      await removeModule(moduleId);
      onNotice(moduleLabel(moduleId) + "已从公考侧栏移除");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "模块移除失败");
    }
  }

  async function handleResetModules() {
    try {
      await resetDefaults();
      onNotice("公考侧栏已恢复默认模块");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "默认模块恢复失败");
    }
  }

  return (
    <>
      <details className="workspace-project-group group rounded-[var(--ui-radius-row)] p-0.5" data-project-selected={projectActive ? "true" : undefined}>
        <summary aria-current={projectActive ? "true" : undefined} className={`workspace-project-row grid min-h-8 cursor-pointer list-none grid-cols-[16px_1fr_auto] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2 text-left text-[0.8rem] font-semibold max-lg:min-h-11 [&::-webkit-details-marker]:hidden ${projectActive ? "is-selected text-foreground" : "text-muted"}`}>
          <AppIcon name="project" size={16} />
          <span className="truncate">{civilServiceDomain.label}</span>
          <span className="transition group-open:rotate-90"><AppIcon name="chevronRight" size={16} /></span>
        </summary>
        <div className="grid gap-px pl-2">
          <details className="group/modules">
            <summary className="grid min-h-8 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center rounded-[var(--ui-radius-row)] px-2 text-[11px] font-medium text-muted hover:bg-chrome-hover max-lg:min-h-11 [&::-webkit-details-marker]:hidden" data-study-module-header="true">
              <span>模块</span>
              <button
                aria-label="管理公考模块"
                className="grid h-7 w-7 place-items-center rounded-[var(--ui-radius-row)] hover:bg-surface-muted hover:text-foreground max-lg:h-11 max-lg:w-11"
                data-study-module-manage="true"
                title="管理公考模块"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openModuleDialog("manage");
                }}
              >
                <AppIcon name="more" size={16} />
              </button>
              <button
                aria-label="添加公考模块"
                className="grid h-7 w-7 place-items-center rounded-[var(--ui-radius-row)] hover:bg-surface-muted hover:text-foreground max-lg:h-11 max-lg:w-11"
                data-study-module-add="true"
                title="添加公考模块"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openModuleDialog("add");
                }}
              >
                <AppIcon name="plus" size={16} />
              </button>
              <span className="transition group-open/modules:rotate-90"><AppIcon name="chevronRight" size={16} /></span>
            </summary>
            <div className="grid gap-px pl-1">
              {enabledModules.map((module) => (
                <button
                  key={module.id}
                  data-mobile-sidebar-close="true"
                  className={`grid min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2 text-left text-[0.8rem] max-lg:min-h-11 ${view === module.id ? "bg-surface text-foreground" : "text-muted hover:bg-chrome-hover hover:text-foreground"}`}
                  type="button"
                  title={module.description}
                  onClick={() => onSelectView(module.id)}
                  onFocus={() => onPreloadView(module.id)}
                  onMouseEnter={() => onPreloadView(module.id)}
                >
                  <AppIcon name={module.icon as AppIconName} size={16} />
                  <span className="truncate">{module.label}</span>
                </button>
              ))}
            </div>
          </details>
        </div>
      </details>
      {moduleDialog ? (
        <StudyModuleDialog mode={moduleDialog} onClose={() => setModuleDialog(null)} open title={moduleDialog === "add" ? "添加模块到「公考」" : "管理「公考」模块"}>
          {moduleDialog === "add" ? (
            <AddStudyModuleDialogContent
              enabledModuleIds={enabledModuleIds}
              modules={civilServiceDomain.moduleCatalog}
              onAdd={handleAddModule}
            />
          ) : (
            <ManageStudyModuleDialogContent
              defaultEnabledModuleIds={civilServiceDomain.defaultEnabledModuleIds}
              enabledModules={enabledModules}
              requiredModuleIds={civilServiceDomain.requiredModuleIds}
              onRemove={handleRemoveModule}
              onReset={handleResetModules}
            />
          )}
        </StudyModuleDialog>
      ) : null}
    </>
  );
}
