import type { CredentialProtectionStatus, HostKind, HostRuntime } from "./capabilities.ts";
import { resolveHost } from "./host.ts";

export type CredentialProtectionBackend = "web_crypto" | "desktop_host";

export type CredentialProtectionInspection = {
  backend: CredentialProtectionBackend;
  status: CredentialProtectionStatus["status"];
};

/**
 * Backend 选择只依赖宿主事实和 capability 是否存在，不猜测 user agent 或尝试任意 IPC。
 * Web 模式继续使用现有 WebCrypto；Desktop 缺少安全 capability 时保持显式不可用。
 */
export function selectCredentialProtectionBackend(input: {
  hostKind: HostKind;
  hasDesktopCredentialProtection: boolean;
}): CredentialProtectionBackend | "desktop_host_unavailable" {
  if (input.hostKind !== "desktop") return "web_crypto";
  return input.hasDesktopCredentialProtection ? "desktop_host" : "desktop_host_unavailable";
}

export async function inspectCredentialProtection(target?: Window): Promise<CredentialProtectionInspection> {
  const runtime: HostRuntime = resolveHost(target);
  if (runtime.kind !== "desktop") return { backend: "web_crypto", status: "available" };
  const capability = runtime.capabilities.credentialProtection;
  if (!capability) return { backend: "desktop_host", status: "unsupported" };
  const status = await capability.getStatus();
  return { backend: "desktop_host", status: status.status };
}
