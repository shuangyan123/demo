"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";
import type { FenbiImportCredential, FenbiSyncScope } from "../../types/domains/fenbi-import.ts";
import styles from "./fenbi-quick-import-panel.module.css";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

type FenbiQuickImportPanelProps = {
  credential?: FenbiImportCredential;
  status: "unconfigured" | "ready" | "validating" | "syncing" | "error";
  stage: "" | "validate" | "catalog" | "questions" | "normalize";
  progress: { completed: number; total?: number };
  error: string;
  fallbackRecommended: boolean;
  onCancel: () => void;
  onParseFileImport: (event: SubmitReactEvent) => void;
  onSaveCookie: (cookie: string) => Promise<boolean>;
  onSync: (scope: FenbiSyncScope) => Promise<void>;
  onValidate: () => Promise<boolean>;
};

const stageLabels = {
  validate: "正在验证会话",
  catalog: "正在读取错题板块",
  questions: "正在读取错题列表",
  normalize: "正在补齐答案与解析",
};

/** 粉笔账户快捷导入首屏；高级文本解析保留在下方 disclosure 中。 */
export function FenbiQuickImportPanel(props: FenbiQuickImportPanelProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [sinceDays, setSinceDays] = useState(30);
  const [keypointScope, setKeypointScope] = useState("all");
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const connected = Boolean(props.credential?.verifiedAt);
  const busy = props.status === "syncing" || props.status === "validating";
  const progressRatio = props.progress.total ? Math.min(100, Math.round(props.progress.completed / props.progress.total * 100)) : props.progress.completed ? 35 : 8;

  useEffect(() => {
    if (!configOpen) return;
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfigOpen(false);
      if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1) ?? first;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, [configOpen]);

  async function submitCookie() {
    const submittedCookie = cookieInput;
    setCookieInput("");
    if (await props.onSaveCookie(submittedCookie)) setConfigOpen(false);
  }

  return (
    <section className={styles.panel} aria-labelledby="fenbi-quick-title">
      <header className={styles.header}>
        <div className={styles.title}><AppIcon name="import" size={20} /><div><h2 id="fenbi-quick-title">粉笔快速导入</h2><p>实验直连 · 同步后先进入草稿</p></div></div>
      </header>
      <div className={styles.body}>
        <div className={styles.account}>
          <div className={styles.accountIdentity}><AppIcon name="review" size={20} /><div><strong>粉笔账户</strong><span className={styles.status}><span className={styles.dot} data-active={connected} />{connected ? `已连接 · ${props.credential?.maskedCookie} · Cookie 本机加密` : props.credential ? "待重新验证 · Cookie 本机加密" : "未配置账户"}</span></div></div>
          <div className={styles.accountActions}>{props.credential ? <button className={styles.textButton} type="button" disabled={busy} onClick={() => void props.onValidate()}>{props.status === "validating" ? "验证中" : "重新验证"}</button> : null}<button ref={returnFocusRef} className={styles.iconButton} type="button" aria-label="配置粉笔 Cookie" onClick={() => setConfigOpen(true)}><AppIcon name="configure" size={16} /></button></div>
        </div>
        {props.status === "syncing" ? <button className={styles.syncButton} type="button" onClick={props.onCancel}><AppIcon name="close" size={16} />取消同步</button> : <button className={styles.syncButton} type="button" disabled={!props.credential || props.status === "validating"} onClick={() => void props.onSync({ wrongOnly: true, sinceDays: sinceDays || undefined })}><AppIcon name="refresh" size={16} />同步错题</button>}
        <div className={styles.controls}>
          <label className={styles.label}>同步时间<select className={styles.select} value={sinceDays} onChange={(event) => setSinceDays(Number(event.currentTarget.value))}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option><option value={0}>全部时间</option></select></label>
          <label className={styles.label}>题目类型<select className={styles.select} value="wrong" disabled><option value="wrong">仅错题</option></select></label>
          <label className={styles.label}>同步范围<select className={styles.select} value={keypointScope} onChange={(event) => setKeypointScope(event.currentTarget.value)}><option value="all">全部板块</option></select></label>
        </div>

        {busy ? <div className={styles.progress} role="status"><div className={styles.progressMeta}><span>{props.stage ? stageLabels[props.stage] : "正在准备"}</span><span>{props.progress.total ? `${props.progress.completed} / ${props.progress.total}` : props.progress.completed ? `${props.progress.completed} 条` : ""}</span></div><div className={styles.track}><div className={styles.fill} style={{ width: `${progressRatio}%` }} /></div></div> : null}
        {props.error ? <p className={styles.error} role="alert">{props.error}{props.fallbackRecommended ? " 可直接使用下方官方导出文件继续。" : ""}</p> : null}

        <form className={styles.fallback} onSubmit={props.onParseFileImport}>
          <div className={styles.fallbackText}><strong>PDF / Word 官方导出兜底</strong><span>Cookie 失效或接口变化时，文件仍走现有本地草稿流程。</span></div>
          <div className={styles.actions}><input className={styles.fileInput} name="files" type="file" accept=".pdf,.doc,.docx,.txt,.csv,.json,image/*" multiple /><Button size="sm" type="submit" variant="outline">导入文件</Button></div>
        </form>
      </div>

      {configOpen && typeof document !== "undefined" ? createPortal(<div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfigOpen(false); }}><section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="fenbi-cookie-title" tabIndex={-1}><div className={styles.modalHeader}><div><h3 id="fenbi-cookie-title" className="font-semibold">配置实验直连</h3><p className="mt-1 text-xs text-muted">只粘贴 tiku.fenbi.com 当前会话 Cookie；本机加密保存。</p></div><button className={styles.iconButton} type="button" aria-label="关闭配置" onClick={() => setConfigOpen(false)}><AppIcon name="close" size={16} /></button></div><label className="sr-only" htmlFor="fenbi-cookie">粉笔 Cookie</label><textarea id="fenbi-cookie" className={styles.cookieInput} autoComplete="off" value={cookieInput} onChange={(event) => setCookieInput(event.currentTarget.value)} placeholder="粘贴 Cookie，不要填写账号密码" /><div className={styles.modalActions}><Button size="sm" type="button" variant="outline" onClick={() => setConfigOpen(false)}>取消</Button><Button size="sm" type="button" variant="primary" disabled={!cookieInput.trim() || props.status === "validating"} onClick={() => void submitCookie()}>{props.status === "validating" ? "验证中" : "保存并验证"}</Button></div></section></div>, document.body) : null}
    </section>
  );
}
