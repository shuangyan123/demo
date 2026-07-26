import type { McpDiscoveryResult, McpServerProfile, McpToolDescriptor, McpToolPermission } from "../types/domains/mcp.ts";
import { decryptSecret, encryptSecret } from "./crypto-service.ts";
import type { ClientApiErrorPayload } from "./api-error.ts";
import { fetchLocalApi } from "./local-runtime-diagnostics.ts";

const STORAGE_KEY = "review-workspace:mcp-settings:v2";
const LEGACY_STORAGE_KEY = "review-workspace:mcp-settings:v1";

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

function normalizeProfile(profile: Partial<McpServerProfile>): McpServerProfile | undefined {
  if (!profile.id || !profile.endpoint) return undefined;
  const timestamp = now();
  return {
    id: profile.id,
    label: profile.label?.trim() || "MCP Server",
    endpoint: profile.endpoint.trim().replace(/[?#].*$/, ""),
    enabled: profile.enabled !== false,
    authMode: profile.authMode === "bearer" ? "bearer" : "none",
    encryptedToken: profile.encryptedToken,
    encryptedTokenIv: profile.encryptedTokenIv,
    createdAt: profile.createdAt ?? timestamp,
    updatedAt: profile.updatedAt ?? timestamp,
  };
}

function readSnapshot(): McpSettingsSnapshot {
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
      discovery: parsed.discovery && typeof parsed.discovery === "object" ? parsed.discovery : {},
    };
  } catch {
    return defaultSnapshot();
  }
}

function writeSnapshot(snapshot: McpSettingsSnapshot): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

async function tokenFor(profile: McpServerProfile): Promise<string> {
  if (profile.authMode !== "bearer" || !profile.encryptedToken || !profile.encryptedTokenIv) return "";
  return decryptSecret(profile.encryptedToken, profile.encryptedTokenIv);
}

async function requestJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetchLocalApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json() as T & ClientApiErrorPayload;
  if (!response.ok) throw new Error(result.message || result.error || "MCP 请求失败");
  return result;
}

export const mcpSettingsRepository = {
  load(): McpSettingsSnapshot {
    return readSnapshot();
  },

  async saveProfile(input: { id?: string; label: string; endpoint: string; enabled: boolean; authMode: "none" | "bearer"; token?: string }): Promise<McpServerProfile> {
    const snapshot = readSnapshot();
    const timestamp = now();
    const existing = input.id ? snapshot.profiles.find((profile) => profile.id === input.id) : undefined;
    const encrypted = input.authMode === "bearer" && input.token?.trim()
      ? await encryptSecret(input.token.trim())
      : existing?.encryptedToken && existing.encryptedTokenIv
        ? { encryptedKey: existing.encryptedToken, iv: existing.encryptedTokenIv }
        : undefined;
    const profile: McpServerProfile = {
      id: existing?.id ?? crypto.randomUUID(),
      label: input.label.trim() || "MCP Server",
      endpoint: input.endpoint.trim().replace(/[?#].*$/, ""),
      enabled: input.enabled,
      authMode: input.authMode,
      encryptedToken: input.authMode === "bearer" ? encrypted?.encryptedKey : undefined,
      encryptedTokenIv: input.authMode === "bearer" ? encrypted?.iv : undefined,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    writeSnapshot({ ...snapshot, profiles: [profile, ...snapshot.profiles.filter((item) => item.id !== profile.id)] });
    return profile;
  },

  removeProfile(id: string): void {
    const snapshot = readSnapshot();
    const discovery = { ...snapshot.discovery };
    delete discovery[id];
    writeSnapshot({ profiles: snapshot.profiles.filter((profile) => profile.id !== id), discovery });
  },

  async discover(profile: McpServerProfile): Promise<McpDiscoveryResult> {
    const snapshot = readSnapshot();
    try {
      const remote = await requestJson<{ tools: McpRemoteTool[]; resources: Array<{ name: string }>; prompts: Array<{ name: string }> }>("/api/mcp/discover", {
        endpoint: profile.endpoint,
        token: await tokenFor(profile),
      });
      const existingPermissions = new Map((snapshot.discovery[profile.id]?.toolDescriptors ?? []).map((tool) => [tool.name, tool.permission]));
      const toolDescriptors: McpToolDescriptor[] = remote.tools.map((tool) => ({
        ...tool,
        permission: existingPermissions.get(tool.name) ?? "ask",
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
      return result;
    } catch (error) {
      const result: McpDiscoveryResult = {
        serverId: profile.id, status: "error", tools: [], resources: [], prompts: [],
        message: error instanceof Error ? error.message : "MCP 连接测试失败", checkedAt: now(),
      };
      writeSnapshot({ ...snapshot, discovery: { ...snapshot.discovery, [profile.id]: result } });
      return result;
    }
  },

  async callTool(profile: McpServerProfile, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await requestJson<{ result: unknown }>("/api/mcp/call", {
      endpoint: profile.endpoint,
      token: await tokenFor(profile),
      tool,
      arguments: args,
    });
    return response.result;
  },

  /** 无人值守任务在调用前重新校验 Server、发现状态和持久化的定时权限。 */
  async callScheduledTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const snapshot = readSnapshot();
    const profile = snapshot.profiles.find((item) => item.id === serverId);
    if (!profile?.enabled) throw new Error("MCP Server 未启用，已阻止定时调用");
    const discovery = snapshot.discovery[serverId];
    if (discovery?.status !== "ready") throw new Error("MCP Server 尚未通过连接发现");
    const tool = discovery.toolDescriptors?.find((item) => item.name === toolName);
    if (!tool) throw new Error("MCP 工具不存在或已从 Server 移除");
    if (tool.permission !== "allow_scheduled") throw new Error("MCP 工具未获得定时任务授权");
    return this.callTool(profile, toolName, args);
  },

  setToolPermission(serverId: string, toolName: string, permission: McpToolPermission): void {
    const snapshot = readSnapshot();
    const discovery = snapshot.discovery[serverId];
    if (!discovery?.toolDescriptors) return;
    const next = { ...discovery, toolDescriptors: discovery.toolDescriptors.map((tool) => tool.name === toolName ? { ...tool, permission } : tool) };
    writeSnapshot({ ...snapshot, discovery: { ...snapshot.discovery, [serverId]: next } });
  },
};
