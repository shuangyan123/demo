"use client";

/** 额度设置以紧凑状态表为主，凭据和预算只在行级配置层中编辑。 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { aiQuotaRepository } from "../../../../services/ai-quota-repository";
import { aiQuotaRuntime, type AiQuotaRuntimeStatus } from "../../../../services/ai-quota-runtime";
import { aiConnectionsRepository } from "../../../../services/ai-connections-repository";
import type { AiQuotaCredentialKey, AiQuotaPluginConfig, AiQuotaSnapshot } from "../../../../types/domains/ai-quota.ts";
import type { ApiConnectionProfile } from "../../../../types/domains/ai-connection.ts";
import type { ApiProvider } from "../../../../types/domains/ai-provider.ts";
import { AppIcon } from "../../../shared/app-icon";
import { DevelopmentExampleSwitcher, useDevelopmentExample, type DevelopmentExampleOption } from "../../../shared/development-example-switcher";
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
const quotaExampleOptions: DevelopmentExampleOption[] = [
  { id: "quota-ready", label: "成功与手动额度" },
  { id: "quota-refreshing", label: "刷新中" },
  { id: "quota-stale", label: "过期与失败" },
  { id: "quota-needs-credentials", label: "待配置" },
];

/** 额度入口在开发环境可使用纯内存示例，示例态不初始化运行时或仓储。 */
export function AiQuotaSettingsPanel({ developmentExample }: { developmentExample?: string }) {
  const example = useDevelopmentExample(developmentExample, quotaExampleOptions);
  if (example.value) {
    return (
      <>
        <DevelopmentExampleSwitcher options={quotaExampleOptions} value={example.value} onChange={example.select} />
        <AiQuotaDevelopmentExample scenario={example.value} />
      </>
    );
  }
  return (
    <>
      {example.enabled ? <DevelopmentExampleSwitcher options={quotaExampleOptions} value={example.value} onChange={example.select} /> : null}
      <AiQuotaSettingsLivePanel />
    </>
  );
}

