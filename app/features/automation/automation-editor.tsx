"use client";

import { useState, type FormEvent } from "react";
import { AUTOMATION_TEMPLATES } from "../../services/automation-executor";
import type { AutomationDefinitionInput } from "../../services/automation-repository";
import type { AutomationDefinition, AutomationSchedule, AutomationTemplateId } from "../../types/review";
import { Button, Panel } from "../shared/ui-primitives";
import type { AutomationCenter } from "./use-automation-center";
import {
  AUTOMATION_SOURCE_OPTIONS,
  automationErrorMessage,
  createAutomationDraft,
  createEditDraft,
  createSchedule,
} from "./automation-ui";

/** 渲染自动化创建/编辑表单，并在保存前执行最小业务校验。 */
export function AutomationEditor({
  center,
  definition,
  initialTemplateId,
  onFinished,
  onNotice,
}: {
  center: AutomationCenter;
  definition?: AutomationDefinition;
  initialTemplateId: AutomationTemplateId;
  onFinished: () => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState<AutomationDefinitionInput>(() => (
    definition ? createEditDraft(definition) : createAutomationDraft(initialTemplateId)
  ));

  /** 切换模板时同步重置模板维护的名称、提示词和默认范围。 */
  function chooseTemplate(templateId: AutomationTemplateId): void {
    setDraft(createAutomationDraft(templateId));
  }

  /** 切换调度类型时填入对应的有效默认配置。 */
  function changeSchedule(kind: AutomationSchedule["kind"]): void {
    setDraft((current) => ({ ...current, schedule: createSchedule(kind) }));
  }

  /** 校验并保存表单，失败时保留用户输入供继续修正。 */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      if (!draft.name.trim()) throw new Error("请输入自动化名称");
      if (draft.templateId === "custom" && !draft.prompt.trim()) throw new Error("自定义自动化必须填写提示词");
      if (!draft.sourceScopes.length) throw new Error("请至少选择一个数据范围");
      await center.save({ ...draft, name: draft.name.trim(), prompt: draft.prompt.trim() }, definition?.id);
      onFinished();
    } catch (error) {
      onNotice(automationErrorMessage(error, "自动化保存失败"));
    }
  }

  return (
    <Panel title={definition ? "编辑自动化" : "新建自动化"} eyebrow="AI 结果进入收件箱，不会自动改写数据">
      <form className="grid min-w-0 gap-4" onSubmit={submit}>
        <label className="grid min-w-0 gap-1 text-sm">
          名称
          <input className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.name} onChange={(event) => {
            const name = event.currentTarget.value;
            setDraft((current) => ({ ...current, name }));
          }} />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          模板
          <select className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.templateId} onChange={(event) => chooseTemplate(event.currentTarget.value as AutomationTemplateId)}>
            {AUTOMATION_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          提示词
          <textarea className="min-h-28 min-w-0 rounded-lg border border-line bg-background p-3" value={draft.prompt} onChange={(event) => {
            const prompt = event.currentTarget.value;
            setDraft((current) => ({ ...current, prompt }));
          }} />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm">只读数据范围</legend>
          <div className="flex flex-wrap gap-3">
            {AUTOMATION_SOURCE_OPTIONS.map((source) => (
              <label key={source.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.sourceScopes.includes(source.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setDraft((current) => ({
                      ...current,
                      sourceScopes: checked
                        ? [...current.sourceScopes, source.id]
                        : current.sourceScopes.filter((id) => id !== source.id),
                    }));
                  }}
                />
                {source.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid min-w-0 grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className="grid min-w-0 gap-1 text-sm">
            周期
            <select className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.schedule.kind} onChange={(event) => changeSchedule(event.currentTarget.value as AutomationSchedule["kind"])}>
              <option value="interval">固定间隔</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="cron">Cron</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            时区
            <input className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.timeZone} onChange={(event) => {
              const timeZone = event.currentTarget.value;
              setDraft((current) => ({ ...current, timeZone }));
            }} />
          </label>
        </div>
        {draft.schedule.kind === "interval" ? (
          <label className="grid gap-1 text-sm">
            间隔分钟
            <input type="number" min={5} className="min-h-10 rounded-lg border border-line bg-background px-3" value={draft.schedule.intervalMinutes} onChange={(event) => {
              const intervalMinutes = Number(event.currentTarget.value);
              setDraft((current) => ({ ...current, schedule: { kind: "interval", intervalMinutes } }));
            }} />
          </label>
        ) : null}
        {draft.schedule.kind === "daily" ? (
          <label className="grid gap-1 text-sm">
            执行时间
            <input type="time" className="min-h-10 rounded-lg border border-line bg-background px-3" value={draft.schedule.time} onChange={(event) => {
              const time = event.currentTarget.value;
              setDraft((current) => ({ ...current, schedule: { kind: "daily", time } }));
            }} />
          </label>
        ) : null}
        {draft.schedule.kind === "weekly" ? (
          <div className="grid min-w-0 grid-cols-2 gap-3 max-sm:grid-cols-1">
            <label className="grid min-w-0 gap-1 text-sm">
              星期
              <select className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.schedule.weekday} onChange={(event) => {
                const weekday = Number(event.currentTarget.value);
                setDraft((current) => ({ ...current, schedule: { kind: "weekly", weekday, time: current.schedule.kind === "weekly" ? current.schedule.time : "09:00" } }));
              }}>
                {["日", "一", "二", "三", "四", "五", "六"].map((label, index) => <option key={label} value={index}>星期{label}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-sm">
              执行时间
              <input type="time" className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.schedule.time} onChange={(event) => {
                const time = event.currentTarget.value;
                setDraft((current) => ({ ...current, schedule: { kind: "weekly", weekday: current.schedule.kind === "weekly" ? current.schedule.weekday : 1, time } }));
              }} />
            </label>
          </div>
        ) : null}
        {draft.schedule.kind === "cron" ? (
          <label className="grid gap-1 text-sm">
            五段式 Cron
            <input className="min-h-10 rounded-lg border border-line bg-background px-3 font-mono" placeholder="0 8 * * *" value={draft.schedule.expression} onChange={(event) => {
              const expression = event.currentTarget.value;
              setDraft((current) => ({ ...current, schedule: { kind: "cron", expression } }));
            }} />
            <span className="text-xs text-muted">分钟 小时 日期 月份 星期；最短间隔 5 分钟</span>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit">{definition ? "保存修改" : "创建自动化"}</Button>
          {definition ? <Button variant="outline" onClick={onFinished}>取消编辑</Button> : null}
        </div>
      </form>
    </Panel>
  );
}
