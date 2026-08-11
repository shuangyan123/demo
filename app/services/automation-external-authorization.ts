import type {
  AutomationDefinition,
  AutomationExternalExecutionSummary,
  AutomationExternalSourceKind,
  AutomationRunTrigger,
  UnattendedAuthorizationReasonCode,
  UnattendedExecutionAuditSummary,
} from "../types/domains/automation.ts";
import type { AcquisitionSourceConfig } from "../types/domains/acquisition.ts";
import { normalizeMcpPersistedPermission } from "./mcp-permission.ts";
import { AutomationAuthorizationError } from "./automation-errors.ts";

export { AutomationAuthorizationError } from "./automation-errors.ts";

export type ExternalCapabilityRequirement =
  | { kind: "mcp_tool"; sourceId: string; serverId: string; toolName: string }
  | { kind: "http_origin"; sourceId: string; sourceKind: "url" | "feed" | "mcp_search"; origin: string };

export type McpAuthorizationResource = {
  serverId: string;
  enabled: boolean;
  discoveryStatus?: string;
  tools: Array<{ name: string; permission: unknown }>;
};

export type AutomationExternalAuthorizationResult = {
  status: "ready" | "blocked" | "invalid";
  requirements: ExternalCapabilityRequirement[];
  missingPermissions: string[];
  disabledResources: string[];
  staleResources: string[];
  invalidScopes: string[];
  reasonCodes: UnattendedAuthorizationReasonCode[];
};

type McpSnapshotLike = {
  profiles: ReadonlyArray<{ id: string; enabled: boolean }>;
  discovery: Record<string, {
    status?: string;
    toolDescriptors?: ReadonlyArray<{ name: string; permission: unknown }>;
  }>;
};

const REASON_ORDER: UnattendedAuthorizationReasonCode[] = [
  "mcp_permission_missing",
  "mcp_server_disabled",
  "mcp_discovery_not_ready",
  "mcp_tool_missing",
  "origin_not_allowed",
  "source_invalid",
  "authorization_ready",
  "runtime_failed",
  "completed",
];

function unique<T>(items: readonly T[], key: (item: T) => string = (item) => String(item)): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemKey = key(item);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

function reasonCodes(items: readonly UnattendedAuthorizationReasonCode[]): UnattendedAuthorizationReasonCode[] {
  const present = new Set(items);
  return REASON_ORDER.filter((item) => present.has(item));
}

function normalizeOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function urlOrigin(value: unknown): string | undefined {
  return normalizeOrigin(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidMcpArgumentTemplate(value: unknown): boolean {
  if (typeof value !== "string" || !value.includes("{{query}}")) return false;
  try {
    const parsed = JSON.parse(value.trim() || "{}");
    return isRecord(parsed);
  } catch {
    return false;
  }
}

function effectiveOrigins(config: NonNullable<AutomationDefinition["collectionConfig"]>, source: AcquisitionSourceConfig): string[] {
  const global = new Set(config.allowedOrigins.map(normalizeOrigin).filter((item): item is string => Boolean(item)));
  const declared = source.allowedOrigins.map(normalizeOrigin).filter((item): item is string => Boolean(item));
  const candidates = declared.length ? declared : [...global];
  return unique(candidates.filter((origin) => global.has(origin)));
}

function addRequirement(requirements: ExternalCapabilityRequirement[], requirement: ExternalCapabilityRequirement): void {
  requirements.push(requirement);
}

function addSourceScopeIssue(
  invalidScopes: string[],
  reasons: UnattendedAuthorizationReasonCode[],
  sourceId: string,
  reason: UnattendedAuthorizationReasonCode,
): void {
  invalidScopes.push(sourceId);
  reasons.push(reason);
}

function evaluateCollectionConfig(config: NonNullable<AutomationDefinition["collectionConfig"]>): {
  requirements: ExternalCapabilityRequirement[];
  invalidScopes: string[];
  reasons: UnattendedAuthorizationReasonCode[];
} {
  const requirements: ExternalCapabilityRequirement[] = [];
  const invalidScopes: string[] = [];
  const reasons: UnattendedAuthorizationReasonCode[] = [];
  if (!Array.isArray(config.allowedOrigins) || !Array.isArray(config.sources) || !Array.isArray(config.queries) || !config.queries.every((query) => typeof query === "string")) {
    return { requirements, invalidScopes: ["collectionConfig"], reasons: ["source_invalid"] };
  }

  for (const source of config.sources) {
    if (!isRecord(source)) {
      addSourceScopeIssue(invalidScopes, reasons, "source", "source_invalid");
      continue;
    }
    if (source.enabled !== true) continue;
    const sourceId = typeof source.id === "string" && source.id.trim() ? source.id : "source";
    if (!Array.isArray(source.allowedOrigins) || !["url", "feed", "mcp_search"].includes(source.kind as string)) {
      addSourceScopeIssue(invalidScopes, reasons, sourceId, "source_invalid");
      continue;
    }
    const typedSource = source as unknown as AcquisitionSourceConfig;
    const origins = effectiveOrigins(config, typedSource);
    if (!origins.length) {
      addSourceScopeIssue(invalidScopes, reasons, sourceId, "origin_not_allowed");
      continue;
    }

    if (typedSource.kind === "url") {
      const urls = Array.isArray(typedSource.urls) ? typedSource.urls.filter((url): url is string => typeof url === "string" && Boolean(url.trim())) : [];
      if (!urls.length) {
        addSourceScopeIssue(invalidScopes, reasons, sourceId, "source_invalid");
        continue;
      }
      const eligibleOrigins = urls.map(urlOrigin).filter((origin): origin is string => typeof origin === "string" && origins.includes(origin));
      // 保持现有“过滤不在白名单中的候选 URL”语义；只有整条来源没有可执行候选时才阻断。
      if (!eligibleOrigins.length) {
        addSourceScopeIssue(invalidScopes, reasons, sourceId, "origin_not_allowed");
        continue;
      }
      for (const origin of eligibleOrigins) addRequirement(requirements, { kind: "http_origin", sourceId, sourceKind: "url", origin });
      continue;
    }

    if (typedSource.kind === "feed") {
      const origin = urlOrigin(typedSource.url);
      if (!origin) {
        addSourceScopeIssue(invalidScopes, reasons, sourceId, "source_invalid");
      } else if (!origins.includes(origin)) {
        addSourceScopeIssue(invalidScopes, reasons, sourceId, "origin_not_allowed");
      } else {
        addRequirement(requirements, { kind: "http_origin", sourceId, sourceKind: "feed", origin });
      }
      continue;
    }

    if (typedSource.kind === "mcp_search") {
      if (typeof typedSource.serverId !== "string" || typeof typedSource.toolName !== "string" || !typedSource.serverId.trim() || !typedSource.toolName.trim() || !isValidMcpArgumentTemplate(typedSource.argumentTemplate)) {
        addSourceScopeIssue(invalidScopes, reasons, sourceId, "source_invalid");
        continue;
      }
      addRequirement(requirements, { kind: "mcp_tool", sourceId, serverId: typedSource.serverId, toolName: typedSource.toolName });
      for (const origin of origins) addRequirement(requirements, { kind: "http_origin", sourceId, sourceKind: "mcp_search", origin });
    }
  }
  return { requirements: unique(requirements, (item) => item.kind === "mcp_tool" ? `${item.kind}:${item.serverId}:${item.toolName}` : `${item.kind}:${item.sourceId}:${item.origin}`), invalidScopes, reasons };
}

function checkMcpRequirements(
  requirements: readonly ExternalCapabilityRequirement[],
  resources: readonly McpAuthorizationResource[],
  reasons: UnattendedAuthorizationReasonCode[],
): { missingPermissions: string[]; disabledResources: string[]; staleResources: string[] } {
  const missingPermissions: string[] = [];
  const disabledResources: string[] = [];
  const staleResources: string[] = [];
  for (const requirement of requirements) {
    if (requirement.kind !== "mcp_tool") continue;
    const resource = resources.find((item) => item.serverId === requirement.serverId);
    if (!resource) {
      staleResources.push(requirement.serverId);
      reasons.push("mcp_discovery_not_ready");
      continue;
    }
    if (!resource.enabled) {
      disabledResources.push(resource.serverId);
      reasons.push("mcp_server_disabled");
      continue;
    }
    if (resource.discoveryStatus !== "ready") {
      staleResources.push(resource.serverId);
      reasons.push("mcp_discovery_not_ready");
      continue;
    }
    const tool = resource.tools.find((item) => item.name === requirement.toolName);
    if (!tool) {
      staleResources.push(`${requirement.serverId}:${requirement.toolName}`);
      reasons.push("mcp_tool_missing");
      continue;
    }
    if (normalizeMcpPersistedPermission(tool.permission) !== "allow_scheduled") {
      missingPermissions.push(`${requirement.serverId}:${requirement.toolName}`);
      reasons.push("mcp_permission_missing");
    }
  }
  return {
    missingPermissions: unique(missingPermissions),
    disabledResources: unique(disabledResources),
    staleResources: unique(staleResources),
  };
}

/** 把 Settings Repository 快照降为不含 session grant 语义的授权资源。 */
export function collectMcpAuthorizationResources(snapshot: McpSnapshotLike): McpAuthorizationResource[] {
  return snapshot.profiles.map((profile) => ({
    serverId: profile.id,
    enabled: profile.enabled,
    discoveryStatus: snapshot.discovery[profile.id]?.status,
    tools: (snapshot.discovery[profile.id]?.toolDescriptors ?? []).map((tool) => ({ name: tool.name, permission: tool.permission })),
  }));
}

/** 纯、确定性的任务级外部授权解析；不读取存储、凭据、网络或 React 状态。 */
export function resolveAutomationExternalAuthorization(
  definition: AutomationDefinition,
  input: { mcpResources?: readonly McpAuthorizationResource[] } = {},
): AutomationExternalAuthorizationResult {
  const reasons: UnattendedAuthorizationReasonCode[] = [];
  const requirements = definition.collectionConfig ? evaluateCollectionConfig(definition.collectionConfig) : { requirements: [], invalidScopes: [], reasons: [] };
  const mcp = checkMcpRequirements(requirements.requirements, input.mcpResources ?? [], reasons);
  const invalidScopes = unique(requirements.invalidScopes);
  reasons.push(...requirements.reasons);
  const status = invalidScopes.length
    ? "invalid"
    : mcp.missingPermissions.length || mcp.disabledResources.length || mcp.staleResources.length
      ? "blocked"
      : "ready";
  if (status === "ready") reasons.push("authorization_ready");
  return {
    status,
    requirements: requirements.requirements,
    missingPermissions: mcp.missingPermissions,
    disabledResources: mcp.disabledResources,
    staleResources: mcp.staleResources,
    invalidScopes,
    reasonCodes: reasonCodes(reasons),
  };
}

export function assertAutomationExternalAuthorization(authorization: AutomationExternalAuthorizationResult): void {
  if (authorization.status !== "ready") throw new AutomationAuthorizationError(authorization);
}

function sourceKindForRequirement(requirement: ExternalCapabilityRequirement): AutomationExternalSourceKind {
  return requirement.kind === "mcp_tool" ? "mcp_search" : requirement.sourceKind;
}

function mergeUniqueMcpTools(items: Array<{ serverId: string; toolName: string }>): Array<{ serverId: string; toolName: string }> {
  return unique(items, (item) => `${item.serverId}:${item.toolName}`);
}

/** 从授权结果和运行计数构造可持久化的最小审计摘要。 */
export function createUnattendedExecutionAuditSummary(input: {
  taskId: string;
  runId: string;
  mode: AutomationRunTrigger;
  startedAt: string;
  finishedAt?: string;
  authorization: AutomationExternalAuthorizationResult;
  execution?: AutomationExternalExecutionSummary;
  proposalCount: number;
  terminalState: UnattendedExecutionAuditSummary["terminalState"];
}): UnattendedExecutionAuditSummary {
  const requirements = input.authorization.requirements;
  const mcpTools = mergeUniqueMcpTools([
    ...requirements.filter((item): item is Extract<ExternalCapabilityRequirement, { kind: "mcp_tool" }> => item.kind === "mcp_tool").map((item) => ({ serverId: item.serverId, toolName: item.toolName })),
    ...(input.execution?.mcpTools ?? []),
  ]);
  const httpOrigins = unique([
    ...requirements.filter((item): item is Extract<ExternalCapabilityRequirement, { kind: "http_origin" }> => item.kind === "http_origin").map((item) => item.origin),
    ...(input.execution?.httpOrigins ?? []),
  ]);
  const sourceKinds = unique([
    ...requirements.map(sourceKindForRequirement),
    ...(input.execution?.sourceKinds ?? []),
  ]) as AutomationExternalSourceKind[];
  const failedCallCount = input.execution?.failedCallCount ?? 0;
  const reasons = [...input.authorization.reasonCodes];
  if (input.terminalState === "failed" || failedCallCount > 0) reasons.push("runtime_failed");
  if (input.terminalState === "succeeded") reasons.push("completed");
  return {
    taskId: input.taskId,
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    mode: input.mode,
    authorization: input.authorization.status,
    reasonCodes: reasonCodes(reasons),
    externalRequirementCount: requirements.length,
    sourceKinds,
    mcpTools,
    httpOrigins,
    externalCallCount: input.execution?.externalCallCount ?? 0,
    successfulCallCount: input.execution?.successfulCallCount ?? 0,
    failedCallCount,
    proposalCount: input.proposalCount,
    terminalState: input.terminalState,
  };
}
