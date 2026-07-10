"use client";

import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { generateWithConnection, type GenerateConnectionPurpose } from "../../services/ai-connection-client";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import { creatableProviderContracts, getProviderContract, getProviderModelCatalog, getProviderModels, type ProviderContract } from "../../services/provider-contracts";
import type { AiCapability, AiConnectionPurpose, AiConnectionSnapshot, AiModelCatalogEntry, ApiConnectionProfile, ApiProvider } from "../../types/review";
import { Button, EmptyState, SegmentedTabs, cx } from "../shared/ui-primitives";

type SubmitEvent = SyntheticEvent<HTMLFormElement, globalThis.SubmitEvent>;
type Feedback = { tone: "success" | "error" | "neutral"; text: string } | null;
type ConnectionForm = {
  id: string;
  label: string;
  provider: ApiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  capabilities: AiCapability[];
  language: string;
};

const purposeLabels: Record<AiConnectionPurpose, string> = { text: "默认文本", vision: "默认多模态", speech: "默认语音" };
const capabilityLabels: Partial<Record<AiCapability, string>> = { text: "文本", vision: "多模态", structured_output: "结构化输出", speech: "语音" };
const purposeTabs: Array<{ key: AiConnectionPurpose; label: string }> = [
  { key: "text", label: "文本模型" },
  { key: "vision", label: "多模态" },
  { key: "speech", label: "语音合成" },
];
const manualModelOption = "__manual__";

function capabilitiesForPurpose(contract: ProviderContract, purpose: AiConnectionPurpose): AiCapability[] {
  if (purpose === "text") return contract.capabilities.filter((capability) => capability === "text" || capability === "structured_output");
  return contract.capabilities.filter((capability) => capability === purpose);
}

