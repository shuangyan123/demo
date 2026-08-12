import type { McpDiscoveryResult, McpServerProfile, McpToolDescriptor, McpToolPermission } from "../types/domains/mcp.ts";
import { clearDesktopCredential, hasCredentialReference, readCredentialSecret, writeCredentialSecret, type CredentialReference } from "./credential-backend.ts";
import type { ClientApiErrorPayload } from "./api-error.ts";
import { fetchLocalApi } from "./local-runtime-diagnostics.ts";
import { normalizeMcpPersistedPermission, type McpExecutionContext } from "./mcp-permission.ts";
import { clearMcpSessionPermissions, grantMcpSessionPermission, hasMcpSessionPermission, retainMcpSessionPermissions, revokeMcpSessionPermission } from "./mcp-session-permission-store.ts";
import { secretContext } from "./secret-context.ts";
import { ensureStoredSecretsMigrated } from "./secret-migration-service.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";
import { isUiReviewRecordId } from "./workspace-data-scope.ts";
import { isUiReviewRuntimeActive } from "./ui-review-runtime-guard.ts";

const STORAGE_KEY = secretStorageLocations.mcpSettings;
const LEGACY_STORAGE_KEY = secretStorageLocations.legacyMcpSettings;

export type McpSettingsSnapshot = {
  profiles: McpServerProfile[];
  discovery: Record<string, McpDiscoveryResult>;
};

type McpRemoteTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };

function now(): string {
  return new Date().toISOString();
}

function defaultSnapshot(): McpSettingsSnapshot {
  return { profiles: [], discovery: {} };
}

function normalizeDiscovery(serverId: string, value: unknown): McpDiscoveryResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const discovery = value as McpDiscoveryResult;
  return {
    ...discovery,
    serverId,
    toolDescriptors: Array.isArray(discovery.toolDescriptors)
      ? discovery.toolDescriptors.map((tool) => ({ ...tool, permission: normalizeMcpPersistedPermission(tool.permission) }))
      : undefined,
  };
}

function normalizeProfile(profile: Partial<McpServerProfile>): McpServerProfile | undefined {
  if (!profile.id || !profile.endpoint) return undefined;
  const timestamp = now();
  return {
    id: profile.id,
    label: profile.label?.trim() || "MCP Server",
    endpoint: profile.endpoint.trim().replace(/[?#].*$/, ""),
    enabled: profile.enabled !== false,
    authMode: profile.authMode === "bearer" ? "bearer" : "none",
    allowPrivateNetwork: profile.allowPrivateNetwork === true,
    encryptedToken: profile.encryptedToken,
    encryptedTokenIv: profile.encryptedTokenIv,
    toolAllowlist: Array.isArray(profile.toolAllowlist) ? profile.toolAllowlist.filter((item) => typeof item === "string") : undefined,
    catalogSource: profile.catalogSource === "recommended" || profile.catalogSource === "registry" ? profile.catalogSource : "custom",
    createdAt: profile.createdAt ?? timestamp,
    updatedAt: profile.updatedAt ?? timestamp,
  };
}

function readPersistedSnapshot(): McpSettingsSnapshot {
  if (typeof window === "undefined") return defaultSnapshot();
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return defaultSnapshot();
  try {
    const parsed = JSON.parse(raw) as Partial<McpSettingsSnapshot>;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles.flatMap((profile) => {
        const normalized = normalizeProfile(profile);
        return normalized ? [normalized] : [];
      }) : [],
      discovery: parsed.discovery && typeof parsed.discovery === "object"
        ? Object.fromEntries(Object.entries(parsed.discovery).flatMap(([serverId, value]) => {
          const normalized = normalizeDiscovery(serverId, value);
          return normalized ? [[serverId, normalized]] : [];
        }))
        : {},
    };
  } catch {
    return defaultSnapshot();
  }
}

function applySessionPermissions(snapshot: McpSettingsSnapshot): McpSettingsSnapshot {
  for (const [serverId, discovery] of Object.entries(snapshot.discovery)) {
    if (!discovery.toolDescriptors) continue;
    discovery.toolDescriptors = discovery.toolDescriptors.map((tool) => ({
      ...tool,
      permission: tool.permission !== "deny" && hasMcpSessionPermission(serverId, tool.name) ? "allow_session" : tool.permission,
    }));
  }
  return snapshot;
}

function writeSnapshot(snapshot: McpSettingsSnapshot): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

async function tokenFor(profile: McpServerProfile): Promise<string> {
  if (profile.authMode !== "bearer") return "";
  const context = secretContext.mcpToken(profile.id);
  const reference: CredentialReference = { encryptedKey: profile.encryptedToken, iv: profile.encryptedTokenIv };
  if (!hasCredentialReference(context, reference)) return "";
  await ensureStoredSecretsMigrated();
  return readCredentialSecret(context, reference);
}

async function requestJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetchLocalApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json() as T & ClientApiErrorPayload;
  if (!response.ok) throw new Error(result.message || result.error || "MCP 请求失败");
  return result;
}

