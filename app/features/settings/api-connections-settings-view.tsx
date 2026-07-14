"use client";

import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { generateWithConnection, testConnectionDraft, type GenerateConnectionPurpose } from "../../services/ai-connection-client";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import { getCachedConnectionModelCatalog, loadConnectionModelCatalog, loadDraftModelCatalog, rememberConnectionModelDirectory } from "../../services/model-directory-service";
import { getProviderContract, getProviderModelCatalog, providerContracts } from "../../services/provider-contracts";
import type { AiModelsResult } from "../../services/api-client";
import type { ApiProvider } from "../../types/domains/ai-provider";
import type { AiCapability, AiConnectionPurpose, AiConnectionSnapshot, ApiConnectionProfile } from "../../types/review";
import { Button, EmptyState, cx } from "../shared/ui-primitives";
import { ProviderIcon } from "../shared/provider-icon";
import { ProviderSelect } from "./provider-select";

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

// 连接档案只描述厂商、鉴权与协议能力，模型由会话或默认能力单独持有。
function createForm(provider: ApiProvider = "openai"): ConnectionForm {
  const contract = getProviderContract(provider);
  return {
    id: "",
    label: contract.label,
    provider,
    baseUrl: contract.baseUrl,
    apiKey: "",
    capabilities: [...contract.capabilities],
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
  const [form, setForm] = useState<ConnectionForm>(() => createForm());
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>([]);
  const [discoveredDirectory, setDiscoveredDirectory] = useState<AiModelsResult>();
  const [selectedTestModelId, setSelectedTestModelId] = useState("");
  const [testSucceeded, setTestSucceeded] = useState(false);
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
    const next = createForm(provider);
    setForm(next);
    setFeedback(null);
    setAvailableModels([]);
    setDiscoveredDirectory(undefined);
    setSelectedTestModelId("");
    setTestSucceeded(false);
  }

  function editProfile(profile: ApiConnectionProfile) {
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
    const remembered = typeof window === "undefined" ? "" : window.localStorage.getItem(`review_connection_test_model_v1:${profile.id}`) ?? "";
    const models = getCachedConnectionModelCatalog(profile).map((model) => ({ id: model.id, label: model.label }));
    setAvailableModels(models);
    setDiscoveredDirectory(undefined);
    setSelectedTestModelId(models.some((model) => model.id === remembered) ? remembered : models[0]?.id ?? remembered);
    setTestSucceeded(profile.testStatus === "success");
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
      rememberConnectionModelDirectory(saved, discoveredDirectory);
      if (testSucceeded) await aiConnectionsRepository.updateTestStatus(saved.id, "success", "连接成功");
      await refresh();
      onChanged?.();
      if (selectedTestModelId) window.localStorage.setItem(`review_connection_test_model_v1:${saved.id}`, selectedTestModelId);
      editProfile(testSucceeded ? { ...saved, testStatus: "success", testMessage: "连接成功" } : saved);
      setFeedback({ tone: "success", text: "配置已保存" });
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "连接保存失败" });
    } finally {
      setBusyAction("");
    }
  }

  /** 按厂商目录策略获取当前凭据可用模型，失败时只回退到已核验官方目录。 */
  async function discoverModels() {
    setBusyAction("models");
    setFeedback({ tone: "neutral", text: "正在获取模型…" });
    try {
      const result = form.id
        ? await loadConnectionModelCatalog(snapshot.profiles.find((profile) => profile.id === form.id)!, undefined, true)
        : await loadDraftModelCatalog({ provider: form.provider, apiKey: form.apiKey, baseUrl: form.baseUrl });
      const models = result.models.map((model) => ({ id: model.id, label: model.label }));
      if (!models.length) throw new Error("该厂商需要手动输入模型 ID");
      setAvailableModels(models);
      setDiscoveredDirectory(result.directory);
      setSelectedTestModelId((current) => models.some((model) => model.id === current) ? current : models[0].id);
      setFeedback({ tone: result.source === "live" ? "success" : "neutral", text: result.source === "live" ? `已获取 ${models.length} 个模型` : `已载入 ${models.length} 个已核验模型` });
    } catch (error) {
      const fallback = getProviderModelCatalog(form.provider).map((model) => ({ id: model.id, label: model.label }));
      if (fallback.length) {
        setAvailableModels(fallback);
        setDiscoveredDirectory(undefined);
        setSelectedTestModelId((current) => fallback.some((model) => model.id === current) ? current : fallback[0].id);
        setFeedback({ tone: "neutral", text: "在线目录不可用，已载入官方回退目录" });
      } else setFeedback({ tone: "error", text: error instanceof Error ? error.message : "模型目录读取失败" });
    } finally {
      setBusyAction("");
    }
  }

  /** 使用用户选中的具体模型执行极小真实请求，证明该账号确实可调用模型。 */
  async function testSelectedModel() {
    if (!selectedTestModelId) return setFeedback({ tone: "error", text: "请先获取并选择模型" });
    const purpose: GenerateConnectionPurpose = form.capabilities.includes("text") ? "text" : "vision";
    setBusyAction("test");
    setTestSucceeded(false);
    setFeedback({ tone: "neutral", text: "正在发送极小真实请求…" });
    try {
      const profile = snapshot.profiles.find((item) => item.id === form.id);
      if (profile) await generateWithConnection(profile, purpose, { modelId: selectedTestModelId, messages: [{ role: "user", content: "仅回复 OK" }], maxOutputTokens: 12 });
      else await testConnectionDraft({ provider: form.provider, apiKey: form.apiKey, baseUrl: form.baseUrl, modelId: selectedTestModelId });
      if (profile) await aiConnectionsRepository.updateTestStatus(profile.id, "success", "连接成功");
      setTestSucceeded(true);
      await refresh();
      setFeedback({ tone: "success", text: "连接成功" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接测试失败";
      const profile = snapshot.profiles.find((item) => item.id === form.id);
      if (profile) await aiConnectionsRepository.updateTestStatus(profile.id, "failed", message);
      setFeedback({ tone: "error", text: message });
    } finally {
      setBusyAction("");
    }
  }

  async function setTestedAsDefault() {
    if (!form.id || !selectedTestModelId) return;
    const purpose: AiConnectionPurpose = form.capabilities.includes("text") ? "text" : "vision";
    await aiConnectionsRepository.setDefaultSelection(purpose, form.id, selectedTestModelId);
    await refresh();
    onChanged?.();
    setFeedback({ tone: "success", text: "已设为默认" });
  }

  async function removeProfile(profile: ApiConnectionProfile) {
    if (!window.confirm(`确定删除连接“${profile.label}”吗？`)) return;
    await aiConnectionsRepository.removeProfile(profile.id);
    await refresh();
    onChanged?.();
    if (form.id === profile.id) setForm(createForm());
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

  const editableContracts = providerContracts;
  const formCapabilities = contract.capabilities.filter((capability) => capabilityLabels[capability]);

  return (
    <section className="ai-connections-compact">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">AI 连接</h1>
        <InlineStatus feedback={feedback} />
      </div>

      <form className="mt-6 grid gap-5" onSubmit={saveConnection}>
        <div className="ai-connection-picker">
          <label>厂商<ProviderSelect value={form.provider} providers={editableContracts.map((item) => item.provider)} onChange={selectProvider} /></label>
        </div>

        <details className="ai-connection-advanced">
          <summary>高级设置</summary>
          <div className="mt-4 grid gap-4">
            <label className="ui-field">连接名称<input className="ui-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} /></label>
            <label className="ui-field">Base URL<input className="ui-input" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })} /></label>
            {form.provider === "azure" ? <label className="ui-field">语音语言<input className="ui-input" value={form.language} onChange={(event) => setForm({ ...form, language: event.currentTarget.value })} /></label> : null}
            {form.provider === "custom" ? <fieldset><legend className="text-sm font-semibold">连接能力</legend><div className="mt-2 flex flex-wrap gap-4">{formCapabilities.map((capability) => <label key={capability} className="inline-flex items-center gap-2 text-sm text-muted"><input checked={form.capabilities.includes(capability)} className="ui-checkbox" type="checkbox" onChange={() => toggleCapability(capability)} />{capabilityLabels[capability]}</label>)}</div></fieldset> : null}
            <label className="ui-field">API Key<input className="ui-input" type="password" autoComplete="new-password" placeholder={form.id ? "留空保留原 Key" : form.provider === "custom" ? "无鉴权服务可留空" : "填写 API Key"} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} /></label>
          </div>
        </details>

        <section className="ai-connection-test-flow" aria-label="模型发现与连接测试">
          <div className="ai-connection-test-steps" aria-label="连接配置进度"><span>1 配置连接</span><span>2 获取模型</span><span>3 测试连接</span><span>4 完成</span></div>
          <div className="ai-connection-test-controls">
            <Button type="button" variant="outline" disabled={Boolean(busyAction)} onClick={() => void discoverModels()}>{busyAction === "models" ? "获取中" : "获取模型"}</Button>
            {availableModels.length ? <select className="settings-select" aria-label="测试模型" value={selectedTestModelId} onChange={(event) => { setSelectedTestModelId(event.currentTarget.value); setTestSucceeded(false); }}>{availableModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select> : <input className="settings-input" aria-label="测试模型 ID" placeholder="模型 ID" value={selectedTestModelId} onChange={(event) => setSelectedTestModelId(event.currentTarget.value)} />}
            <Button type="button" variant="outline" disabled={!selectedTestModelId || Boolean(busyAction)} onClick={() => void testSelectedModel()}>{busyAction === "test" ? "测试中" : "测试连接"}</Button>
            {testSucceeded && form.id ? <Button type="button" variant="ghost" onClick={() => void setTestedAsDefault()}>设为默认</Button> : null}
          </div>
          <p>测试会使用所选模型发送一次极小真实请求，可能产生少量用量。</p>
        </section>

        <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={Boolean(busyAction)}>{busyAction === "save" ? "保存中" : "保存连接"}</Button>{form.id ? <Button type="button" variant="ghost" onClick={() => { setForm(createForm()); setAvailableModels([]); setDiscoveredDirectory(undefined); setSelectedTestModelId(""); setTestSucceeded(false); }}>新建</Button> : null}</div>
      </form>

      <section className="mt-7 rounded-lg border border-line bg-surface" aria-label="默认能力分配">
        <div className="grid grid-cols-4 divide-x divide-line max-lg:grid-cols-2 max-lg:divide-y max-sm:grid-cols-1">
          {(Object.keys(purposeLabels) as AiConnectionPurpose[]).map((purpose) => {
            const key = `${purpose}ConnectionId` as const;
            const modelKey = `${purpose}ModelId` as const;
            const options = snapshot.profiles.filter((profile) => profile.capabilities.includes(purpose));
            const selectedProfile = options.find((profile) => profile.id === snapshot.defaults[key]);
            const models = selectedProfile ? getCachedConnectionModelCatalog(selectedProfile, purpose) : [];
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

      {onClearLocalRecords ? <div className="mt-9 border-t border-line pt-5"><Button type="button" variant="danger" onClick={onClearLocalRecords}>清空错题和导入记录</Button></div> : null}
    </section>
  );
}
