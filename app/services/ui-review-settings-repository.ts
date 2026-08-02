import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { AiConnectionDefaults } from "../types/domains/ai-connection.ts";
import type { SampleScenarioId } from "../features/shared/sample-scenario-registry.ts";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";
import { UI_REVIEW_ID_PREFIX, isUiReviewRecordId, sampleRecordId } from "./workspace-data-scope.ts";

const CONNECTION_ID = `${UI_REVIEW_ID_PREFIX}settings:ai-connection`;
const MCP_ID = `${UI_REVIEW_ID_PREFIX}integrations:mcp-search`;
const EXTENSION_ID = `${UI_REVIEW_ID_PREFIX}settings:extension`;
const DEFAULTS_BACKUP_KEY = "review-workspace:ui-review-defaults-backup";

type SettingsScenarioId = Extract<SampleScenarioId,
  "plugins-directory-dense" | "settings-ai-connections-dense" | "settings-ai-credential-recovery">;

function timestamp(): string {
  return new Date().toISOString();
}

function saveDefaultsBackup(defaults: AiConnectionDefaults | undefined): void {
  if (typeof window === "undefined" || window.localStorage.getItem(DEFAULTS_BACKUP_KEY) !== null) return;
  window.localStorage.setItem(DEFAULTS_BACKUP_KEY, JSON.stringify(defaults ?? null));
}

async function restoreDefaultsBackup(): Promise<void> {
  if (typeof window === "undefined") {
    const current = await reviewDb.apiConnectionDefaults.get("default");
    if (current && Object.values(current).some((value) => typeof value === "string" && isUiReviewRecordId(value))) {
      await reviewDb.apiConnectionDefaults.delete("default");
    }
    return;
  }
  const serialized = window.localStorage.getItem(DEFAULTS_BACKUP_KEY);
  if (serialized === null) return;
  const backup = JSON.parse(serialized) as AiConnectionDefaults | null;
  if (backup) await reviewDb.apiConnectionDefaults.put(backup);
  else await reviewDb.apiConnectionDefaults.delete("default");
  window.localStorage.removeItem(DEFAULTS_BACKUP_KEY);
}

function reviewProfile(
  scenarioId: SettingsScenarioId,
  localId: string,
  input: Pick<ApiConnectionProfile, "label" | "provider" | "apiFormat" | "baseUrl" | "capabilities" | "testStatus"> & {
    modelId: string;
    credentialState?: "ready" | "reentry_required";
    minutesAgo?: number;
  },
): ApiConnectionProfile {
  const now = new Date();
  const testedAt = new Date(now.getTime() - (input.minutesAgo ?? 0) * 60_000).toISOString();
  return {
    id: sampleRecordId(scenarioId, localId),
    label: input.label,
    provider: input.provider,
    apiFormat: input.apiFormat,
    baseUrl: input.baseUrl,
    capabilities: input.capabilities,
    encryptedKey: "",
    iv: "",
    maskedKey: "UI 审查，无真实凭据",
    providerOptions: { uiReviewCredentialState: input.credentialState ?? "ready", region: "本地审查" },
    testStatus: input.testStatus,
    testMessage: input.credentialState === "reentry_required" ? "凭据需要重新输入" : "仅用于 UI 审查，未请求外部服务",
    testHistory: [{
      id: sampleRecordId(scenarioId, `${localId}-test`),
      testedAt,
      status: input.testStatus === "failed" ? "failed" : "success",
      modelId: input.modelId,
      latencyMs: input.testStatus === "failed" ? undefined : 428 + (input.minutesAgo ?? 0),
      category: input.testStatus === "failed" ? "credential" : "ui-review",
      message: input.testStatus === "failed" ? "审查凭据不可读" : "脱敏 UI 审查记录",
    }],
    createdAt: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    updatedAt: testedAt,
  };
}

async function seedConnectionScenario(scenarioId: Exclude<SettingsScenarioId, "plugins-directory-dense">): Promise<void> {
  const previousDefaults = await reviewDb.apiConnectionDefaults.get("default");
  saveDefaultsBackup(previousDefaults);
  await reviewDb.apiConnectionProfiles.filter((profile) => isUiReviewRecordId(profile.id)).delete();
  const now = timestamp();
  if (scenarioId === "settings-ai-credential-recovery") {
    const recovery = reviewProfile(scenarioId, "openai-recovery", {
      label: "openai-prod",
      provider: "openai",
      apiFormat: "responses",
      baseUrl: "https://api.openai.com/v1",
      capabilities: ["text", "vision", "structured_output", "streaming"],
      testStatus: "failed",
      modelId: "gpt-4.1",
      credentialState: "reentry_required",
    });
    await reviewDb.apiConnectionProfiles.put(recovery);
    await reviewDb.apiConnectionDefaults.put({ id: "default", textConnectionId: recovery.id, textModelId: "gpt-4.1", updatedAt: now });
    return;
  }
  const profiles = [
    reviewProfile(scenarioId, "openai", { label: "openai-prod", provider: "openai", apiFormat: "responses", baseUrl: "https://api.openai.com/v1", capabilities: ["text", "vision", "speech", "structured_output", "streaming"], testStatus: "success", modelId: "gpt-4.1", minutesAgo: 4 }),
    reviewProfile(scenarioId, "gemini", { label: "gemini-main", provider: "google", apiFormat: "google_generate_content", baseUrl: "https://generativelanguage.googleapis.com/v1beta", capabilities: ["text", "vision", "structured_output", "streaming"], testStatus: "success", modelId: "gemini-2.5-pro", minutesAgo: 38 }),
    reviewProfile(scenarioId, "deepseek", { label: "deepseek-official", provider: "deepseek", apiFormat: "chat_completions", baseUrl: "https://api.deepseek.com/v1", capabilities: ["text", "structured_output", "streaming"], testStatus: "success", modelId: "deepseek-chat", minutesAgo: 92 }),
  ];
  await reviewDb.apiConnectionProfiles.bulkPut(profiles);
  await reviewDb.apiConnectionDefaults.put({
    id: "default",
    textConnectionId: profiles[0].id,
    textModelId: "gpt-4.1",
    visionConnectionId: profiles[1].id,
    visionModelId: "gemini-2.5-pro",
    speechConnectionId: profiles[0].id,
    speechModelId: "gpt-4o-mini-tts",
    updatedAt: now,
  });
}

