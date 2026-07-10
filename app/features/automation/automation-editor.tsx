"use client";

import { useState, type FormEvent } from "react";
import { automationFailureLabel, automationRecoveryLabel } from "../../services/automation-failure";
import { AUTOMATION_TEMPLATES } from "../../services/automation-executor";
import type { AutomationDefinitionInput } from "../../services/automation-repository";
import type { AutomationContextSummary, AutomationDefinition, AutomationRecoveryAction, AutomationSchedule, AutomationTemplateId } from "../../types/review";
import { Button, Chip, Panel } from "../shared/ui-primitives";
import type { AutomationCenter, AutomationPreviewResult, AutomationTrialResult } from "./use-automation-center";
import {
  AUTOMATION_SOURCE_OPTIONS,
  automationErrorMessage,
  createAutomationDraft,
  createEditDraft,
  createSchedule,
} from "./automation-ui";

/** 渲染已安排任务创建/编辑表单，并在保存前执行最小业务校验。 */
export function AutomationEditor({
  center,
  definition,
  initialTemplateId,
  onRecoveryAction,
  onFinished,
  onNotice,
}: {
  center: AutomationCenter;
  definition?: AutomationDefinition;
  initialTemplateId: AutomationTemplateId;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
  onFinished: () => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState<AutomationDefinitionInput>(() => (
    definition ? createEditDraft(definition) : createAutomationDraft(initialTemplateId)
  ));
  const [previewResult, setPreviewResult] = useState<AutomationPreviewResult>();
  const [trialResult, setTrialResult] = useState<AutomationTrialResult>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);

  /** 切换模板时同步重置模板维护的名称、提示词和默认范围。 */
  function chooseTemplate(templateId: AutomationTemplateId): void {
    setDraft(createAutomationDraft(templateId));
  }

  /** 切换调度类型时填入对应的有效默认配置。 */
  function changeSchedule(kind: AutomationSchedule["kind"]): void {
    setDraft((current) => ({ ...current, schedule: createSchedule(kind) }));
  }

  /** 预览、试运行和保存共享同一组表单底线校验。 */
  function validateDraft(): void {
    if (!draft.name.trim()) throw new Error("请输入已安排任务名称");
    if (draft.templateId === "custom" && !draft.prompt.trim()) throw new Error("自定义已安排任务必须填写提示词");
    if (!draft.sourceScopes.length) throw new Error("请至少选择一个数据范围");
  }

  /** 本地预览只读取摘要，不调用模型或修改仓储。 */
  async function previewContext(): Promise<void> {
    try {
      validateDraft();
      setPreviewBusy(true);
      const result = await center.preview(draft);
      setPreviewResult(result);
      setTrialResult(undefined);
    } catch (error) {
      onNotice(automationErrorMessage(error, "预览读取范围失败"));
    } finally {
      setPreviewBusy(false);
    }
  }

  /** 试运行显式调用默认文本连接，但不创建运行记录或写入提案。 */
  async function runTrial(): Promise<void> {
    try {
      validateDraft();
      setTrialBusy(true);
      const result = await center.trialRun(draft);
      setTrialResult(result);
      setPreviewResult({ summary: result.contextSummary, contextCharCount: result.contextCharCount });
      onNotice(result.status === "succeeded" ? "已安排任务试运行完成，结果未写入收件箱" : `试运行失败：${result.error}`);
    } catch (error) {
      onNotice(automationErrorMessage(error, "已安排任务试运行失败"));
    } finally {
      setTrialBusy(false);
    }
  }

  /** 校验并保存表单，失败时保留用户输入供继续修正。 */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      validateDraft();
      await center.save({ ...draft, name: draft.name.trim(), prompt: draft.prompt.trim() }, definition?.id);
      onFinished();
    } catch (error) {
      onNotice(automationErrorMessage(error, "已安排任务保存失败"));
    }
  }

  return (
    <Panel title={definition ? "编辑已安排" : "新建已安排"} eyebrow="AI 结果进入收件箱，不会自动改写数据">
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
          <select className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.templateId} onChange={(event) => {
            const templateId = event.currentTarget.value as AutomationTemplateId;
            chooseTemplate(templateId);
          }}>
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
            <select className="min-h-10 min-w-0 rounded-lg border border-line bg-background px-3" value={draft.schedule.kind} onChange={(event) => {
              const kind = event.currentTarget.value as AutomationSchedule["kind"];
              changeSchedule(kind);
            }}>
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
          <Button disabled={previewBusy || trialBusy} variant="outline" onClick={() => void previewContext()}>
            {previewBusy ? "正在预览..." : "预览读取范围"}
          </Button>
          <Button disabled={previewBusy || trialBusy} variant="soft" onClick={() => void runTrial()}>
            {trialBusy ? "正在试运行..." : "试运行"}
          </Button>
        </div>
        {previewResult ? <AutomationContextSummaryView result={previewResult} /> : null}
        {trialResult ? <AutomationTrialResultView result={trialResult} onRecoveryAction={onRecoveryAction} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit">{definition ? "保存修改" : "创建已安排"}</Button>
          {definition ? <Button variant="outline" onClick={onFinished}>取消编辑</Button> : null}
        </div>
      </form>
    </Panel>
  );
}

/** 展示上下文摘要，避免在表单里暴露完整题干或知识正文。 */
function AutomationContextSummaryView({ result }: { result: AutomationPreviewResult }) {
  return (
    <div aria-label="已安排读取范围预览" className="rounded-lg border border-line bg-surface-muted p-3" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">读取范围预览</strong>
        <Chip tone="blue">约 {result.contextCharCount} 字符</Chip>
      </div>
      <AutomationSummaryList summary={result.summary} />
    </div>
  );
}

/** 展示试运行结果和分类恢复入口，结果不会进入收件箱。 */
function AutomationTrialResultView({
  result,
  onRecoveryAction,
}: {
  result: AutomationTrialResult;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
}) {
  const failed = result.status === "failed";
  return (
    <div className={`rounded-lg border p-3 ${failed ? "border-red/30 bg-red/5" : "border-green/30 bg-emerald-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{failed ? "试运行失败" : "试运行结果"}</strong>
        <Chip tone={failed ? "red" : "green"}>{failed ? automationFailureLabel(result.failureCategory) : `临时候选 ${result.proposalCount} 条`}</Chip>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{result.result || result.error}</p>
      {failed && result.failureRecoveryAction && result.failureRecoveryAction !== "none" ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => onRecoveryAction(result.failureRecoveryAction!)}>
          {automationRecoveryLabel(result.failureRecoveryAction)}
        </Button>
      ) : null}
    </div>
  );
}

/** 用一致的短列表呈现各数据源读取数量和样本标题。 */
export function AutomationSummaryList({ summary }: { summary: AutomationContextSummary[] }) {
  if (!summary.length) return <p className="mt-2 text-sm text-muted">尚未选择可读取的数据范围。</p>;
  return (
    <div className="mt-3 grid gap-2">
      {summary.map((item) => (
        <div key={item.scope} className="rounded-lg border border-line bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{item.label}</strong>
            <Chip tone={item.count ? "green" : "yellow"}>{item.count} 条</Chip>
          </div>
          {item.sampleTitles.length ? (
            <p className="mt-2 truncate text-xs text-muted">{item.sampleTitles.join(" / ")}</p>
          ) : (
            <p className="mt-2 text-xs text-muted">{item.warning ?? "暂无样本"}</p>
          )}
        </div>
      ))}
    </div>
  );
}
