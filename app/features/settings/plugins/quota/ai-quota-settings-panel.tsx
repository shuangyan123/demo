"use client";

/** 额度设置以紧凑状态表为主，凭据和预算只在行级配置层中编辑。 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { aiQuotaRepository } from "../../../../services/ai-quota-repository";
import { aiQuotaRuntime, type AiQuotaRuntimeStatus } from "../../../../services/ai-quota-runtime";
import { aiConnectionsRepository } from "../../../../services/ai-connections-repository";
import type { AiQuotaCredentialKey, AiQuotaPluginConfig, ApiConnectionProfile, ApiProvider } from "../../../../types/review";
import { AppIcon } from "../../../shared/app-icon";
import { ProviderIcon } from "../../../shared/provider-icon";
import { Button, EmptyState } from "../../../shared/ui-primitives";
import styles from "../../settings-compact.module.css";
import { QuotaMetricRing } from "./quota-metric-ring";

type QuotaFormState = Record<string, {
  enabled: boolean;
  credentials: Partial<Record<AiQuotaCredentialKey, string>>;
  monthlyBudget: string;
  manualRemaining: string;
}>;

/** 将加密配置转换为不包含秘密明文的编辑草稿。 */
function formFromConfig(config?: AiQuotaPluginConfig) {
  return {
    enabled: config?.enabled ?? false,
    credentials: { teamId: config?.parameters?.teamId ?? "" },
    monthlyBudget: config?.monthlyBudget?.toString() ?? "",
    manualRemaining: config?.manualRemaining?.toString() ?? "",
  };
}

const statusLabels: Record<AiQuotaRuntimeStatus, string> = {
  disabled: "未启用",
  "needs-credentials": "待配置",
  refreshing: "刷新中",
  ready: "已连接",
  stale: "数据可能已过期",
  error: "失败",
};

