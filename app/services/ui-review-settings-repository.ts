import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";
import { UI_REVIEW_ID_PREFIX, isUiReviewRecordId } from "./workspace-data-scope.ts";

const CONNECTION_ID = `${UI_REVIEW_ID_PREFIX}settings:ai-connection`;
const MCP_ID = `${UI_REVIEW_ID_PREFIX}integrations:mcp-search`;
const EXTENSION_ID = `${UI_REVIEW_ID_PREFIX}settings:extension`;

function timestamp(): string {
  return new Date().toISOString();
}

/** 设置审查数据只写安全元数据，不创建真实密钥、额度凭据或 Vault 授权。 */
export const uiReviewSettingsRepository = {
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
  },

  async clear(): Promise<void> {
    await reviewDb.apiConnectionProfiles.filter((record) => isUiReviewRecordId(record.id)).delete();
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
