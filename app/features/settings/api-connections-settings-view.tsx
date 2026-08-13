"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { testConnectionDraft } from "../../services/ai-connection-client";
import { aiConnectionsRepository, type ConnectionCredentialHealth } from "../../services/ai-connections-repository";
import { inspectConnectionModelCatalog, loadDraftModelCatalog, rememberConnectionModelDirectory } from "../../services/model-directory-service";
import { getProviderContract, getProviderModelCatalog, providerContracts } from "../../services/provider-contracts";
import { inferMiniMaxRegion, MINIMAX_ANTHROPIC_BASE_URLS, type MiniMaxCredentialPlan, type MiniMaxRegion } from "../../services/minimax-connection";
import type { AiModelsResult } from "../../services/api-client";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import type { AiCapability, AiConnectionPurpose, AiConnectionSnapshot, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AiModelCatalogEntry } from "../../types/domains/provider-catalog.ts";
import { Button, EmptyState, IconButton, cx } from "../shared/ui-primitives";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { ProviderSelect } from "./provider-select";
import { DefaultCapabilitySelector } from "./default-capability-selector";
import { DesktopCredentialMigrationPanel } from "./desktop-credential-migration-panel";
import { DesktopCredentialCleanupPanel } from "./desktop-credential-cleanup-panel";
import { ModelCatalogSelect } from "./model-catalog-select";
import compactStyles from "./settings-compact.module.css";
import { SettingsSectionHeader } from "./settings-section-header";

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
  minimaxRegion: MiniMaxRegion;
  minimaxCredentialPlan: MiniMaxCredentialPlan;
  allowPrivateNetwork: boolean;
};

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
    minimaxRegion: "cn",
    minimaxCredentialPlan: "pay_as_you_go",
    allowPrivateNetwork: false,
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
    <span
      aria-live={feedback.tone === "error" ? "assertive" : "polite"}
      className={cx("inline-flex items-center gap-2 text-sm", feedback.tone === "success" && "text-green", feedback.tone === "error" && "text-red", feedback.tone === "neutral" && "text-muted")}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true">{feedback.tone === "success" ? "✓" : feedback.tone === "error" ? "!" : "·"}</span>
      {feedback.text}
    </span>
  );
}

/** 草稿网络意图与厂商选项共用同一映射，避免测试和保存采用不同安全策略。 */
function providerOptionsForForm(form: ConnectionForm): Record<string, string> {
  if (form.provider === "azure") return { language: form.language };
  if (form.provider === "minimax") return { region: form.minimaxRegion, credentialPlan: form.minimaxCredentialPlan };
  if (form.provider === "custom") return { allowPrivateNetwork: String(form.allowPrivateNetwork) };
  return {};
}

/** AI 连接始终通过真实仓储渲染；开发审查状态也写入隔离命名空间。 */
export function ApiConnectionsSettingsView({ onChanged }: { developmentExample?: string; onChanged?: () => void }) {
  return <ApiConnectionsSettingsLiveView onChanged={onChanged} />;
}