async function seedPluginScenario(scenarioId: "plugins-directory-dense"): Promise<void> {
  const { officialDeclarativeExtensionCatalog } = await import("./declarative-extension-catalog.ts");
  const now = timestamp();
  const templates = officialDeclarativeExtensionCatalog.slice(0, 2);
  await extensionDb.extensions.bulkPut(templates.map((template, index) => {
    const recordId = sampleRecordId(scenarioId, `extension-${index}`);
    return {
      id: recordId,
      kind: template.manifest.kind,
      enabled: index === 0,
      source: index === 0 ? "catalog" as const : "local" as const,
      package: {
        ...template,
        manifest: {
          ...template.manifest,
          id: recordId,
          name: index === 0 ? "申论结构教练" : "专注纸张",
          description: "内置 UI 审查数据，不包含可执行代码或远程资源。",
        },
      },
      installedAt: new Date(Date.now() - (index + 2) * 86_400_000).toISOString(),
      updatedAt: now,
    };
  }));
}

/** 设置审查数据只写安全元数据，不创建真实密钥、额度凭据或 Vault 授权。 */
export const uiReviewSettingsRepository = {
  async seedScenario(scenarioId: SettingsScenarioId): Promise<void> {
    if (scenarioId === "plugins-directory-dense") await seedPluginScenario(scenarioId);
    else await seedConnectionScenario(scenarioId);
  },

  async seed(): Promise<void> {
    const now = timestamp();
    const connection: ApiConnectionProfile = {
      id: CONNECTION_ID,
      label: "UI 审查 · 文本连接（无凭据）",
      provider: "custom",
      apiFormat: "chat_completions",
      baseUrl: "https://ui-review.invalid/v1",
      capabilities: ["text", "streaming"],
      encryptedKey: "",
      iv: "",
      maskedKey: "未配置",
      providerOptions: {},
      testStatus: "idle",
      testMessage: "仅用于 UI 审查，禁止外部请求",
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.apiConnectionProfiles.put(connection);
    for (const profile of mcpSettingsRepository.load().profiles) {
      if (
        profile.id !== MCP_ID
        && profile.label === "UI 审查 · 搜索 Server"
        && profile.endpoint === "https://ui-review.invalid/mcp"
      ) {
        mcpSettingsRepository.removeProfile(profile.id);
      }
    }
    await mcpSettingsRepository.saveProfile({
      id: MCP_ID,
      label: "UI 审查 · 搜索 Server",
      endpoint: "https://ui-review.invalid/mcp",
      enabled: false,
      authMode: "none",
      catalogSource: "recommended",
      toolAllowlist: ["search"],
    });

    const { officialDeclarativeExtensionCatalog } = await import("./declarative-extension-catalog.ts");
    const template = officialDeclarativeExtensionCatalog[0];
    await extensionDb.extensions.put({
      id: EXTENSION_ID,
      kind: template.manifest.kind,
      enabled: false,
      source: "catalog",
      package: {
        ...template,
        manifest: {
          ...template.manifest,
          id: EXTENSION_ID,
          name: "UI 审查 · 声明式扩展",
          description: "内置 UI 审查数据，不包含可执行代码。",
        },
      },
      installedAt: now,
      updatedAt: now,
    });
    await Promise.all([
      this.seedScenario("plugins-directory-dense"),
      this.seedScenario("settings-ai-connections-dense"),
    ]);
  },

  async clear(): Promise<void> {
    await reviewDb.apiConnectionProfiles.filter((record) => isUiReviewRecordId(record.id)).delete();
    await restoreDefaultsBackup();
    const mcp = mcpSettingsRepository.load();
    for (const profile of mcp.profiles.filter((record) => isUiReviewRecordId(record.id))) {
      mcpSettingsRepository.removeProfile(profile.id);
    }
    await extensionDb.extensions.filter((record) => isUiReviewRecordId(record.id)).delete();
  },

  async count(): Promise<number> {
    const [connections, extensions] = await Promise.all([
      reviewDb.apiConnectionProfiles.filter((record) => isUiReviewRecordId(record.id)).count(),
      extensionDb.extensions.filter((record) => isUiReviewRecordId(record.id)).count(),
    ]);
    const mcp = mcpSettingsRepository.load().profiles.filter((record) => isUiReviewRecordId(record.id)).length;
    return connections + extensions + mcp;
  },
};
