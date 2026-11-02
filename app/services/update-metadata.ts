import type { MockUpdateMetadata, UpdateCheckResult } from "../types/domains/update-check.ts";

export const UPDATE_METADATA_MAX_BYTES = 8192;
const fields = ["schemaVersion", "product", "channel", "platform", "arch", "installer", "version", "minimumCurrentVersion", "releaseNotes"];

/** 首个切片只接受规范稳定版 x.y.z；预发布、build metadata、前导零均不能被猜测为稳定版。 */
function version(value: unknown): number[] | undefined {
  if (typeof value !== "string" || value.length > 32 || value.trim() !== value || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function assessMockUpdate(source: string, currentVersion: string): UpdateCheckResult {
  if (new TextEncoder().encode(source).byteLength > UPDATE_METADATA_MAX_BYTES) return { kind: "invalid" };
  let value: unknown;
  try { value = JSON.parse(source); } catch { return { kind: "invalid" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "invalid" };
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== fields.length || !fields.every(key => Object.hasOwn(data, key))
    || data.schemaVersion !== 1 || data.product !== "recall" || data.channel !== "local-mock"
    || ![data.platform, data.arch, data.installer].every(item => typeof item === "string")
    || typeof data.releaseNotes !== "string" || data.releaseNotes.trim().length === 0 || data.releaseNotes.length > 2000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.releaseNotes)) return { kind: "invalid" };
  // 扁平公告字段必须只出现一次，包括通过 Unicode escape 拼写的重复字段。
  const keys = [...source.matchAll(/"(?:\\.|[^"\\])*"/g)]
    .filter(match => source.slice(match.index + match[0].length).trimStart().startsWith(":"))
    .map(match => JSON.parse(match[0]) as string);
  if (keys.length !== fields.length || new Set(keys).size !== fields.length) return { kind: "invalid" };
  const next = version(data.version), minimum = version(data.minimumCurrentVersion), current = version(currentVersion);
  if (!next || !minimum || compare(minimum, next) > 0) return { kind: "invalid" };
  if (!current || data.platform !== "win32" || data.arch !== "x64" || data.installer !== "nsis"
    || next[0] !== current[0] || compare(current, minimum) < 0) return { kind: "incompatible" };
  const relation = compare(next, current);
  return { kind: relation > 0 ? "available" : relation < 0 ? "ahead" : "current", metadata: data as MockUpdateMetadata };
}
