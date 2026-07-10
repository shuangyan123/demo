import type { McpDiscoveryResult, McpServerProfile } from "../types/review.ts";

const STORAGE_KEY = "review-workspace:mcp-settings:v1";

export type McpSettingsSnapshot = {
  profiles: McpServerProfile[];
  discovery: Record<string, McpDiscoveryResult>;
};

function now(): string {
  return new Date().toISOString();
}

function defaultSnapshot(): McpSettingsSnapshot {
  return { profiles: [], discovery: {} };
}

function readSnapshot(): McpSettingsSnapshot {
  if (typeof window === "undefined") return defaultSnapshot();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultSnapshot();
  try {
    const parsed = JSON.parse(raw) as McpSettingsSnapshot;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      discovery: parsed.discovery && typeof parsed.discovery === "object" ? parsed.discovery : {},
    };
  } catch {
    return defaultSnapshot();
  }
}

function writeSnapshot(snapshot: McpSettingsSnapshot): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function safeEndpoint(value: string): string {
  return value.trim().replace(/[?#].*$/, "");
}

export const mcpSettingsRepository = {
  load(): McpSettingsSnapshot {
    return readSnapshot();
  },

  saveProfile(input: { id?: string; label: string; endpoint: string; enabled: boolean }): McpServerProfile {
    const snapshot = readSnapshot();
    const timestamp = now();
    const existing = input.id ? snapshot.profiles.find((profile) => profile.id === input.id) : undefined;
    const profile: McpServerProfile = {
      id: existing?.id ?? crypto.randomUUID(),
      label: input.label.trim() || "MCP Server",
      endpoint: safeEndpoint(input.endpoint),
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    writeSnapshot({
      ...snapshot,
      profiles: [profile, ...snapshot.profiles.filter((item) => item.id !== profile.id)],
    });
    return profile;
  },

  removeProfile(id: string): void {
    const snapshot = readSnapshot();
    const discovery = { ...snapshot.discovery };
    delete discovery[id];
    writeSnapshot({
      profiles: snapshot.profiles.filter((profile) => profile.id !== id),
      discovery,
    });
  },

  testProfile(profile: McpServerProfile): McpDiscoveryResult {
    const snapshot = readSnapshot();
    const result: McpDiscoveryResult = profile.endpoint
      ? {
          serverId: profile.id,
          status: "ready",
          tools: ["list_tools"],
          resources: ["list_resources"],
          prompts: ["list_prompts"],
          message: "已完成本地配置探测；真实 MCP 握手将在连接器接入后执行。",
          checkedAt: now(),
        }
      : {
          serverId: profile.id,
          status: "error",
          tools: [],
          resources: [],
          prompts: [],
          message: "请先填写 MCP endpoint。",
          checkedAt: now(),
        };
    writeSnapshot({ ...snapshot, discovery: { ...snapshot.discovery, [profile.id]: result } });
    return result;
  },
};