async function executeTool(serverId: string, toolName: string, args: Record<string, unknown>, context: McpExecutionContext): Promise<unknown> {
  const { executeMcpTool } = await import("./mcp-execution.ts");
  return executeMcpTool(serverId, toolName, args, context, { readSnapshot: readPersistedSnapshot, tokenFor, requestJson });
}

export const mcpSettingsRepository = {
  load(): McpSettingsSnapshot {
    return applySessionPermissions(readPersistedSnapshot());
  },

  async saveProfile(input: { id?: string; label: string; endpoint: string; enabled: boolean; authMode: "none" | "bearer"; token?: string; allowPrivateNetwork?: boolean; toolAllowlist?: string[]; catalogSource?: McpServerProfile["catalogSource"] }): Promise<McpServerProfile> {
    await ensureStoredSecretsMigrated();
    const snapshot = readPersistedSnapshot();
    const timestamp = now();
    const existing = input.id ? snapshot.profiles.find((profile) => profile.id === input.id) : undefined;
    const profileId = existing?.id ?? input.id ?? crypto.randomUUID();
    const endpoint = input.endpoint.trim().replace(/[?#].*$/, "");
    const connectionChanged = Boolean(existing && (existing.endpoint !== endpoint || existing.authMode !== input.authMode || existing.allowPrivateNetwork !== (input.allowPrivateNetwork === true)));
    const canEnable = Boolean(existing && !connectionChanged && snapshot.discovery[profileId]?.status === "ready");
    const existingReference: CredentialReference | undefined = existing
      ? { encryptedKey: existing.encryptedToken, iv: existing.encryptedTokenIv }
      : undefined;
    const encrypted = input.authMode === "bearer" && input.token?.trim()
      ? await writeCredentialSecret(secretContext.mcpToken(profileId), existingReference, input.token.trim())
      : existing?.encryptedToken || existing?.encryptedTokenIv || hasCredentialReference(secretContext.mcpToken(profileId), existingReference)
        ? existingReference
        : undefined;
    const profile: McpServerProfile = {
      id: profileId,
      label: input.label.trim() || "MCP Server",
      endpoint,
      enabled: input.enabled && canEnable,
      authMode: input.authMode,
      allowPrivateNetwork: input.allowPrivateNetwork === true,
      encryptedToken: input.authMode === "bearer" ? encrypted?.encryptedKey || undefined : undefined,
      encryptedTokenIv: input.authMode === "bearer" ? encrypted?.iv || undefined : undefined,
      toolAllowlist: input.toolAllowlist ?? existing?.toolAllowlist,
      catalogSource: input.catalogSource ?? existing?.catalogSource ?? "custom",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const discovery = { ...snapshot.discovery };
    if (connectionChanged) {
      delete discovery[profileId];
      clearMcpSessionPermissions(profileId);
    }
    writeSnapshot({ profiles: [profile, ...snapshot.profiles.filter((item) => item.id !== profile.id)], discovery });
    if (input.authMode !== "bearer") clearDesktopCredential(secretContext.mcpToken(profileId));
    return profile;
  },

  removeProfile(id: string): void {
    const snapshot = readPersistedSnapshot();
    const discovery = { ...snapshot.discovery };
    delete discovery[id];
    clearMcpSessionPermissions(id);
    clearDesktopCredential(secretContext.mcpToken(id));
    writeSnapshot({ profiles: snapshot.profiles.filter((profile) => profile.id !== id), discovery });
  },

  async discover(profile: McpServerProfile): Promise<McpDiscoveryResult> {
    if (isUiReviewRuntimeActive() || isUiReviewRecordId(profile.id)) throw new Error("UI 审查 MCP 只用于检查界面，不会连接外部 Server。");
    const snapshot = readPersistedSnapshot();
    try {
      const remote = await requestJson<{ tools: McpRemoteTool[]; resources: Array<{ name: string }>; prompts: Array<{ name: string }> }>("/api/mcp/discover", {
        endpoint: profile.endpoint,
        token: await tokenFor(profile),
        allowPrivateNetwork: profile.allowPrivateNetwork === true,
      });
      const existingPermissions = new Map((snapshot.discovery[profile.id]?.toolDescriptors ?? []).map((tool) => [tool.name, tool.permission]));
      const allowedTools = profile.toolAllowlist?.length
        ? remote.tools.filter((tool) => profile.toolAllowlist?.includes(tool.name))
        : remote.tools;
      retainMcpSessionPermissions(profile.id, allowedTools.map((tool) => tool.name));
      const toolDescriptors: McpToolDescriptor[] = allowedTools.map((tool) => ({
        ...tool,
        permission: normalizeMcpPersistedPermission(existingPermissions.get(tool.name) ?? "ask"),
      }));
      const result: McpDiscoveryResult = {
        serverId: profile.id,
        status: "ready",
        tools: toolDescriptors.map((tool) => tool.name),
        resources: remote.resources.map((resource) => resource.name),
        prompts: remote.prompts.map((prompt) => prompt.name),
        toolDescriptors,
        message: `已发现 ${toolDescriptors.length} 个工具、${remote.resources.length} 个资源、${remote.prompts.length} 个提示词`,
        checkedAt: now(),
      };
      writeSnapshot({ ...snapshot, discovery: { ...snapshot.discovery, [profile.id]: result } });
      return applySessionPermissions({ ...snapshot, discovery: { ...snapshot.discovery, [profile.id]: result } }).discovery[profile.id];
    } catch (error) {
      const result: McpDiscoveryResult = {
        serverId: profile.id, status: "error", tools: [], resources: [], prompts: [],
        message: error instanceof Error ? error.message : "MCP 连接测试失败", checkedAt: now(),
      };
      writeSnapshot({ ...snapshot, discovery: { ...snapshot.discovery, [profile.id]: result } });
      return result;
    }
  },

  async callTool(profile: McpServerProfile, tool: string, args: Record<string, unknown>, context: McpExecutionContext): Promise<unknown> {
    return executeTool(profile.id, tool, args, context);
  },

  /** 无人值守任务与交互调用共享同一个执行边界和 permission core。 */
  async callScheduledTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return executeTool(serverId, toolName, args, { mode: "scheduled", confirmed: false });
  },

  setToolPermission(serverId: string, toolName: string, permission: McpToolPermission): void {
    const snapshot = readPersistedSnapshot();
    const discovery = snapshot.discovery[serverId];
    if (!discovery?.toolDescriptors) return;
    if (!discovery.toolDescriptors.some((tool) => tool.name === toolName)) return;
    if (permission === "allow_session") grantMcpSessionPermission(serverId, toolName);
    else revokeMcpSessionPermission(serverId, toolName);
    const persistedPermission = permission === "allow_session" ? "ask" : normalizeMcpPersistedPermission(permission);
    const next = { ...discovery, toolDescriptors: discovery.toolDescriptors.map((tool) => tool.name === toolName ? { ...tool, permission: persistedPermission } : tool) };
    writeSnapshot({ ...snapshot, discovery: { ...snapshot.discovery, [serverId]: next } });
  },
};
