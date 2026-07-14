"use client";

/** 个性化记忆以列表为首屏，新增和编辑通过紧凑模态层完成。 */
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { personalMemoryRepository } from "../../services/personal-memory-repository";
import type { PersonalMemoryEntry, PersonalMemoryKind, PersonalMemoryScope, PersonalizationSettings } from "../../types/review";
import { AppIcon } from "../shared/app-icon";
import { Button, EmptyState } from "../shared/ui-primitives";
import styles from "./settings-compact.module.css";

type PersonalMemorySettingsPanelProps = {
  settings: PersonalizationSettings;
  onSettingsChange: (settings: PersonalizationSettings) => void;
  onNotice: (message: string) => void;
};

const kindLabels: Record<PersonalMemoryKind, string> = { profile: "资料", preference: "偏好", goal: "目标", study: "学习" };
const scopeLabels: Record<PersonalMemoryScope, string> = { global: "全局", module: "模块", conversation: "会话" };

/** 记忆操作直接持久化到 personalization 单例，避免草稿与请求上下文不一致。 */
export function PersonalMemorySettingsPanel({ settings, onSettingsChange, onNotice }: PersonalMemorySettingsPanelProps) {
  const [kind, setKind] = useState<PersonalMemoryKind>("preference");
  const [scope, setScope] = useState<PersonalMemoryScope>("global");
  const [scopeTarget, setScopeTarget] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const entries = settings.memoryEntries ?? [];

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("select, input, textarea")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditorOpen(false);
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [editorOpen]);

  /** 打开空白编辑器；关闭前的触发器用于完成后的焦点恢复。 */
  function openCreate(trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setEditingId(undefined);
    setKind("preference"); setScope("global"); setScopeTarget(""); setTitle(""); setContent("");
    setEditorOpen(true);
  }

  /** 编辑时复用相同表单，但不改变原条目的来源、状态和创建时间。 */
  function openEdit(entry: PersonalMemoryEntry, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setEditingId(entry.id);
    setKind(entry.kind); setScope(entry.scope); setScopeTarget(entry.moduleId ?? entry.sourceConversationId ?? ""); setTitle(entry.title); setContent(entry.content);
    setEditorOpen(true);
  }

  async function saveMemory(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("save");
    try {
      if (scope !== "global" && !scopeTarget.trim()) throw new Error(scope === "module" ? "请填写模块标识" : "请填写对话 ID");
      const input = { kind, scope, title, content, moduleId: scope === "module" ? scopeTarget : undefined, sourceConversationId: scope === "conversation" ? scopeTarget : undefined };
      const saved = editingId ? await personalMemoryRepository.update(editingId, input) : await personalMemoryRepository.addManual(input);
      onSettingsChange(saved);
      setEditorOpen(false);
      onNotice(editingId ? "记忆已更新" : "记忆已保存并生效");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "记忆保存失败");
    } finally { setBusy(""); }
  }

  async function mutate(id: string, action: "confirm" | "archive" | "remove"): Promise<void> {
    setBusy(`${action}:${id}`);
    try {
      const saved = action === "confirm" ? await personalMemoryRepository.confirm(id) : action === "archive" ? await personalMemoryRepository.updateStatus(id, "archived") : await personalMemoryRepository.remove(id);
      onSettingsChange(saved);
      onNotice(action === "confirm" ? "记忆建议已确认" : action === "archive" ? "记忆已归档" : "记忆已删除");
    } catch (error) { onNotice(error instanceof Error ? error.message : "记忆操作失败"); }
    finally { setBusy(""); }
  }

  /** 自动建议默认关闭，切换后立即保存且不会回溯读取历史对话。 */
  async function toggleSuggestions(enabled: boolean): Promise<void> {
    const current = settings.memorySettings ?? { suggestionsEnabled: false, maxEntries: 100, contextCharacterLimit: 1500 };
    try {
      const saved = await personalMemoryRepository.updateSettings({ ...current, suggestionsEnabled: enabled });
      onSettingsChange(saved);
      onNotice(enabled ? "已允许 AI 提交待确认记忆建议" : "已关闭自动记忆建议");
    } catch (error) { onNotice(error instanceof Error ? error.message : "记忆建议设置失败"); }
  }

  return (
    <section className={styles.section} aria-label="记忆管理">
      <div className={styles.header}>
        <div><h2>记忆</h2><p>仅把你确认的简短资料、偏好、目标和学习情况注入 AI 请求。</p></div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="inline-flex min-h-9 items-center gap-2 text-xs"><input checked={settings.memorySettings?.suggestionsEnabled === true} className="ui-checkbox" role="switch" type="checkbox" onChange={(event) => void toggleSuggestions(event.currentTarget.checked)} />允许建议</label>
          <Button size="sm" variant="outline" onClick={(event) => openCreate(event.currentTarget)}>添加记忆</Button>
        </div>
      </div>
      {entries.length ? (
        <div className={styles.table}>
          <div className={`${styles.tableHeader} ${styles.memoryColumns}`}><span>类型</span><span>范围</span><span>内容</span><span>待确认建议</span><span>操作</span></div>
          {entries.map((entry) => (
            <div key={entry.id} className={`${styles.tableRow} ${styles.memoryColumns}`}>
              <span>{kindLabels[entry.kind]}</span>
              <span>{scopeLabels[entry.scope]}</span>
              <span className={styles.truncate} title={`${entry.title}：${entry.content}`}><strong>{entry.title}</strong>　<span className={styles.muted}>{entry.content}</span></span>
              <span className={styles.muted}>{entry.status === "pending" ? "● 新建议" : entry.status === "archived" ? "已归档" : "无"}</span>
              <span className="flex justify-end gap-1">
                {entry.status === "pending" ? <><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void mutate(entry.id, "confirm")}>确认</Button><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void mutate(entry.id, "remove")}>忽略</Button></> : <><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={(event) => openEdit(entry, event.currentTarget)}>编辑</Button><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void mutate(entry.id, "remove")}>删除</Button></>}
              </span>
            </div>
          ))}
        </div>
      ) : <div className="mt-4"><EmptyState>还没有记忆。手动添加后会立即生效。</EmptyState></div>}
      <p className="mt-3 text-xs text-muted">{entries.length}/100 条 · 每次请求最多注入 {settings.memorySettings?.contextCharacterLimit ?? 1500} 字符</p>

      {editorOpen && typeof document !== "undefined" ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
          <section ref={dialogRef} aria-labelledby="memory-editor-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeader}><h3 id="memory-editor-title" className="text-base font-semibold">{editingId ? "编辑记忆" : "添加记忆"}</h3><button aria-label="关闭记忆编辑器" className={styles.iconButton} type="button" onClick={() => setEditorOpen(false)}><AppIcon name="close" size={16} /></button></div>
            <form className={styles.modalForm} onSubmit={(event) => void saveMemory(event)}>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <label className="ui-field">类型<select className={styles.select} value={kind} onChange={(event) => setKind(event.currentTarget.value as PersonalMemoryKind)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="ui-field">范围<select className={styles.select} value={scope} onChange={(event) => setScope(event.currentTarget.value as PersonalMemoryScope)}>{Object.entries(scopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              </div>
              <label className="ui-field">标题<input className={styles.input} maxLength={80} placeholder="例如：回答风格" value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
              {scope !== "global" ? <label className="ui-field">{scope === "module" ? "模块标识" : "对话 ID"}<input className={styles.input} value={scopeTarget} onChange={(event) => setScopeTarget(event.currentTarget.value)} /></label> : null}
              <label className="ui-field">内容<textarea className="ui-input min-h-24 resize-y" maxLength={2000} placeholder="例如：先给结论，再解释关键依据" value={content} onChange={(event) => setContent(event.currentTarget.value)} /></label>
              <div className={styles.modalActions}><Button size="sm" variant="outline" onClick={() => setEditorOpen(false)}>取消</Button><Button size="sm" type="submit" variant="primary" disabled={busy === "save"}>{busy === "save" ? "保存中" : "保存"}</Button></div>
            </form>
          </section>
        </div>
      ), document.body) : null}
    </section>
  );
}
