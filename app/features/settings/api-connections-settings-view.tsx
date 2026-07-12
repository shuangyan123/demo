"use client";

import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { generateWithConnection, type GenerateConnectionPurpose } from "../../services/ai-connection-client";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import { creatableProviderContracts, getProviderContract, getProviderModelCatalog, type ProviderContract } from "../../services/provider-contracts";
import type { AiCapability, AiConnectionPurpose, AiConnectionSnapshot, ApiConnectionProfile, ApiProvider } from "../../types/review";
import { Button, EmptyState, cx } from "../shared/ui-primitives";
import { ProviderIcon } from "../shared/provider-icon";
import { AiQuotaSettingsPanel } from "./plugins/quota/ai-quota-settings-panel";

type SubmitEvent = SyntheticEvent<HTMLFormElement, globalThis.SubmitEvent>;
type Feedback = { tone: "success" | "error" | "neutral"; text: string } | null;
type ConnectionForm = {
  id: string;
  label: string;
  provider: ApiProvider;
  baseUrl: string;
  apiKey: string;
  capabilities: AiCapability[];
  language: string;
};

const purposeLabels: Record<AiConnectionPurpose, string> = { text: "默认文本", vision: "默认多模态", speech: "默认语音", transcription: "默认转写", realtime: "默认实时语音" };
const capabilityLabels: Partial<Record<AiCapability, string>> = { text: "文本", vision: "多模态", structured_output: "结构化输出", speech: "语音", transcription: "录音转写" };

function capabilitiesForPurpose(contract: ProviderContract, purpose: AiConnectionPurpose): AiCapability[] {
  if (purpose === "text") return contract.capabilities.filter((capability) => capability === "text" || capability === "structured_output");
  return contract.capabilities.filter((capability) => capability === purpose);
}

// 按当前能力创建连接草稿；模型由会话或能力默认值单独持有。
function createForm(provider: ApiProvider = "openai", purpose: AiConnectionPurpose = "text"): ConnectionForm {
  const contract = getProviderContract(provider);
  return {
    id: "",
    label: contract.label,
    provider,
    baseUrl: contract.baseUrl,
    apiKey: "",
    capabilities: capabilitiesForPurpose(contract, purpose),
    language: "zh-CN",
  };
}

function statusLabel(profile: ApiConnectionProfile | undefined): string {
  if (!profile) return "未连接";
  if (profile.testStatus === "success") return "已验证";
  if (profile.testStatus === "failed") return "验证失败";
  return "已保存";
}

function InlineStatus({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <span className={cx("inline-flex items-center gap-2 text-sm", feedback.tone === "success" && "text-green", feedback.tone === "error" && "text-red", feedback.tone === "neutral" && "text-muted")} role="status">
      <span aria-hidden="true">{feedback.tone === "success" ? "✓" : feedback.tone === "error" ? "!" : "·"}</span>
      {feedback.text}
    </span>
  );
}