/** 展示额度表需要用户配置后才会出现的状态，所有数值均为明确示例。 */
function AiQuotaDevelopmentExample({ scenario }: { scenario: string }) {
  const status: AiQuotaRuntimeStatus = scenario === "quota-refreshing"
    ? "refreshing"
    : scenario === "quota-stale"
      ? "stale"
      : scenario === "quota-needs-credentials"
        ? "needs-credentials"
        : "ready";
  const snapshot: AiQuotaSnapshot | undefined = status === "needs-credentials" ? undefined : {
    id: "openai",
    provider: "openai",
    label: "OpenAI",
    status: "ready",
    source: "official",
    metrics: [{ id: "used_cost", label: "已用费用", value: 18.6, unit: "USD", source: "official" }],
    usedAmount: 18.6,
    remainingAmount: 31.4,
    currency: "USD",
    periodLabel: "本月",
    sourceLabel: "官方只读接口",
    usageRatio: 0.372,
    officialRemainingAvailable: true,
    message: status === "stale" ? "上次刷新失败，保留最近成功快照" : "额度快照已刷新",
    refreshedAt: "2026-07-26T02:24:00.000Z",
    stale: status === "stale",
  };
  const rows = [
    { id: "openai" as const, label: "OpenAI", enabled: true, status, snapshot, source: "官方（自动同步）" },
    { id: "manual" as const, label: "手动额度", enabled: scenario !== "quota-needs-credentials", status: scenario === "quota-needs-credentials" ? "disabled" as const : "ready" as const, snapshot: undefined, source: "手动配置" },
  ];
  return (
    <section className={styles.tableSection} aria-label="AI 额度开发示例">
      <div className={styles.header}>
        <div><h2>额度与用量</h2><p>示例用于批注启停、刷新、失败和待配置状态。</p></div>
        <span className={styles.muted} role="status">{status === "stale" ? "刷新失败但启用状态保持" : "开发示例"}</span>
      </div>
      <div className={styles.table}>
        <div className={`${styles.tableHeader} ${styles.quotaColumns}`}><span>提供商</span><span className={styles.cellCenter}>启用</span><span>连接状态</span><span className={styles.cellCenter}>额度/用量</span><span>最后刷新</span><span>数据来源</span><span className={styles.cellCenter}>操作</span></div>
        {rows.map((row) => (
          <div key={row.id} className={`${styles.tableRow} ${styles.quotaColumns}`}>
            <button className={styles.providerCell} type="button"><ProviderIcon provider={row.id === "manual" ? "custom" : row.id} size={24} /><strong>{row.label}</strong><AppIcon name="configure" size={16} /></button>
            <span className={styles.cellCenter}><input aria-label={`启用${row.label}额度刷新示例`} checked={row.enabled} className="ui-checkbox" readOnly role="switch" type="checkbox" /></span>
            <span className={styles.providerCell}><i className={styles.statusDot} data-tone={row.status === "stale" ? "yellow" : row.status === "refreshing" ? "blue" : undefined} /><span className={styles.truncate}>{statusLabels[row.status]}</span></span>
            <span className={styles.cellCenter}><QuotaMetricRing snapshot={row.snapshot} /></span>
            <span className={styles.muted}>{row.snapshot ? "今天 10:24" : "未刷新"}</span>
            <span className={`${styles.muted} ${styles.truncate}`}>{row.source}</span>
            <span className={styles.cellCenter}><button aria-label={`刷新${row.label}额度示例`} className={styles.iconButton} disabled={!row.enabled} type="button"><span className={row.status === "refreshing" ? styles.spin : undefined}><AppIcon name={row.status === "stale" ? "warning" : "refresh"} size={16} /></span></button></span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 额度面板只调用官方只读接口或手动来源，启用后立即进入运行时生命周期。 */
function AiQuotaSettingsLivePanel() {
  const initialState = useMemo(() => aiQuotaRepository.loadSync(), []);
  const runtime = useSyncExternalStore(aiQuotaRuntime.subscribe, aiQuotaRuntime.getSnapshot, aiQuotaRuntime.getServerSnapshot);
  const configs = runtime.configs.length ? runtime.configs : initialState.configs;
  const snapshots = runtime.snapshots.length ? runtime.snapshots : initialState.snapshots;
  const [forms, setForms] = useState<QuotaFormState>(() => Object.fromEntries(aiQuotaRepository.plugins.map((plugin) => [
    plugin.id,
    formFromConfig(initialState.configs.find((config) => config.id === plugin.id)),
  ])));
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
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
  const isBusy = (action: string) => busyActions.has(action);
  const isProviderBusy = (id: ApiProvider | "manual") => [...busyActions].some((action) => action.endsWith(`:${id}`));

  /** Busy 状态按动作和厂商隔离，避免一个长请求锁住整张额度表。 */
  function setActionBusy(action: string, active: boolean): void {
    setBusyActions((current) => {
      const next = new Set(current);
      if (active) next.add(action);
      else next.delete(action);
      return next;
    });
  }

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
    const action = `save:${id}`;
    setActionBusy(action, true);
    try {
      await aiQuotaRuntime.saveAndActivate({ id, enabled: form.enabled, credentials: form.credentials, monthlyBudget: Number(form.monthlyBudget) || undefined, manualRemaining: Number(form.manualRemaining) || undefined, today: new Date() });
      setNotice(form.enabled ? "额度配置已保存并启动刷新" : "额度配置已保存");
      setEditingId(undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "额度配置保存失败");
    } finally {
      setActionBusy(action, false);
    }
  }

  async function validateQuota(id: ApiProvider | "manual") {
    const action = `validate:${id}`;
    setActionBusy(action, true);
    try { setNotice(await aiQuotaRuntime.validate(id)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "额度凭据验证失败"); }
    finally { setActionBusy(action, false); }
  }

  async function refreshQuota(id: ApiProvider | "manual") {
    const action = `refresh:${id}`;
    setActionBusy(action, true);
    try {
      await aiQuotaRuntime.manualRefresh(id);
      setSuccessId(id);
      window.setTimeout(() => setSuccessId((current) => current === id ? undefined : current), 1200);
      setNotice("额度快照已刷新");
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "额度刷新失败"); }
    finally { setActionBusy(action, false); }
  }

  /** 仅在用户显式点击后引用同厂商模型连接 Key，不自动扩大凭据用途。 */
  async function reuseDeepSeekConnectionKey(): Promise<void> {
    const profile = connectionProfiles.find((item) => item.id === selectedDeepSeekConnectionId && item.provider === "deepseek");
    if (!profile) return;
    const action = "reuse:deepseek";
    setActionBusy(action, true);
    try {
      const apiKey = await aiConnectionsRepository.resolveSecret(profile);
      const form = forms.deepseek ?? formFromConfig(configById.get("deepseek"));
      patchForm("deepseek", { credentials: { ...form.credentials, apiKey } });
      setNotice(`已引用“${profile.label}”的 Key，保存额度配置后生效`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "连接 Key 引用失败");
    } finally {
      setActionBusy(action, false);
    }
  }

  /** 启用开关立即落库并启动或停止刷新，不要求用户再点一次保存。 */
  async function toggleEnabled(id: ApiProvider | "manual", enabled: boolean): Promise<void> {
    patchForm(id, { enabled });
    const action = `toggle:${id}`;
    setActionBusy(action, true);
    try {
      await aiQuotaRuntime.setEnabled(id, enabled, new Date());
      setNotice(enabled ? (aiQuotaRepository.isConfigured(id) ? "已启用，正在后台刷新额度" : "已启用，等待配置凭据") : "已停用额度刷新");
    } catch (error) {
      patchForm(id, { enabled: !enabled });
      setNotice(error instanceof Error ? error.message : "额度启用状态保存失败");
    } finally {
      setActionBusy(action, false);
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
          <div className={`${styles.tableHeader} ${styles.quotaColumns}`}><span>提供商</span><span className={styles.cellCenter}>启用</span><span>连接状态</span><span className={styles.cellCenter}>额度/用量</span><span>最后刷新</span><span>数据来源</span><span className={styles.cellCenter}>操作</span></div>
          {aiQuotaRepository.plugins.map((plugin) => {
            const form = forms[plugin.id] ?? formFromConfig(configById.get(plugin.id));
            const snapshot = snapshotById.get(plugin.id);
            const runtimeEntry = runtime.entries[plugin.id];
            const runtimeStatus: AiQuotaRuntimeStatus = runtimeEntry?.status ?? (form.enabled ? "needs-credentials" : "disabled");
            const tone = runtimeStatus === "ready" ? undefined : runtimeStatus === "error" ? "red" : runtimeStatus === "refreshing" ? "blue" : "yellow";
            return (
              <div key={plugin.id} className={`${styles.tableRow} ${styles.quotaColumns}`}>
                <button ref={(node) => { if (editingId === plugin.id && node) returnFocusRef.current = node; }} aria-label={`配置${plugin.label}额度`} className={styles.providerCell} type="button" onClick={(event) => { returnFocusRef.current = event.currentTarget; setEditingId(plugin.id); }}><ProviderIcon provider={plugin.id === "manual" ? "custom" : plugin.id} size={24} /><strong>{plugin.label}</strong><AppIcon name="configure" size={16} /></button>
                <span className={styles.cellCenter}><input aria-label={`启用${plugin.label}额度刷新`} checked={form.enabled} className="ui-checkbox" disabled={isBusy(`toggle:${plugin.id}`)} role="switch" type="checkbox" onChange={(event) => void toggleEnabled(plugin.id, event.currentTarget.checked)} /></span>
                <span className={styles.providerCell}><i className={styles.statusDot} data-tone={tone} /><span className={styles.truncate}>{statusLabels[runtimeStatus]}</span></span>
                <span className={styles.cellCenter}><QuotaMetricRing snapshot={snapshot} /></span>
                <span className={styles.muted}>{snapshot ? new Date(snapshot.refreshedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未刷新"}</span>
                <span className={`${styles.muted} ${styles.truncate}`}>{snapshot?.sourceLabel ?? (plugin.supportsOfficialRefresh ? "官方（自动同步）" : "手动配置")}</span>
                <span className={styles.cellCenter}><button aria-label={`刷新${plugin.label}额度`} className={styles.iconButton} disabled={isProviderBusy(plugin.id) || !form.enabled} type="button" onClick={() => void refreshQuota(plugin.id)}><span className={runtimeStatus === "refreshing" ? styles.spin : undefined}><AppIcon name={runtimeStatus === "error" || runtimeStatus === "stale" ? "warning" : successId === plugin.id ? "check" : "refresh"} size={16} /></span></button></span>
              </div>
            );
          })}
        </div>
      ) : <EmptyState stateId="settings.quota.empty">暂无额度配置。</EmptyState>}

      {editingPlugin && editingId && typeof document !== "undefined" ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(undefined); }}>
          <section ref={dialogRef} aria-labelledby="quota-dialog-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeader}><h3 id="quota-dialog-title" className="text-base font-semibold">配置 {editingPlugin.label}</h3><button aria-label="关闭额度配置" className={styles.iconButton} type="button" onClick={() => setEditingId(undefined)}><AppIcon name="close" size={16} /></button></div>
            <div className={styles.modalForm}>
              <p className={styles.muted}>{runtime.entries[editingId]?.message ?? "启用后仅在页面可见且在线时刷新。"}</p>
              {editingId === "deepseek" && connectionProfiles.some((profile) => profile.provider === "deepseek") ? <div className={styles.credentialReuse}>
                <label className="ui-field">引用已保存连接<select className={styles.select} value={selectedDeepSeekConnectionId} onChange={(event) => setSelectedDeepSeekConnectionId(event.currentTarget.value)}>{connectionProfiles.filter((profile) => profile.provider === "deepseek").map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.maskedKey}</option>)}</select></label>
                <Button size="sm" variant="outline" disabled={isProviderBusy("deepseek")} onClick={() => void reuseDeepSeekConnectionKey()}>{isBusy("reuse:deepseek") ? "引用中" : "引用连接 Key"}</Button>
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
              {editingPlugin.supportsOfficialRefresh ? <Button size="sm" variant="outline" disabled={isProviderBusy(editingId)} onClick={() => void validateQuota(editingId)}>{isBusy(`validate:${editingId}`) ? "验证中" : "测试凭据"}</Button> : null}
              <Button size="sm" variant="outline" disabled={isProviderBusy(editingId) || !(forms[editingId]?.enabled)} onClick={() => void refreshQuota(editingId)}>{isBusy(`refresh:${editingId}`) ? "刷新中" : "刷新"}</Button>
              <Button size="sm" variant="primary" disabled={isProviderBusy(editingId)} onClick={() => void save(editingId)}>{isBusy(`save:${editingId}`) ? "保存中" : "保存"}</Button>
            </div>
          </section>
        </div>
      ), document.body) : null}
    </section>
  );
}