/** 额度面板只调用官方只读接口或手动来源，启用后立即进入运行时生命周期。 */
export function AiQuotaSettingsPanel() {
  const initialState = useMemo(() => aiQuotaRepository.loadSync(), []);
  const runtime = useSyncExternalStore(aiQuotaRuntime.subscribe, aiQuotaRuntime.getSnapshot, aiQuotaRuntime.getServerSnapshot);
  const configs = runtime.configs.length ? runtime.configs : initialState.configs;
  const snapshots = runtime.snapshots.length ? runtime.snapshots : initialState.snapshots;
  const [forms, setForms] = useState<QuotaFormState>(() => Object.fromEntries(aiQuotaRepository.plugins.map((plugin) => [
    plugin.id,
    formFromConfig(initialState.configs.find((config) => config.id === plugin.id)),
  ])));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<ApiProvider | "manual">();
  const [successId, setSuccessId] = useState<ApiProvider | "manual">();
  const [connectionProfiles, setConnectionProfiles] = useState<ApiConnectionProfile[]>([]);
  const [selectedDeepSeekConnectionId, setSelectedDeepSeekConnectionId] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const configById = useMemo(() => new Map(configs.map((config) => [config.id, config])), [configs]);
  const snapshotById = useMemo(() => new Map(snapshots.map((snapshot) => [snapshot.id, snapshot])), [snapshots]);
  const editingPlugin = aiQuotaRepository.plugins.find((plugin) => plugin.id === editingId);

  useEffect(() => {
    void aiQuotaRuntime.initialize();
    void aiConnectionsRepository.loadSnapshot().then((snapshot) => {
      setConnectionProfiles(snapshot.profiles);
      setSelectedDeepSeekConnectionId(snapshot.profiles.find((profile) => profile.provider === "deepseek")?.id ?? "");
    }).catch(() => setNotice("已连接模型服务暂时无法读取；仍可单独配置额度凭据"));
  }, []);

  useEffect(() => {
    if (!editingId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("input, button, a")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditingId(undefined);
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
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
  }, [editingId]);

  /** 以函数式更新合并单厂商编辑草稿，避免额度运行时刷新覆盖未保存输入。 */
  function patchForm(id: string, patch: Partial<QuotaFormState[string]>) {
    setForms((current) => ({ ...current, [id]: { ...(current[id] ?? formFromConfig(configById.get(id as ApiProvider | "manual"))), ...patch } }));
  }

  async function save(id: ApiProvider | "manual") {
    const form = forms[id] ?? formFromConfig(configById.get(id));
    setBusy(`save:${id}`);
    try {
      await aiQuotaRuntime.saveAndActivate({ id, enabled: form.enabled, credentials: form.credentials, monthlyBudget: Number(form.monthlyBudget) || undefined, manualRemaining: Number(form.manualRemaining) || undefined, today: new Date() });
      setNotice(form.enabled ? "额度配置已保存并启动刷新" : "额度配置已保存");
      setEditingId(undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "额度配置保存失败");
    } finally {
      setBusy("");
    }
  }

  async function validateQuota(id: ApiProvider | "manual") {
    setBusy(`validate:${id}`);
    try { setNotice(await aiQuotaRuntime.validate(id)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "额度凭据验证失败"); }
    finally { setBusy(""); }
  }

  async function refreshQuota(id: ApiProvider | "manual") {
    setBusy(`refresh:${id}`);
    try {
      await aiQuotaRuntime.manualRefresh(id);
      setSuccessId(id);
      window.setTimeout(() => setSuccessId((current) => current === id ? undefined : current), 1200);
      setNotice("额度快照已刷新");
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "额度刷新失败"); }
    finally { setBusy(""); }
  }

  /** 仅在用户显式点击后引用同厂商模型连接 Key，不自动扩大凭据用途。 */
  async function reuseDeepSeekConnectionKey(): Promise<void> {
    const profile = connectionProfiles.find((item) => item.id === selectedDeepSeekConnectionId && item.provider === "deepseek");
    if (!profile) return;
    setBusy("reuse:deepseek");
    try {
      const apiKey = await aiConnectionsRepository.resolveSecret(profile);
      const form = forms.deepseek ?? formFromConfig(configById.get("deepseek"));
      patchForm("deepseek", { credentials: { ...form.credentials, apiKey } });
      setNotice(`已引用“${profile.label}”的 Key，保存额度配置后生效`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "连接 Key 引用失败");
    } finally {
      setBusy("");
    }
  }

  /** 启用开关立即落库并启动或停止刷新，不要求用户再点一次保存。 */
  async function toggleEnabled(id: ApiProvider | "manual", enabled: boolean): Promise<void> {
    const form = forms[id] ?? formFromConfig(configById.get(id));
    patchForm(id, { enabled });
    setBusy(`toggle:${id}`);
    try {
      await aiQuotaRuntime.saveAndActivate({ id, enabled, credentials: form.credentials, monthlyBudget: Number(form.monthlyBudget) || undefined, manualRemaining: Number(form.manualRemaining) || undefined, today: new Date() });
      setNotice(enabled ? (aiQuotaRepository.isConfigured(id) ? "已启用并刷新额度" : "已启用，等待配置凭据") : "已停用额度刷新");
    } catch (error) {
      patchForm(id, { enabled: !enabled });
      setNotice(error instanceof Error ? error.message : "额度启用状态保存失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.tableSection} aria-label="AI 额度与用量">
      <div className={styles.header}>
        <div><h2>额度与用量</h2><p>账单凭据独立加密；没有官方接口的厂商仅支持控制台或手动记录。</p></div>
        {notice ? <span className={styles.muted} role="status">{notice}</span> : null}
      </div>
      {aiQuotaRepository.plugins.length ? (
        <div className={styles.table}>
          <div className={`${styles.tableHeader} ${styles.quotaColumns}`}><span>提供商</span><span>启用</span><span>连接状态</span><span>额度/用量</span><span>最后刷新</span><span>数据来源</span><span>操作</span></div>
          {aiQuotaRepository.plugins.map((plugin) => {
            const form = forms[plugin.id] ?? formFromConfig(configById.get(plugin.id));
            const snapshot = snapshotById.get(plugin.id);
            const runtimeEntry = runtime.entries[plugin.id];
            const runtimeStatus: AiQuotaRuntimeStatus = runtimeEntry?.status ?? (form.enabled ? "needs-credentials" : "disabled");
            const tone = runtimeStatus === "ready" ? undefined : runtimeStatus === "error" ? "red" : runtimeStatus === "refreshing" ? "blue" : "yellow";
            return (
              <div key={plugin.id} className={`${styles.tableRow} ${styles.quotaColumns}`}>
                <button ref={(node) => { if (editingId === plugin.id && node) returnFocusRef.current = node; }} aria-label={`配置${plugin.label}额度`} className={styles.providerCell} type="button" onClick={(event) => { returnFocusRef.current = event.currentTarget; setEditingId(plugin.id); }}><ProviderIcon provider={plugin.id === "manual" ? "custom" : plugin.id} size={24} /><strong>{plugin.label}</strong><AppIcon name="configure" size={16} /></button>
                <input aria-label={`启用${plugin.label}额度刷新`} checked={form.enabled} className="ui-checkbox" disabled={Boolean(busy)} role="switch" type="checkbox" onChange={(event) => void toggleEnabled(plugin.id, event.currentTarget.checked)} />
                <span className={styles.providerCell}><i className={styles.statusDot} data-tone={tone} /><span className={styles.truncate}>{statusLabels[runtimeStatus]}</span></span>
                <QuotaMetricRing snapshot={snapshot} />
                <span className={styles.muted}>{snapshot ? new Date(snapshot.refreshedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未刷新"}</span>
                <span className={`${styles.muted} ${styles.truncate}`}>{snapshot?.sourceLabel ?? (plugin.supportsOfficialRefresh ? "官方（自动同步）" : "手动配置")}</span>
                <button aria-label={`刷新${plugin.label}额度`} className={styles.iconButton} disabled={Boolean(busy) || !form.enabled} type="button" onClick={() => void refreshQuota(plugin.id)}><span className={runtimeStatus === "refreshing" ? styles.spin : undefined}><AppIcon name={runtimeStatus === "error" || runtimeStatus === "stale" ? "warning" : successId === plugin.id ? "check" : "refresh"} size={16} /></span></button>
              </div>
            );
          })}
        </div>
      ) : <EmptyState>暂无额度配置。</EmptyState>}

      {editingPlugin && editingId && typeof document !== "undefined" ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(undefined); }}>
          <section ref={dialogRef} aria-labelledby="quota-dialog-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeader}><h3 id="quota-dialog-title" className="text-base font-semibold">配置 {editingPlugin.label}</h3><button aria-label="关闭额度配置" className={styles.iconButton} type="button" onClick={() => setEditingId(undefined)}><AppIcon name="close" size={16} /></button></div>
            <div className={styles.modalForm}>
              <p className={styles.muted}>{runtime.entries[editingId]?.message ?? "启用后仅在页面可见且在线时刷新。"}</p>
              {editingId === "deepseek" && connectionProfiles.some((profile) => profile.provider === "deepseek") ? <div className={styles.credentialReuse}>
                <label className="ui-field">引用已保存连接<select className={styles.select} value={selectedDeepSeekConnectionId} onChange={(event) => setSelectedDeepSeekConnectionId(event.currentTarget.value)}>{connectionProfiles.filter((profile) => profile.provider === "deepseek").map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.maskedKey}</option>)}</select></label>
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void reuseDeepSeekConnectionKey()}>{busy === "reuse:deepseek" ? "引用中" : "引用连接 Key"}</Button>
              </div> : null}
              {editingPlugin.credentialFields.map((field) => {
                const form = forms[editingId] ?? formFromConfig(configById.get(editingId));
                return <label key={field.key} className="ui-field">{field.label}<input className={styles.input} type={field.secret ? "password" : "text"} placeholder={field.secret && (configById.get(editingId)?.encryptedCredentials?.[field.key as Exclude<AiQuotaCredentialKey, "teamId">]?.maskedKey || configById.get(editingId)?.maskedKey) ? "留空保留原凭据" : field.required ? "填写额度查询凭据" : "可选"} value={form.credentials[field.key] ?? ""} onChange={(event) => { const value = event.currentTarget.value; patchForm(editingId, { credentials: { ...form.credentials, [field.key]: value } }); }} /></label>;
              })}
              <label className="ui-field">月预算<input className={styles.input} inputMode="decimal" value={(forms[editingId] ?? formFromConfig(configById.get(editingId))).monthlyBudget} onChange={(event) => { const value = event.currentTarget.value; patchForm(editingId, { monthlyBudget: value }); }} /></label>
              <label className="ui-field">手动剩余<input className={styles.input} inputMode="decimal" value={(forms[editingId] ?? formFromConfig(configById.get(editingId))).manualRemaining} onChange={(event) => { const value = event.currentTarget.value; patchForm(editingId, { manualRemaining: value }); }} /></label>
            </div>
            <div className={styles.modalActions}>
              {editingPlugin.dashboardUrl ? <a className="ui-button ui-button-sm ui-button-outline" href={editingPlugin.dashboardUrl} rel="noreferrer" target="_blank">官网账单</a> : null}
              {editingPlugin.supportsOfficialRefresh ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void validateQuota(editingId)}>{busy === `validate:${editingId}` ? "验证中" : "测试凭据"}</Button> : null}
              <Button size="sm" variant="outline" disabled={Boolean(busy) || !(forms[editingId]?.enabled)} onClick={() => void refreshQuota(editingId)}>{busy === `refresh:${editingId}` ? "刷新中" : "刷新"}</Button>
              <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => void save(editingId)}>{busy === `save:${editingId}` ? "保存中" : "保存"}</Button>
            </div>
          </section>
        </div>
      ), document.body) : null}
    </section>
  );
}