// 配置多厂商连接、能力默认值和连接测试；厂商协议细节只存在于服务端适配器。
export function ApiConnectionsSettingsView({ onChanged, onClearLocalRecords }: { onChanged?: () => void; onClearLocalRecords?: () => void }) {
  const [snapshot, setSnapshot] = useState<AiConnectionSnapshot>({ profiles: [], defaults: { id: "default", updatedAt: "" } });
  const [activePurpose, setActivePurpose] = useState<AiConnectionPurpose>("text");
  const [form, setForm] = useState<ConnectionForm>(() => createForm());
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const contract = useMemo(() => getProviderContract(form.provider), [form.provider]);

  const refresh = useCallback(async () => setSnapshot(await aiConnectionsRepository.loadSnapshot()), []);

  useEffect(() => {
    let active = true;
    void aiConnectionsRepository
      .loadSnapshot()
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot);
      })
      .catch((error) => {
        if (active) setFeedback({ tone: "error", text: error instanceof Error ? error.message : "连接配置读取失败" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (feedback?.tone !== "success") return;
    const timer = window.setTimeout(() => setFeedback(null), 1800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  function selectProvider(provider: ApiProvider) {
    const next = createForm(provider, activePurpose);
    setForm(next);
    setFeedback(null);
  }

  function editProfile(profile: ApiConnectionProfile) {
    setActivePurpose(profile.capabilities.includes("speech") && !profile.capabilities.includes("text") ? "speech" : profile.capabilities.includes("vision") ? "vision" : "text");
    setForm({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      apiKey: "",
      capabilities: profile.capabilities,
      language: profile.providerOptions.language ?? "zh-CN",
    });
    setFeedback(null);
  }

  function toggleCapability(capability: AiCapability) {
    setForm((current) => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((item) => item !== capability)
        : [...current.capabilities, capability],
    }));
  }

  async function saveConnection(event: SubmitEvent) {
    event.preventDefault();
    if (!form.baseUrl.trim()) {
      setFeedback({ tone: "error", text: form.provider === "azure" ? "请填写 Azure Speech 完整区域 endpoint" : "请填写 Base URL" });
      return;
    }
    setBusyAction("save");
    setFeedback({ tone: "neutral", text: "正在保存…" });
    try {
      const saved = await aiConnectionsRepository.saveProfile({
        id: form.id || undefined,
        label: form.label,
        provider: form.provider,
        baseUrl: form.baseUrl,
        capabilities: form.capabilities,
        apiKey: form.apiKey,
        providerOptions: form.provider === "azure" ? { language: form.language } : {},
        today: new Date(),
      });
      await refresh();
      onChanged?.();
      editProfile(saved);
      setFeedback({ tone: "success", text: "配置已保存" });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "连接保存失败" });
    } finally {
      setBusyAction("");
    }
  }

  async function testConnection(profile: ApiConnectionProfile) {
    const requestedPurpose = activePurpose !== "speech" && activePurpose !== "transcription" && profile.capabilities.includes(activePurpose)
      ? activePurpose
      : profile.capabilities.includes("text")
        ? "text"
        : profile.capabilities.includes("vision")
          ? "vision"
          : undefined;
    if (!requestedPurpose) {
      setFeedback({ tone: "neutral", text: activePurpose === "transcription" ? "转写连接请在对话输入框录音后验证" : "语音连接请在个性化页面通过试听验证" });
      return;
    }
    const purpose = requestedPurpose as GenerateConnectionPurpose;
    setBusyAction(`test:${profile.id}`);
    setFeedback({ tone: "neutral", text: `正在测试${purpose === "vision" ? "多模态" : "文本"}连接…` });
    try {
      const modelId = getProviderModelCatalog(profile.provider, purpose).find((model) => model.status === "recommended")?.id ?? getProviderModelCatalog(profile.provider, purpose)[0]?.id;
      if (!modelId) throw new Error("该连接没有可用于测试的官方模型");
      await generateWithConnection(profile, purpose, {
        modelId,
        messages: [{ role: "user", content: "仅回复 OK" }],
        maxOutputTokens: 12,
      });
      await aiConnectionsRepository.updateTestStatus(profile.id, "success", "连接成功");
      await refresh();
      setFeedback({ tone: "success", text: "连接测试成功" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接测试失败";
      await aiConnectionsRepository.updateTestStatus(profile.id, "failed", message);
      await refresh();
      setFeedback({ tone: "error", text: message });
    } finally {
      setBusyAction("");
    }
  }

  async function removeProfile(profile: ApiConnectionProfile) {
    if (!window.confirm(`确定删除连接“${profile.label}”吗？`)) return;
    await aiConnectionsRepository.removeProfile(profile.id);
    await refresh();
    onChanged?.();
    if (form.id === profile.id) setForm(createForm("openai", activePurpose));
    setFeedback({ tone: "success", text: "连接已删除" });
  }

  async function setDefault(purpose: AiConnectionPurpose, connectionId: string) {
    try {
      await aiConnectionsRepository.setDefault(purpose, connectionId || undefined);
      await refresh();
      onChanged?.();
      setFeedback({ tone: "success", text: `${purposeLabels[purpose]}已更新` });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "默认连接更新失败" });
    }
  }

  async function setDefaultModel(purpose: AiConnectionPurpose, modelId: string) {
    const connectionKey = `${purpose}ConnectionId` as const;
    const connectionId = snapshot.defaults[connectionKey];
    if (!connectionId) return;
    try {
      await aiConnectionsRepository.setDefaultSelection(purpose, connectionId, modelId);
      await refresh();
      onChanged?.();
      setFeedback({ tone: "success", text: `${purposeLabels[purpose]}模型已更新` });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "默认模型更新失败" });
    }
  }

  const editableContracts = contract.creatable ? creatableProviderContracts : [contract, ...creatableProviderContracts];
  const formCapabilities = contract.capabilities.filter((capability) => capabilityLabels[capability]);

  return (
    <section className="ai-connections-compact">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">AI 连接</h1>
        <InlineStatus feedback={feedback} />
      </div>

      <form className="mt-6 grid gap-5" onSubmit={saveConnection}>
        <div className="ai-connection-picker">
          <label>用途<select aria-label="用途" value={activePurpose} onChange={(event) => { const purpose = event.currentTarget.value as AiConnectionPurpose; setActivePurpose(purpose); setForm(createForm("openai", purpose)); }}>
            <option value="text">文本</option><option value="vision">多模态</option><option value="speech">语音合成</option><option value="transcription">录音转写</option>
          </select></label>
          <label>厂商<span className="ai-provider-select"><ProviderIcon provider={form.provider} size={22} /><select aria-label="厂商" value={form.provider} onChange={(event) => selectProvider(event.currentTarget.value as ApiProvider)}>{editableContracts.filter((item) => item.provider === "custom" || item.capabilities.includes(activePurpose)).map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}</select></span></label>
          <p className="self-end text-xs leading-5 text-muted">连接只保存鉴权与能力，模型在下方默认能力或对话中选择。</p>
        </div>

        <details className="ai-connection-advanced">
          <summary>高级设置</summary>
          <div className="mt-4 grid gap-4">
            <label className="ui-field">连接名称<input className="ui-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} /></label>
            <label className="ui-field">Base URL<input className="ui-input" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })} /></label>
            {form.provider === "azure" ? <label className="ui-field">语音语言<input className="ui-input" value={form.language} onChange={(event) => setForm({ ...form, language: event.currentTarget.value })} /></label> : null}
            <fieldset><legend className="text-sm font-semibold">连接能力</legend><div className="mt-2 flex flex-wrap gap-4">{formCapabilities.map((capability) => <label key={capability} className="inline-flex items-center gap-2 text-sm text-muted"><input checked={form.capabilities.includes(capability)} className="ui-checkbox" type="checkbox" onChange={() => toggleCapability(capability)} />{capabilityLabels[capability]}</label>)}</div></fieldset>
            <label className="ui-field">API Key<input className="ui-input" type="password" autoComplete="new-password" placeholder={form.id ? "留空保留原 Key" : form.provider === "custom" ? "无鉴权服务可留空" : "填写 API Key"} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} /></label>
          </div>
        </details>

        <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={Boolean(busyAction)}>{busyAction === "save" ? "保存中" : "保存连接"}</Button><Button type="button" variant="outline" disabled={!form.id || Boolean(busyAction)} onClick={() => { const profile = snapshot.profiles.find((item) => item.id === form.id); if (profile) void testConnection(profile); }}>测试连接</Button>{form.id ? <Button type="button" variant="ghost" onClick={() => setForm(createForm("openai", activePurpose))}>新建</Button> : null}</div>
      </form>

      <section className="mt-7 rounded-lg border border-line bg-surface" aria-label="默认能力分配">
        <div className="grid grid-cols-4 divide-x divide-line max-lg:grid-cols-2 max-lg:divide-y max-sm:grid-cols-1">
          {(Object.keys(purposeLabels) as AiConnectionPurpose[]).map((purpose) => {
            const key = `${purpose}ConnectionId` as const;
            const modelKey = `${purpose}ModelId` as const;
            const options = snapshot.profiles.filter((profile) => profile.capabilities.includes(purpose));
            const selectedProfile = options.find((profile) => profile.id === snapshot.defaults[key]);
            const models = selectedProfile ? getProviderModelCatalog(selectedProfile.provider, purpose) : [];
            return (
              <label key={purpose} className="grid gap-2 p-3 text-sm font-medium">
                {purposeLabels[purpose]}
                <select aria-label={purposeLabels[purpose]} className="settings-select min-h-10 rounded-lg border border-line bg-surface px-3 text-sm" value={snapshot.defaults[key] ?? ""} onChange={(event) => void setDefault(purpose, event.target.value)}>
                  <option value="">未指定</option>
                  {options.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
                {selectedProfile && !models.length ? <input aria-label={`${purposeLabels[purpose]}模型`} className="settings-input min-h-10 rounded-lg border border-line bg-surface px-3 text-sm" placeholder="输入模型 ID 后按 Enter" defaultValue={snapshot.defaults[modelKey] ?? ""} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void setDefaultModel(purpose, event.currentTarget.value); } }} /> : <select aria-label={`${purposeLabels[purpose]}模型`} className="settings-select min-h-10 rounded-lg border border-line bg-surface px-3 text-sm" disabled={!selectedProfile} value={snapshot.defaults[modelKey] ?? ""} onChange={(event) => void setDefaultModel(purpose, event.target.value)}>
                  <option value="">未选择模型</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>}
              </label>
            );
          })}
        </div>
      </section>
      <section className="mt-7" aria-label="已保存连接">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">已保存连接</h2>
            <span className="text-sm text-muted">{snapshot.profiles.length} 个</span>
          </div>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {snapshot.profiles.length ? snapshot.profiles.map((profile) => (
              <article key={profile.id} className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-2">
                  <ProviderIcon provider={profile.provider} size={26} />
                  <button className="min-w-0 text-left" type="button" onClick={() => editProfile(profile)}><strong className="block truncate text-sm font-medium">{profile.label}</strong><span className="block truncate text-xs text-muted">{getProviderContract(profile.provider).label} · {statusLabel(profile)}</span></button>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => editProfile(profile)}>编辑</Button>
                    <Button size="sm" variant="danger" onClick={() => void removeProfile(profile)}>删除</Button>
                  </div>
              </article>
            )) : <div className="py-4"><EmptyState>尚未保存连接。</EmptyState></div>}
          </div>
      </section>

      <details className="mt-9 border-t border-line pt-5">
        <summary className="cursor-pointer text-sm font-semibold">AI 额度与用量</summary>
        <div className="mt-4"><AiQuotaSettingsPanel /></div>
      </details>
      {onClearLocalRecords ? <div className="mt-9 border-t border-line pt-5"><Button type="button" variant="danger" onClick={onClearLocalRecords}>清空错题和导入记录</Button></div> : null}
    </section>
  );
}
