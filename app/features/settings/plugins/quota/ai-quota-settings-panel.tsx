"use client";

import { useMemo, useState } from "react";
import { aiQuotaRepository } from "../../../../services/ai-quota-repository";
import type { AiQuotaPluginConfig, AiQuotaSnapshot, ApiProvider } from "../../../../types/review";
import { Button, Chip, EmptyState } from "../../../shared/ui-primitives";

type QuotaFormState = Record<string, { enabled: boolean; apiKey: string; monthlyBudget: string; manualRemaining: string }>;

function currency(value: number | undefined, unit = "USD") {
  return value === undefined ? "未返回" : `${unit} ${value.toFixed(2)}`;
}

function formFromConfig(config?: AiQuotaPluginConfig) {
  return {
    enabled: config?.enabled ?? false,
    apiKey: "",
    monthlyBudget: config?.monthlyBudget?.toString() ?? "",
    manualRemaining: config?.manualRemaining?.toString() ?? "",
  };
}

function usagePercent(snapshot?: AiQuotaSnapshot): number {
  if (!snapshot) return 0;
  if (typeof snapshot.usageRatio === "number") return Math.max(0, Math.min(100, snapshot.usageRatio * 100));
  const total = (snapshot.usedAmount ?? 0) + (snapshot.remainingAmount ?? 0);
  return total > 0 ? Math.max(0, Math.min(100, ((snapshot.usedAmount ?? 0) / total) * 100)) : 0;
}

