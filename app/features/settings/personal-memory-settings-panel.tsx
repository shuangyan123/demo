"use client";

/** 个性化记忆面板提供手动 CRUD、待确认建议和明确的作用域。 */
import { useState, type SyntheticEvent } from "react";
import { personalMemoryRepository } from "../../services/personal-memory-repository";
import type { PersonalMemoryKind, PersonalMemoryScope, PersonalizationSettings } from "../../types/review";
import { Button, Chip, EmptyState } from "../shared/ui-primitives";

type PersonalMemorySettingsPanelProps = {
  settings: PersonalizationSettings;
  onSettingsChange: (settings: PersonalizationSettings) => void;
  onNotice: (message: string) => void;
};

const kindLabels: Record<PersonalMemoryKind, string> = { profile: "个人资料", preference: "交流偏好", goal: "长期目标", study: "学习情况" };
const scopeLabels: Record<PersonalMemoryScope, string> = { global: "全局", module: "模块", conversation: "当前对话" };

/** 记忆操作直接持久化到 personalization 单例，避免未保存草稿与请求上下文不一致。 */
export function PersonalMemorySettingsPanel({ settings, onSettingsChange, onNotice }: PersonalMemorySettingsPanelProps) {
  const [kind, setKind] = useState<PersonalMemoryKind>("preference");
  const [scope, setScope] = useState<PersonalMemoryScope>("global");
  const [scopeTarget, setScopeTarget] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState("");
  const entries = settings.memoryEntries ?? [];

  async function addMemory(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("add");
    try {
      if (scope !== "global" && !scopeTarget.trim()) throw new Error(scope === "module" ? "请填写模块标识" : "请填写对话 ID");
      const saved = await personalMemoryRepository.addManual({ kind, scope, title, content, moduleId: scope === "module" ? scopeTarget : undefined, sourceConversationId: scope === "conversation" ? scopeTarget : undefined });
      onSettingsChange(saved);
      setTitle("");
      setContent("");
      onNotice("记忆已保存并生效");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "记忆保存失败");
    } finally {
      setBusy("");
    }
  }

  async function mutate(id: string, action: "confirm" | "archive" | "remove"): Promise<void> {
    setBusy(`${action}:${id}`);
    try {
      const saved = action === "confirm"
        ? await personalMemoryRepository.confirm(id)
        : action === "archive"
          ? await personalMemoryRepository.updateStatus(id, "archived")
          : await personalMemoryRepository.remove(id);
      onSettingsChange(saved);
      onNotice(action === "confirm" ? "记忆建议已确认" : action === "archive" ? "记忆已归档" : "记忆已删除");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "记忆操作失败");
    } finally {
      setBusy("");
    }
  }

  /** 自动建议默认关闭，切换后立即保存且不会回溯读取历史对话。 */
  async function toggleSuggestions(enabled: boolean): Promise<void> {
    const current = settings.memorySettings ?? { suggestionsEnabled: false, maxEntries: 100, contextCharacterLimit: 1500 };
    try {
      const saved = await personalMemoryRepository.updateSettings({ ...current, suggestionsEnabled: enabled });
      onSettingsChange(saved);
      onNotice(enabled ? "已允许 AI 提交待确认记忆建议" : "已关闭自动记忆建议");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "记忆建议设置失败");
    }
  }

  return (
    <section aria-label="记忆管理">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">记忆</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">只把你确认过的简短资料、偏好、目标和学习情况注入 AI 请求；不会保存完整对话、Prompt 或附件正文。</p>
        </div>
        <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input checked={settings.memorySettings?.suggestionsEnabled === true} className="ui-checkbox" role="switch" type="checkbox" onChange={(event) => void toggleSuggestions(event.currentTarget.checked)} />允许待确认建议</label>
      </div>

      <form className="mt-5 grid gap-3 rounded-lg border border-line bg-surface p-4" onSubmit={(event) => void addMemory(event)}>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className="ui-field">类型<select className="settings-select min-h-9" value={kind} onChange={(event) => setKind(event.currentTarget.value as PersonalMemoryKind)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="ui-field">范围<select className="settings-select min-h-9" value={scope} onChange={(event) => setScope(event.currentTarget.value as PersonalMemoryScope)}>{Object.entries(scopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label className="ui-field">标题<input className="ui-input" maxLength={80} placeholder="例如：回答风格" value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
        {scope !== "global" ? <label className="ui-field">{scope === "module" ? "模块标识" : "对话 ID"}<input className="ui-input" placeholder={scope === "module" ? "例如：interview" : "粘贴对话 ID"} value={scopeTarget} onChange={(event) => setScopeTarget(event.currentTarget.value)} /></label> : null}
        <label className="ui-field">内容<textarea className="ui-input min-h-20 resize-y" maxLength={2000} placeholder="例如：先给结论，再解释关键依据" value={content} onChange={(event) => setContent(event.currentTarget.value)} /></label>
        <div><Button type="submit" size="sm" variant="primary" disabled={busy === "add" || !title.trim() || !content.trim()}>{busy === "add" ? "保存中" : "添加记忆"}</Button></div>
      </form>

      <div className="mt-5 divide-y divide-line border-y border-line">
        {entries.length ? entries.map((entry) => (
          <article key={entry.id} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{entry.title}</strong><Chip tone={entry.status === "active" ? "green" : entry.status === "pending" ? "yellow" : "neutral"}>{entry.status === "active" ? "已生效" : entry.status === "pending" ? "待确认" : "已归档"}</Chip><span className="text-xs text-muted">{kindLabels[entry.kind]} · {scopeLabels[entry.scope]}</span></div>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{entry.content}</p>
            </div>
            <div className="flex gap-1">
              {entry.status === "pending" ? <Button size="sm" variant="soft" disabled={Boolean(busy)} onClick={() => void mutate(entry.id, "confirm")}>确认</Button> : null}
              {entry.status === "active" ? <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void mutate(entry.id, "archive")}>归档</Button> : null}
              <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void mutate(entry.id, "remove")}>删除</Button>
            </div>
          </article>
        )) : <div className="py-5"><EmptyState>还没有记忆。手动添加后会立即生效。</EmptyState></div>}
      </div>
      <p className="mt-3 text-xs text-muted">{entries.length}/100 条 · 每次请求最多注入 {settings.memorySettings?.contextCharacterLimit ?? 1500} 字符</p>
    </section>
  );
}