// 配置多厂商连接、能力默认值和连接测试；厂商协议细节只存在于服务端适配器。
function ApiConnectionsSettingsLiveView({ onChanged }: { onChanged?: () => void }) {
  const [snapshot, setSnapshot] = useState<AiConnectionSnapshot>({ profiles: [], defaults: { id: "default", updatedAt: "" } });
  const [form, setForm] = useState<ConnectionForm>(() => createForm());
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [availableModels, setAvailableModels] = useState<AiModelCatalogEntry[]>([]);
  const [discoveredDirectory, setDiscoveredDirectory] = useState<AiModelsResult>();
  const [selectedTestModelId, setSelectedTestModelId] = useState("");
  const [testSucceeded, setTestSucceeded] = useState(false);
  const [credentialHealth, setCredentialHealth] = useState<Record<string, ConnectionCredentialHealth>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const advancedSettingsRef = useRef<HTMLDetailsElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const contract = useMemo(() => getProviderContract(form.provider), [form.provider]);

  const refresh = useCallback(async () => {
    const nextSnapshot = await aiConnectionsRepository.loadSnapshot();
    const healthEntries = await Promise.all(nextSnapshot.profiles.map(async (profile) => [
      profile.id,
      await aiConnectionsRepository.inspectCredentialHealth(profile),
    ] as const));
    setSnapshot(nextSnapshot);
    setCredentialHealth(Object.fromEntries(healthEntries));
    setSelectedProfileId((current) => nextSnapshot.profiles.some((profile) => profile.id === current) ? current : nextSnapshot.profiles[0]?.id ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    void aiConnectionsRepository
      .loadSnapshot()
      .then(async (nextSnapshot) => {
        const healthEntries = await Promise.all(nextSnapshot.profiles.map(async (profile) => [
          profile.id,
          await aiConnectionsRepository.inspectCredentialHealth(profile),
        ] as const));
        if (active) {
          setSnapshot(nextSnapshot);
          setCredentialHealth(Object.fromEntries(healthEntries));
          setSelectedProfileId(nextSnapshot.profiles[0]?.id ?? "");
        }
      })
      .catch((error) => {
        if (active) setFeedback({ tone: "error", text: error instanceof Error ? error.message : "连接配置读取失败" });
      });
    return () => {
      active = false;
    };
  }, []);

  function selectProvider(provider: ApiProvider) {
    setForm((current) => {
      if (current.provider === provider) return current;
      const next = createForm(provider);
      const currentContract = getProviderContract(current.provider);
      const hasCustomLabel = Boolean(current.label.trim() && current.label !== currentContract.label);
      return {
        ...next,
        id: current.id,
        label: hasCustomLabel ? current.label : next.label,
      };
    });
    setFeedback(null);
    setAvailableModels([]);
    setDiscoveredDirectory(undefined);
    setSelectedTestModelId("");
    setTestSucceeded(false);
  }

  /** 将凭据错误带回真实输入位置，避免用户在保存按钮处看不到页面顶部反馈。 */
  function focusApiKeyInput() {
    if (advancedSettingsRef.current) advancedSettingsRef.current.open = true;
    window.requestAnimationFrame(() => {
      apiKeyInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      apiKeyInputRef.current?.focus();
    });
  }

  function editProfile(profile: ApiConnectionProfile) {
    setSelectedProfileId(profile.id);
    setEditorOpen(true);
    setForm({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      apiKey: "",
      capabilities: profile.capabilities,
      language: profile.providerOptions.language ?? "zh-CN",
      minimaxRegion: profile.providerOptions.region === "global" ? "global" : inferMiniMaxRegion(profile.baseUrl),
      minimaxCredentialPlan: profile.providerOptions.credentialPlan === "token_plan" ? "token_plan" : "pay_as_you_go",
      allowPrivateNetwork: profile.providerOptions.allowPrivateNetwork === "true",
    });
    setFeedback(null);
    const remembered = typeof window === "undefined" ? "" : window.localStorage.getItem(`review_connection_test_model_v1:${profile.id}`) ?? "";
    const models = inspectConnectionModelCatalog(profile).models;
    setAvailableModels(models);
    setDiscoveredDirectory(undefined);
    setSelectedTestModelId(models.some((model) => model.id === remembered) ? remembered : models[0]?.id ?? remembered);
    setTestSucceeded(profile.testStatus === "success");
    window.requestAnimationFrame(() => {
      if (advancedSettingsRef.current) advancedSettingsRef.current.open = true;
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
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
    const selectedProfile = snapshot.profiles.find((profile) => profile.id === form.id);
    const providerChanged = Boolean(selectedProfile && selectedProfile.provider !== form.provider);
    const requiresNewKey = providerChanged || (!form.id && form.provider !== "custom");
    if (requiresNewKey && !form.apiKey.trim()) {
      setFeedback({
        tone: "error",
        text: providerChanged ? "切换厂商后必须重新输入 API Key" : "该厂商连接必须填写 API Key",
      });
      focusApiKeyInput();
      return;
    }
    setBusyAction("save");
    setFeedback({ tone: "neutral", text: "正在保存…" });
    try {
      const isNewConnection = !form.id;
      const providerOptions = providerOptionsForForm(form);
      const saved = await aiConnectionsRepository.saveProfile({
        id: form.id || undefined,
        label: form.label,
        provider: form.provider,
        baseUrl: form.baseUrl,
        capabilities: form.capabilities,
        apiKey: form.apiKey,
        providerOptions,
        today: new Date(),
      });
      rememberConnectionModelDirectory(saved, discoveredDirectory);
      if (testSucceeded) await aiConnectionsRepository.updateTestStatus(saved.id, "success", "连接成功");
      // 首个文本连接会由 repository 自动补一项静态默认模型。若本轮完整在线目录已经证明
      // 该静态项不可用，则只在“新建连接”路径改用用户刚从该目录选中的模型，绝不覆盖用户已有默认值。
      if (isNewConnection && selectedTestModelId && discoveredDirectory?.complete !== false) {
        const nextSnapshot = await aiConnectionsRepository.loadSnapshot();
        const liveTextModels = discoveredDirectory?.models.filter((model) => model.purposes.includes("text")) ?? [];
        const autoSelectedUnavailable = nextSnapshot.defaults.textConnectionId === saved.id
          && Boolean(nextSnapshot.defaults.textModelId)
          && liveTextModels.length > 0
          && !liveTextModels.some((model) => model.id === nextSnapshot.defaults.textModelId);
        const testedModelSupportsText = liveTextModels.some((model) => model.id === selectedTestModelId);
        if (autoSelectedUnavailable && testedModelSupportsText) {
          await aiConnectionsRepository.setDefaultSelection("text", saved.id, selectedTestModelId);
        }
      }
      await refresh();
      onChanged?.();
      if (selectedTestModelId) window.localStorage.setItem(`review_connection_test_model_v1:${saved.id}`, selectedTestModelId);
      editProfile(testSucceeded ? { ...saved, testStatus: "success", testMessage: "连接成功" } : saved);
      setFeedback({ tone: "success", text: "配置已保存" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接保存失败";
      setFeedback({ tone: "error", text: message });
      if (/API Key|凭据|密钥/.test(message)) focusApiKeyInput();
    } finally {
      setBusyAction("");
    }
  }

  /** 按厂商目录策略获取当前凭据可用模型，失败时只回退到已核验官方目录。 */
  async function discoverModels() {
    setBusyAction("models");
    setFeedback({ tone: "neutral", text: "正在获取模型…" });
    try {
      const result = await loadDraftModelCatalog({
        provider: form.provider,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        providerOptions: providerOptionsForForm(form),
        existingConnection: snapshot.profiles.find((profile) => profile.id === form.id),
      });
      const models = result.models;
      if (!models.length) throw new Error("该厂商需要手动输入模型 ID");
      setAvailableModels(models);
      setDiscoveredDirectory(result.directory);
      setSelectedTestModelId((current) => models.some((model) => model.id === current) ? current : models[0].id);
      setFeedback({ tone: result.source === "live" ? "success" : "neutral", text: result.source === "live" ? `已获取 ${models.length} 个模型` : `已载入 ${models.length} 个已核验模型` });
    } catch (error) {
      const fallback = getProviderModelCatalog(form.provider);
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
    setBusyAction("test");
    setTestSucceeded(false);
    setFeedback({ tone: "neutral", text: "正在发送极小真实请求…" });
    try {
      const profile = snapshot.profiles.find((item) => item.id === form.id);
      await testConnectionDraft({
        provider: form.provider,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        modelId: selectedTestModelId,
        label: form.label,
        providerOptions: providerOptionsForForm(form),
        existingConnection: profile,
      });
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
    if (selectedProfileId === profile.id) setSelectedProfileId(snapshot.profiles.find((item) => item.id !== profile.id)?.id ?? "");
    setFeedback({ tone: "success", text: "连接已删除" });
  }

  /** 已保存连接也使用同一草稿测试入口，行内测试不依赖编辑器当前状态。 */
  async function testSavedProfile(profile: ApiConnectionProfile): Promise<void> {
    const purpose: AiConnectionPurpose = profile.capabilities.includes("text") ? "text" : "vision";
    const models = inspectConnectionModelCatalog(profile, purpose).models;
    const defaultConnectionId = snapshot.defaults[`${purpose}ConnectionId`];
    const defaultModelId = snapshot.defaults[`${purpose}ModelId`];
    const remembered = window.localStorage.getItem(`review_connection_test_model_v1:${profile.id}`) ?? "";
    // 最近成功模型最能反映账号真实权限，其次才是关联默认与目录推荐项。
    const modelId = remembered
      || (defaultConnectionId === profile.id && defaultModelId ? defaultModelId : undefined)
      || models.find((model) => model.status === "recommended")?.id
      || models[0]?.id;
    if (!modelId) {
      editProfile(profile);
      setFeedback({ tone: "error", text: "请在编辑器中填写测试模型 ID" });
      return;
    }
    setBusyAction(`test:${profile.id}`);
    try {
      await testConnectionDraft({ provider: profile.provider, apiKey: "", baseUrl: profile.baseUrl, modelId, label: profile.label, providerOptions: profile.providerOptions, existingConnection: profile });
      window.localStorage.setItem(`review_connection_test_model_v1:${profile.id}`, modelId);
      await aiConnectionsRepository.updateTestStatus(profile.id, "success", "连接成功");
      await refresh();
      setFeedback({ tone: "success", text: `${profile.label} 连接成功` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接测试失败";
      await aiConnectionsRepository.updateTestStatus(profile.id, "failed", message);
      await refresh();
      setFeedback({ tone: "error", text: message });
    } finally {
      setBusyAction("");
    }
  }

  const editableContracts = providerContracts;
  const formCapabilities = contract.capabilities.filter((capability) => capabilityLabels[capability]);
  const editingProfile = snapshot.profiles.find((profile) => profile.id === form.id);
  const selectedProfile = snapshot.profiles.find((profile) => profile.id === selectedProfileId);
  const selectedCredentialHealth = selectedProfile ? credentialHealth[selectedProfile.id] : undefined;
  const editingCredentialHealth = editingProfile ? credentialHealth[editingProfile.id] : undefined;
  const credentialNeedsReentry = editingCredentialHealth?.status === "reentry_required" && !form.apiKey.trim();

  return (
    <section className={`ai-connections-compact ${compactStyles.connectionSection} ${compactStyles.connectionLayout}`}>
      <div className={compactStyles.connectionHeader}>
        <SettingsSectionHeader
          title="AI 连接"
          description="管理第三方 AI 服务连接，用于文本生成、多模态理解与语音处理等能力。"
          action={<Button variant="primary" onClick={() => {
            setForm(createForm());
            setEditorOpen(true);
            setAvailableModels([]);
            setDiscoveredDirectory(undefined);
            setSelectedTestModelId("");
            setTestSucceeded(false);
            window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}><AppIcon name="newChat" size={16} />添加连接</Button>}
        />
      </div>

      <DesktopCredentialMigrationPanel />
      <DesktopCredentialCleanupPanel />

      {editorOpen ? <form ref={formRef} className={`${compactStyles.connectionForm} grid gap-5`} onSubmit={saveConnection}>
        <header className={compactStyles.formEditorHeader}><div><h2>{form.id ? "编辑连接" : "添加连接"}</h2><p>密钥只写入本机加密仓储，不会在详情中回显。</p></div><IconButton icon="close" label="关闭连接编辑器" onClick={() => setEditorOpen(false)} /></header>
        <div className="ai-connection-picker">
          <label>厂商<ProviderSelect value={form.provider} providers={editableContracts.map((item) => item.provider)} onChange={selectProvider} /></label>
        </div>

        <details ref={advancedSettingsRef} className="ai-connection-advanced">
          <summary>高级设置</summary>
          <div className="mt-4 grid gap-4">
            <label className="ui-field">连接名称<input className="ui-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} /></label>
            <label className="ui-field">Base URL<input className="ui-input" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })} /></label>
            {form.provider === "minimax" ? <div className="grid gap-4 sm:grid-cols-2">
              <label className="ui-field">服务区域<select className="ui-input" value={form.minimaxRegion} onChange={(event) => { const region = event.currentTarget.value as MiniMaxRegion; setForm((current) => ({ ...current, minimaxRegion: region, baseUrl: MINIMAX_ANTHROPIC_BASE_URLS[region] })); }}><option value="cn">中国大陆</option><option value="global">国际站</option></select></label>
              <label className="ui-field">Key 类型<select className="ui-input" value={form.minimaxCredentialPlan} onChange={(event) => { const value = event.currentTarget.value as MiniMaxCredentialPlan; setForm((current) => ({ ...current, minimaxCredentialPlan: value })); }}><option value="pay_as_you_go">按量 API Key</option><option value="token_plan">Token Plan Key</option></select></label>
            </div> : null}
            {form.provider === "azure" ? <label className="ui-field">语音语言<input className="ui-input" value={form.language} onChange={(event) => setForm({ ...form, language: event.currentTarget.value })} /></label> : null}
            {form.provider === "custom" ? <fieldset><legend className="text-sm font-semibold">连接能力</legend><div className="mt-2 flex flex-wrap gap-4">{formCapabilities.map((capability) => <label key={capability} className="inline-flex items-center gap-2 text-sm text-muted"><input checked={form.capabilities.includes(capability)} className="ui-checkbox" type="checkbox" onChange={() => toggleCapability(capability)} />{capabilityLabels[capability]}</label>)}</div></fieldset> : null}
            {form.provider === "custom" ? <label className="inline-flex items-start gap-2 text-sm text-muted"><input checked={form.allowPrivateNetwork} className="ui-checkbox mt-0.5" type="checkbox" onChange={(event) => setForm({ ...form, allowPrivateNetwork: event.currentTarget.checked })} /><span>允许访问局域网地址<small className="block">仅用于你信任的本地模型服务；云元数据和链路本地地址仍会被阻止。</small></span></label> : null}
            <label className="ui-field">API Key<input ref={apiKeyInputRef} className="ui-input" type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={form.id && editingCredentialHealth?.status === "reentry_required" ? "请重新输入 API Key" : form.id ? "留空保留原 Key" : form.provider === "custom" ? "无鉴权服务可留空" : "填写 API Key"} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} /></label>
            {editingCredentialHealth?.status === "reentry_required" ? <div className={compactStyles.credentialRecovery} role="alert"><strong>凭据需要重新输入</strong><span>{editingCredentialHealth.message}</span></div> : null}
          </div>
        </details>

        <section className="ai-connection-test-flow" aria-label="模型发现与连接测试">
          <div className="ai-connection-test-steps" aria-label="连接配置进度"><span>1 配置连接</span><span>2 获取模型</span><span>3 测试连接</span><span>4 完成</span></div>
          <div className="ai-connection-test-controls">
            <Button type="button" variant="outline" disabled={Boolean(busyAction) || credentialNeedsReentry} onClick={() => void discoverModels()}><AppIcon name="refresh" size={16} />{busyAction === "models" ? "获取中" : "获取模型"}</Button>
            <ModelCatalogSelect
              ariaLabel="测试模型 ID"
              disabled={credentialNeedsReentry}
              models={availableModels}
              placeholder="选择或输入模型 ID"
              provider={form.provider}
              value={selectedTestModelId}
              onChange={(modelId) => { setSelectedTestModelId(modelId); setTestSucceeded(false); }}
            />
            <Button type="button" variant="outline" disabled={!selectedTestModelId || Boolean(busyAction) || credentialNeedsReentry} onClick={() => void testSelectedModel()}><AppIcon name="activity" size={16} />{busyAction === "test" ? "测试中" : "测试连接"}</Button>
            {testSucceeded && form.id ? <Button type="button" variant="ghost" onClick={() => void setTestedAsDefault()}>设为默认</Button> : null}
          </div>
          <p>测试会使用所选模型发送一次极小真实请求，可能产生少量用量。</p>
        </section>

        <div className={compactStyles.connectionSaveRow}>
          <Button type="submit" variant="primary" disabled={Boolean(busyAction)}><AppIcon name="save" size={16} />{busyAction === "save" ? "保存中" : "保存连接"}</Button>
          {form.id ? <Button type="button" variant="ghost" onClick={() => { setForm(createForm()); setFeedback(null); setAvailableModels([]); setDiscoveredDirectory(undefined); setSelectedTestModelId(""); setTestSucceeded(false); }}><AppIcon name="newChat" size={16} />新建</Button> : null}
          <InlineStatus feedback={feedback} />
        </div>
      </form> : null}

      <div className={compactStyles.connectionDefaults}>
        <DefaultCapabilitySelector snapshot={snapshot} onSnapshotChange={setSnapshot} onChanged={onChanged} onFeedback={(text, tone = "success") => setFeedback({ text, tone })} />
      </div>
      <section className={compactStyles.connectionList} aria-label="已保存连接">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">已保存连接</h2>
            <span className="text-sm text-muted">{snapshot.profiles.length} 个</span>
          </div>
          <div className={compactStyles.connectionTable}>
            <div className={compactStyles.connectionTableHeader} aria-hidden="true">
              <span className={compactStyles.cellStart}>厂商 / 连接名称</span><span className={compactStyles.cellStart}>Base URL</span><span className={compactStyles.cellCenter}>状态</span><span className={compactStyles.cellCenter}>最近测试</span><span className={compactStyles.cellCenter}>操作</span>
            </div>
            {snapshot.profiles.length ? snapshot.profiles.map((profile) => (
              <article key={profile.id} className={compactStyles.connectionRow} data-selected={selectedProfileId === profile.id}>
                  <button className={compactStyles.connectionIdentity} type="button" onClick={() => setSelectedProfileId(profile.id)}>
                    <ProviderIcon provider={profile.provider} size={26} />
                    <span><strong>{getProviderContract(profile.provider).label}</strong><small>{profile.label}</small></span>
                  </button>
                  <code className={`${compactStyles.connectionUrl} ${compactStyles.cellStart}`}>{profile.baseUrl}</code>
                  <span className={`${compactStyles.connectionStatus} ${compactStyles.cellCenter}`} data-status={credentialHealth[profile.id]?.status === "reentry_required" ? "failed" : profile.testStatus ?? "saved"}>{credentialHealth[profile.id]?.status === "reentry_required" ? "需要重新输入" : statusLabel(profile)}</span>
                  <span className={`${compactStyles.cellCenter} text-xs text-muted`}>{profile.testStatus && profile.testStatus !== "idle" ? formatConnectionDate(profile.updatedAt) : "尚未测试"}</span>
                  <div className={`${compactStyles.connectionActions} ${compactStyles.cellCenter}`}>
                    <Button size="sm" variant="ghost" onClick={() => editProfile(profile)}><AppIcon name="edit" size={14} />{credentialHealth[profile.id]?.status === "reentry_required" ? "重新输入密钥" : "编辑"}</Button>
                    <Button size="sm" variant="ghost" disabled={Boolean(busyAction) || credentialHealth[profile.id]?.status === "reentry_required"} onClick={() => void testSavedProfile(profile)}><AppIcon name="activity" size={14} />{busyAction === `test:${profile.id}` ? "测试中" : "测试"}</Button>
                    <Button size="sm" variant="danger" onClick={() => void removeProfile(profile)}><AppIcon name="trash" size={14} />删除</Button>
                  </div>
              </article>
            )) : <div className="py-4"><EmptyState stateId="settings.connections.empty">尚未保存连接。</EmptyState></div>}
          </div>
          {selectedProfile ? (
            <div className={compactStyles.connectionDetails} aria-label={`${selectedProfile.label}连接详情`}>
              <div><span>连接名称</span><strong>{selectedProfile.label}</strong></div>
              <div><span>鉴权状态</span><strong>{selectedCredentialHealth?.status === "reentry_required" ? "凭据需要重新输入" : statusLabel(selectedProfile)}</strong></div>
              <div><span>Base URL</span><code>{selectedProfile.baseUrl}</code></div>
              <div><span>最近测试</span><strong>{selectedProfile.testStatus && selectedProfile.testStatus !== "idle" ? formatConnectionDate(selectedProfile.updatedAt) : "尚未测试"}</strong></div>
              <p>{selectedCredentialHealth?.status === "reentry_required" ? selectedCredentialHealth.message : "密钥仅保存在本机加密仓储，此处不会显示或复制。"}</p>
              {selectedProfile.testHistory?.length ? <div className={compactStyles.testHistory}><span>测试记录</span>{selectedProfile.testHistory.slice(0, 3).map((item) => <strong key={item.id} data-status={item.status}>{formatConnectionDate(item.testedAt)} · {item.message}{item.latencyMs ? ` · ${item.latencyMs} ms` : ""}</strong>)}</div> : null}
            </div>
          ) : null}
      </section>
    </section>
  );
}

/** 使用紧凑本地时间展示连接测试时间。 */
function formatConnectionDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