/** 额度面板采用紧凑厂商卡，但只调用官方或手动来源。 */
export function AiQuotaSettingsPanel() {
  const initialState = useMemo(() => aiQuotaRepository.loadSync(), []);
  const [configs, setConfigs] = useState<AiQuotaPluginConfig[]>(() => initialState.configs);
  const [snapshots, setSnapshots] = useState<AiQuotaSnapshot[]>(() => initialState.snapshots);
  const [forms, setForms] = useState<QuotaFormState>(() => Object.fromEntries(aiQuotaRepository.plugins.map((plugin) => [
    plugin.id,
    formFromConfig(initialState.configs.find((config) => config.id === plugin.id)),
  ])));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const configById = useMemo(() => new Map(configs.map((config) => [config.id, config])), [configs]);
  const snapshotById = useMemo(() => new Map(snapshots.map((snapshot) => [snapshot.id, snapshot])), [snapshots]);

  async function refreshLocal() {
    const next = await aiQuotaRepository.load();
    setConfigs(next.configs);
    setSnapshots(next.snapshots);
    setForms((current) => {
      const merged = { ...current };
      for (const plugin of aiQuotaRepository.plugins) {
        if (!merged[plugin.id]) merged[plugin.id] = formFromConfig(next.configs.find((config) => config.id === plugin.id));
      }
      return merged;
    });
  }

  function patchForm(id: string, patch: Partial<QuotaFormState[string]>) {
    setForms((current) => ({ ...current, [id]: { ...(current[id] ?? formFromConfig(configById.get(id as ApiProvider | "manual"))), ...patch } }));
  }

  async function save(id: ApiProvider | "manual") {
    const form = forms[id] ?? formFromConfig(configById.get(id));
    setBusy(`save:${id}`);
    try {
      await aiQuotaRepository.saveConfig({
        id,
        enabled: form.enabled,
        apiKey: form.apiKey,
        monthlyBudget: Number(form.monthlyBudget) || undefined,
        manualRemaining: Number(form.manualRemaining) || undefined,
        today: new Date(),
      });
      await refreshLocal();
      setNotice("额度配置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "额度配置保存失败");
    } finally {
      setBusy("");
    }
  }

  async function refreshQuota(id: ApiProvider | "manual") {
    setBusy(`refresh:${id}`);
    try {
      await aiQuotaRepository.refresh(id);
      await refreshLocal();
      setNotice("额度快照已刷新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "额度刷新失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-label="AI 额度与用量">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI 额度与用量</h2>
          <p className="mt-1 text-sm text-muted">账单凭据独立加密保存；没有官方 API 的厂商只显示预留或手动额度。</p>
        </div>
        {notice ? <span className="text-sm text-muted" role="status">{notice}</span> : null}
      </div>
      <div className="mt-4 grid gap-3">
        {aiQuotaRepository.plugins.length ? aiQuotaRepository.plugins.map((plugin) => {
          const form = forms[plugin.id] ?? formFromConfig(configById.get(plugin.id));
          const snapshot = snapshotById.get(plugin.id);
          const config = configById.get(plugin.id);
          const strategy = plugin.fetchStrategies[0];
          const percent = usagePercent(snapshot);
          const statusTone = snapshot?.status === "ready" ? "green" : snapshot?.status === "error" ? "red" : "yellow";
          return (
            <article key={plugin.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                  <span
                    className="grid h-9 w-9 place-items-center rounded-lg text-xs font-extrabold text-white"
                    style={{ backgroundColor: plugin.descriptor.branding.color }}
                    aria-hidden="true"
                  >
                    {plugin.descriptor.branding.iconLabel}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{plugin.label}</strong>
                      <Chip tone="neutral">{strategy?.sourceLabel ?? plugin.descriptor.sourceModes[0]}</Chip>
                    <Chip tone={plugin.supportsOfficialRefresh ? "green" : "yellow"}>{plugin.refreshStrategy === "official_api" ? "官方 API" : plugin.refreshStrategy === "manual" ? "手动" : "插件预留"}</Chip>
                    <Chip tone={statusTone}>{snapshot?.status ?? (form.enabled ? "待刷新" : "未启用")}</Chip>
                    </div>
                    <p className="mt-1 text-sm text-muted">{snapshot?.message ?? plugin.unsupportedReason ?? "可查询官方费用数据；余额字段以厂商官方 API 返回为准。"}</p>
                    {config?.maskedKey ? <p className="mt-1 text-xs text-muted">额度 Key：{config.maskedKey}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {plugin.dashboardUrl ? <a className="ui-button ui-button-sm ui-button-outline" href={plugin.dashboardUrl} rel="noreferrer" target="_blank">官网账单</a> : null}
                  <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void save(plugin.id)}>保存</Button>
                  <Button size="sm" variant="soft" disabled={Boolean(busy) || !form.enabled} onClick={() => void refreshQuota(plugin.id)}>{busy === `refresh:${plugin.id}` ? "刷新中" : "刷新额度"}</Button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-md:grid-cols-1">
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted">
                    <span>已用 {currency(snapshot?.usedAmount, snapshot?.currency)}</span>
                    <span>剩余 {currency(snapshot?.remainingAmount, snapshot?.currency)}</span>
                  </div>
                  <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-muted">
                    <span className="block h-full rounded-full bg-blue" style={{ width: `${percent}%` }} />
                  </span>
                </div>
                <div className="text-right text-xs text-muted max-md:text-left">
                  <div>{snapshot?.periodLabel ?? "当前周期"}</div>
                  <div>{snapshot?.resetAt ? `重置 ${new Date(snapshot.resetAt).toLocaleString("zh-CN")}` : "重置时间未返回"}</div>
                  <div>建议刷新 {Math.round(plugin.descriptor.refreshCadenceSeconds / 60)} 分钟</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
                <label className="inline-flex items-center gap-2 text-sm"><input checked={form.enabled} className="ui-checkbox" type="checkbox" onChange={(event) => patchForm(plugin.id, { enabled: event.currentTarget.checked })} />启用</label>
                {plugin.credentialFields.map((field) => (
                  <label key={field.key} className="grid gap-1 text-xs font-medium">{field.label}
                    <input className="ui-input" type={field.secret ? "password" : "text"} placeholder={config?.maskedKey ? "留空保留原 Key" : "填写额度查询 Key"} value={form.apiKey} onChange={(event) => patchForm(plugin.id, { apiKey: event.currentTarget.value })} />
                  </label>
                ))}
                <label className="grid gap-1 text-xs font-medium">月预算
                  <input className="ui-input" inputMode="decimal" value={form.monthlyBudget} onChange={(event) => patchForm(plugin.id, { monthlyBudget: event.currentTarget.value })} />
                </label>
                <label className="grid gap-1 text-xs font-medium">手动剩余
                  <input className="ui-input" inputMode="decimal" value={form.manualRemaining} onChange={(event) => patchForm(plugin.id, { manualRemaining: event.currentTarget.value })} />
                </label>
              </div>
              {snapshot ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                  <span>来源：{snapshot.sourceLabel ?? snapshot.source}</span>
                  <span>刷新：{new Date(snapshot.refreshedAt).toLocaleString("zh-CN")}</span>
                  {snapshot.documentationUrl ? <a className="text-blue" href={snapshot.documentationUrl} rel="noreferrer" target="_blank">官方文档</a> : null}
                  {plugin.statusUrl ? <a className="text-blue" href={plugin.statusUrl} rel="noreferrer" target="_blank">厂商状态</a> : null}
                </div>
              ) : null}
            </article>
          );
        }) : <EmptyState>暂无额度配置。</EmptyState>}
      </div>
    </section>
  );
}
