import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const BULK_AUDIT_URL = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const AUDIT_RETRY_DELAYS_MS = [0, 500, 1_000];
const NPM_AUDIT_TIMEOUT_MS = 30_000;

/** 从 lockfile v3 中提取实际生产依赖版本，开发依赖不会进入审计载荷。 */
export function collectProductionVersions(lockfile) {
  const versions = new Map();
  for (const [packagePath, metadata] of Object.entries(lockfile?.packages ?? {})) {
    if (!packagePath || metadata?.dev === true || metadata?.link === true || typeof metadata?.version !== "string") continue;
    const packageName = metadata.name ?? packagePath.split("node_modules/").at(-1);
    if (!packageName || packageName.includes("node_modules/")) continue;
    const packageVersions = versions.get(packageName) ?? new Set();
    packageVersions.add(metadata.version);
    versions.set(packageName, packageVersions);
  }
  return Object.fromEntries(
    [...versions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => [name, [...values].sort()]),
  );
}

/** npm audit 的有效报告与端点错误必须分开，避免把基础设施错误误当成“零漏洞”。 */
export function parseNpmAuditOutput(source) {
  try {
    const report = JSON.parse(source);
    const counts = report?.metadata?.vulnerabilities;
    if (counts && typeof counts === "object") {
      return {
        kind: "report",
        counts: {
          low: Number(counts.low ?? 0),
          moderate: Number(counts.moderate ?? 0),
          high: Number(counts.high ?? 0),
          critical: Number(counts.critical ?? 0),
          total: Number(counts.total ?? 0),
        },
      };
    }
    return { kind: "infrastructure_error", message: String(report?.message ?? report?.error?.summary ?? "npm audit 未返回有效报告") };
  } catch {
    return { kind: "infrastructure_error", message: "npm audit 返回了无法解析的报告" };
  }
}

/** Bulk API 已按请求中的具体版本筛选，门禁只阻止 high 与 critical。 */
export function summarizeBulkAdvisories(report) {
  const advisories = [];
  for (const [packageName, packageAdvisories] of Object.entries(report ?? {})) {
    if (!Array.isArray(packageAdvisories)) continue;
    for (const advisory of packageAdvisories) {
      advisories.push({
        packageName,
        id: String(advisory.id ?? "unknown"),
        severity: String(advisory.severity ?? "unknown").toLowerCase(),
        title: String(advisory.title ?? "未命名安全公告").slice(0, 160),
        url: typeof advisory.url === "string" ? advisory.url : undefined,
      });
    }
  }
  return {
    advisories,
    blocking: advisories.filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity)),
  };
}

/** 兼容错误携带 gzip 正文但遗漏 Content-Encoding 的注册表响应。 */
export function decodeAuditResponse(bytes) {
  const buffer = Buffer.from(bytes);
  const decoded = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  return JSON.parse(decoded.toString("utf8"));
}

function runNpmAudit() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmCli
    ? [npmCli, "audit", "--omit=dev", "--audit-level=high", "--json"]
    : ["audit", "--omit=dev", "--audit-level=high", "--json"];
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: NPM_AUDIT_TIMEOUT_MS,
  });
}

function printAuditSummary(source, counts) {
  process.stdout.write(`${JSON.stringify({ source, vulnerabilities: counts }, null, 2)}\n`);
}

function sanitizeInfrastructureMessage(message) {
  return message.replace(/\s+/g, " ").slice(0, 240);
}

async function wait(delayMs) {
  if (!delayMs) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function requestBulkAudit(payload, fetchImpl = fetch) {
  let lastError;
  for (const delayMs of AUDIT_RETRY_DELAYS_MS) {
    await wait(delayMs);
    try {
      const response = await fetchImpl(BULK_AUDIT_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "content-type": "application/json",
          "user-agent": "le-production-audit/0.2.0",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Bulk Advisory API 返回 HTTP ${response.status}`);
      return decodeAuditResponse(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Bulk Advisory API 不可用");
}

export async function runProductionAudit({
  lockfilePath = new URL("../package-lock.json", import.meta.url),
  fetchImpl = fetch,
  npmAuditResult = runNpmAudit(),
} = {}) {
  const npmResult = parseNpmAuditOutput(npmAuditResult.stdout ?? "");
  if (npmResult.kind === "report") {
    printAuditSummary("npm-audit", npmResult.counts);
    return npmResult.counts.high + npmResult.counts.critical === 0 ? 0 : 1;
  }

  process.stderr.write(`npm audit 基础设施异常，改用官方 Bulk Advisory API：${sanitizeInfrastructureMessage(npmResult.message)}\n`);
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
  const payload = collectProductionVersions(lockfile);
  if (!Object.keys(payload).length) throw new Error("package-lock.json 中没有可审计的生产依赖");

  const bulkReport = await requestBulkAudit(payload, fetchImpl);
  const summary = summarizeBulkAdvisories(bulkReport);
  const counts = summary.advisories.reduce(
    (result, advisory) => {
      if (advisory.severity in result) result[advisory.severity] += 1;
      result.total += 1;
      return result;
    },
    { low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  );
  printAuditSummary("npm-bulk-advisory", counts);
  if (summary.blocking.length) {
    for (const advisory of summary.blocking) {
      process.stderr.write(`[${advisory.severity}] ${advisory.packageName}: ${advisory.title}${advisory.url ? ` (${advisory.url})` : ""}\n`);
    }
    return 1;
  }
  return 0;
}

async function main() {
  try {
    process.exitCode = await runProductionAudit();
  } catch (error) {
    process.stderr.write(`生产依赖审计无法完成：${sanitizeInfrastructureMessage(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