// 按当前能力创建连接草稿，模型只从已核验清单中预填。
function createForm(provider: ApiProvider = "openai", purpose: AiConnectionPurpose = "text"): ConnectionForm {
  const contract = getProviderContract(provider);
  const models = getProviderModels(provider, purpose);
  return {
    id: "",
    label: contract.label,
    provider,
    baseUrl: contract.baseUrl,
    model: models[0] ?? "",
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

function modelStatusLabel(model?: AiModelCatalogEntry): string {
  if (!model) return "内置";
  if (model.status === "recommended") return "推荐";
  if (model.status === "preview") return "预览";
  if (model.status === "deprecated") return "弃用";
  return model.source === "official" ? "官方" : "手动";
}

function modelCapabilityText(model?: AiModelCatalogEntry): string {
  if (!model) return "保存后用测试连接确认";
  return model.capabilities.map((capability) => capabilityLabels[capability] ?? capability).join(" / ");
}

// 配置多厂商连接、能力默认值和连接测试；厂商协议细节只存在于服务端适配器。
export function ApiConnectionsSettingsView({ onChanged, onClearLocalRecords, onOpenPlugins }: { onChanged?: () => void; onClearLocalRecords?: () => void; onOpenPlugins?: () => void }) {
  const [snapshot, setSnapshot] = useState<AiConnectionSnapshot>({ profiles: [], defaults: { id: "default", updatedAt: "" } });
  const [activePurpose, setActivePurpose] = useState<AiConnectionPurpose>("text");
  const [form, setForm] = useState<ConnectionForm>(() => createForm());
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const contract = useMemo(() => getProviderContract(form.provider), [form.provider]);
  const modelOptions = useMemo(() => getProviderModels(form.provider, activePurpose), [activePurpose, form.provider]);
  const modelCatalog = useMemo(() => getProviderModelCatalog(form.provider, activePurpose), [activePurpose, form.provider]);
  const modelChoices = useMemo(() => {
    const catalogById = new Map(modelCatalog.map((item) => [item.id, item]));
    return Array.from(new Set([...modelCatalog.map((item) => item.id), ...modelOptions])).map((id) => ({ id, catalog: catalogById.get(id) }));
  }, [modelCatalog, modelOptions]);
  const selectedModelCatalog = modelCatalog.find((item) => item.id === form.model);
  const selectedModelValue = modelChoices.some((item) => item.id === form.model) ? form.model : manualModelOption;
  const manualModelActive = selectedModelValue === manualModelOption;

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

  const visibleContracts = useMemo(
    () => creatableProviderContracts.filter((item) => item.provider !== "custom" && item.capabilities.includes(activePurpose)),
    [activePurpose],
  );

  const groupedContracts = useMemo(() => {
    if (activePurpose === "speech") return [{ label: "语音服务", items: visibleContracts }];
    return [
      { label: "商用模型服务", items: visibleContracts.filter((item) => item.group === "commercial") },
      { label: "开源模型服务", items: visibleContracts.filter((item) => item.group === "open_source") },
    ].filter((group) => group.items.length);
  }, [activePurpose, visibleContracts]);

  function selectProvider(provider: ApiProvider) {
    setForm(createForm(provider, activePurpose));
    setFeedback(null);
  }

  function editProfile(profile: ApiConnectionProfile) {
    setActivePurpose(profile.capabilities.includes("speech") && !profile.capabilities.includes("text") ? "speech" : profile.capabilities.includes("vision") ? "vision" : "text");
    setForm({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
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
    if (!form.model.trim() && form.provider !== "azure") {
      setFeedback({ tone: "error", text: "请填写官方控制台中可用的模型 ID" });
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
        model: form.model,
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
    const requestedPurpose = activePurpose !== "speech" && profile.capabilities.includes(activePurpose)
      ? activePurpose
      : profile.capabilities.includes("text")
        ? "text"
        : profile.capabilities.includes("vision")
          ? "vision"
          : undefined;
    if (!requestedPurpose) {
      setFeedback({ tone: "neutral", text: "语音连接请在个性化页面通过试听验证" });
      return;
    }
    const purpose = requestedPurpose as GenerateConnectionPurpose;
    setBusyAction(`test:${profile.id}`);
    setFeedback({ tone: "neutral", text: `正在测试${purpose === "vision" ? "多模态" : "文本"}连接…` });
    try {
      await generateWithConnection(profile, purpose, {
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

  const editableContracts = contract.creatable ? creatableProviderContracts : [contract, ...creatableProviderContracts];
  const formCapabilities = contract.capabilities.filter((capability) => capabilityLabels[capability]);

  return (
    <section>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">AI 连接</h1>
        <p className="mt-2 text-sm text-muted">管理文本、多模态与语音服务。API Key 使用 Web Crypto 加密，仅在请求前解密。</p>
        {onOpenPlugins ? (
          <p className="mt-2 text-sm text-muted">
            额度、Obsidian Vault 和后续厂商适配已集中到
            <button className="ml-1 font-semibold text-blue hover:underline" type="button" onClick={onOpenPlugins}>插件</button>
            。
          </p>
        ) : null}
      </header>

      <div className="mt-7">
        <SegmentedTabs active={activePurpose} items={purposeTabs} onChange={(purpose) => { setActivePurpose(purpose); setForm(createForm("openai", purpose)); setFeedback(null); }} />
      </div>

      <section className="mt-6 border-y border-line" aria-label="默认厂商">
        {groupedContracts.map((group) => (
          <div key={group.label} className="border-b border-line last:border-b-0">
            <h2 className="px-3 py-2 text-sm font-semibold text-foreground">{group.label}</h2>
            {group.items.map((item) => {
              const savedProfile = snapshot.profiles.find((profile) => profile.provider === item.provider && profile.capabilities.includes(activePurpose));
              return (
                <button
                  key={item.provider}
                  className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)_7rem] items-center gap-4 border-t border-line px-3 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-blue max-md:grid-cols-[1fr_auto]"
                  type="button"
                  onClick={() => selectProvider(item.provider)}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted max-md:hidden">{item.models[activePurpose]?.[0] || "模型需手动填写"}</span>
                  <span className={savedProfile?.testStatus === "success" ? "text-green" : "text-muted"}>{statusLabel(savedProfile)}</span>
                </button>
              );
            })}
          </div>
        ))}
        <button className="flex min-h-12 w-full items-center justify-between gap-4 px-3 text-left text-sm hover:bg-surface-muted" type="button" onClick={() => selectProvider("custom")}>
          <span className="font-medium">本地部署 / 自定义连接</span>
          <span className="text-right text-muted">兼容 Chat Completions 与 /audio/speech</span>
        </button>
      </section>

      <section className="mt-7 rounded-lg border border-line bg-surface" aria-label="默认能力分配">
        <div className="grid grid-cols-3 divide-x divide-line max-md:grid-cols-1 max-md:divide-x-0 max-md:divide-y">
          {(Object.keys(purposeLabels) as AiConnectionPurpose[]).map((purpose) => {
            const key = `${purpose}ConnectionId` as const;
            const options = snapshot.profiles.filter((profile) => profile.capabilities.includes(purpose));
            return (
              <label key={purpose} className="grid gap-2 p-3 text-sm font-medium">
                {purposeLabels[purpose]}
                <select className="settings-select min-h-10 rounded-lg border border-line bg-surface px-3 text-sm" value={snapshot.defaults[key] ?? ""} onChange={(event) => void setDefault(purpose, event.target.value)}>
                  <option value="">未指定</option>
                  {options.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      </section>

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)] gap-8 max-xl:grid-cols-1">
        <form className="min-w-0" onSubmit={saveConnection}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <h2 className="text-lg font-semibold">{form.id ? `${form.label} 连接` : "新增连接"}</h2>
            <InlineStatus feedback={feedback} />
          </div>

          <div className="mt-4 grid gap-4">
            <label className="ui-field">连接名称<input className="ui-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
            <label className="ui-field">厂商
              <select className="ui-select" value={form.provider} onChange={(event) => selectProvider(event.target.value as ApiProvider)}>
                {editableContracts.map((item) => <option key={item.provider} value={item.provider}>{item.label}{item.creatable ? "" : "（历史连接）"}</option>)}
              </select>
            </label>
            <label className="ui-field">Base URL
              <input className="ui-input" placeholder={form.provider === "azure" ? "https://<region>.tts.speech.microsoft.com/cognitiveservices/v1" : undefined} value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            </label>
            <label className="ui-field">模型
              <select
                className="ui-select"
                value={selectedModelValue}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setForm({ ...form, model: nextValue === manualModelOption ? "" : nextValue });
                }}
              >
                {modelChoices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {modelStatusLabel(item.catalog)}
                  </option>
                ))}
                <option value={manualModelOption}>手动填写模型 ID</option>
              </select>
              <span className="text-xs leading-5 text-muted">
                {manualModelActive ? "手动模型会在保存后通过“测试连接”确认真实可用性。" : `${modelStatusLabel(selectedModelCatalog)} · ${modelCapabilityText(selectedModelCatalog)}`}
              </span>
            </label>
            {manualModelActive ? (
              <label className="ui-field">手动模型 ID
                <input className="ui-input" placeholder="填写官方控制台中的模型 ID" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
              </label>
            ) : null}
            {form.provider === "azure" ? <label className="ui-field">语音语言<input className="ui-input" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })} /></label> : null}
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">连接能力</legend>
              <div className="flex flex-wrap gap-4">
                {formCapabilities.map((capability) => (
                  <label key={capability} className="inline-flex items-center gap-2 text-sm text-muted">
                    <input checked={form.capabilities.includes(capability)} className="ui-checkbox" type="checkbox" onChange={() => toggleCapability(capability)} />
                    {capabilityLabels[capability]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="ui-field">API Key
              <input className="ui-input" type="password" autoComplete="new-password" placeholder={form.id ? "留空则保留原 Key" : form.provider === "custom" ? "本地无鉴权服务可留空" : "首次保存必须填写"} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
            </label>
          </div>

          <p className="mt-3 text-xs text-muted">
            {contract.verifiedAt ? `官方契约核对日期：${contract.verifiedAt}` : "默认模型需要手动核验。"}
            {" · "}
            {contract.modelListStrategy === "official_api" ? "支持通过官方模型接口核验；本页保存连接后用测试连接确认。" : contract.modelListStrategy === "static_catalog" ? "使用官方文档静态目录。" : "使用手动模型目录。"}
            {contract.documentationUrl ? <a className="ml-1 font-semibold text-blue hover:underline" href={contract.documentationUrl} rel="noreferrer" target="_blank">文档</a> : null}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="submit" variant="primary" disabled={Boolean(busyAction)}>{busyAction === "save" ? <><span className="ui-spinner" />保存中</> : "保存"}</Button>
            <Button type="button" variant="outline" disabled={!form.id || Boolean(busyAction)} onClick={() => { const profile = snapshot.profiles.find((item) => item.id === form.id); if (profile) void testConnection(profile); }}>
              {busyAction === `test:${form.id}` ? <><span className="ui-spinner" />测试中</> : "测试连接"}
            </Button>
            {form.id ? <Button type="button" variant="ghost" onClick={() => setForm(createForm("openai", activePurpose))}>新建连接</Button> : null}
          </div>
        </form>

        <section className="min-w-0 border-l border-line pl-6 max-xl:border-l-0 max-xl:border-t max-xl:pt-6 max-xl:pl-0" aria-label="已保存连接">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">已保存连接</h2>
            <span className="text-sm text-muted">{snapshot.profiles.length} 个</span>
          </div>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {snapshot.profiles.length ? snapshot.profiles.map((profile) => (
              <article key={profile.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <button className="min-w-0 text-left" type="button" onClick={() => editProfile(profile)}>
                    <strong className="block truncate text-sm font-medium">{profile.label}</strong>
                    <span className="mt-1 block truncate text-xs text-muted">{profile.model || "无模型"} · {profile.maskedKey}</span>
                    <span className="mt-1 block text-xs text-muted">{profile.capabilities.filter((item) => capabilityLabels[item]).map((item) => capabilityLabels[item]).join(" / ")}</span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => editProfile(profile)}>编辑</Button>
                    <Button size="sm" variant="danger" onClick={() => void removeProfile(profile)}>删除</Button>
                  </div>
                </div>
                {profile.testMessage ? <p className={cx("mt-2 text-xs", profile.testStatus === "failed" ? "text-red" : "text-muted")}>{profile.testMessage}</p> : null}
              </article>
            )) : <div className="py-4"><EmptyState>尚未保存连接。</EmptyState></div>}
          </div>
        </section>
      </div>

      {onClearLocalRecords ? <div className="mt-9 border-t border-line pt-5"><Button type="button" variant="danger" onClick={onClearLocalRecords}>清空错题和导入记录</Button></div> : null}
    </section>
  );
}
