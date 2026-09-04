import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  collectProductionVersions,
  classifyNpmAuditProcessResult,
  decodeAuditResponse,
  AUDIT_RETRY_DELAYS_MS,
  BULK_AUDIT_TIMEOUT_MS,
  NPM_AUDIT_TIMEOUT_MS,
  parseNpmAuditOutput,
  runProductionAudit,
  summarizeBulkAdvisories,
} from "./audit-production.mjs";

function npmAuditReport(counts = {}) {
  return JSON.stringify({
    metadata: {
      vulnerabilities: {
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
        ...counts,
      },
    },
  });
}

test("生产审计使用有界的 npm 与 Bulk 超时和重试策略", () => {
  assert.equal(NPM_AUDIT_TIMEOUT_MS, 90_000);
  assert.equal(BULK_AUDIT_TIMEOUT_MS, 30_000);
  assert.deepEqual(AUDIT_RETRY_DELAYS_MS, [0, 1_000, 3_000]);
});

test("npm audit 超时被分类为可回退的基础设施错误", () => {
  const error = new Error("spawnSync timed out");
  error.code = "ETIMEDOUT";
  const result = classifyNpmAuditProcessResult({ error, stdout: "partial output" }, NPM_AUDIT_TIMEOUT_MS);

  assert.equal(result.kind, "infrastructure_error");
  assert.equal(result.reason, "timeout");
  assert.equal(result.fallbackEligible, true);
  assert.match(result.message, /npm audit timed out after 90000ms/);
});

test("npm audit 子进程执行失败被分类为可回退的基础设施错误", () => {
  const error = new Error("spawn failed");
  error.code = "ENOENT";
  const result = classifyNpmAuditProcessResult({ error, stdout: "" });

  assert.equal(result.kind, "infrastructure_error");
  assert.equal(result.reason, "execution_failure");
  assert.equal(result.fallbackEligible, true);
  assert.match(result.message, /ENOENT/);
});

test("有效 npm audit 报告即使 status 为 1 仍按报告评估", () => {
  const result = classifyNpmAuditProcessResult({ status: 1, stdout: npmAuditReport({ high: 1, total: 1 }) });

  assert.equal(result.kind, "report");
  assert.equal(result.fallbackEligible, false);
  assert.deepEqual(result.counts, { low: 0, moderate: 0, high: 1, critical: 0, total: 1 });
});

test("生产审计只收集 lockfile 中的生产依赖并保留嵌套版本", () => {
  const versions = collectProductionVersions({
    packages: {
      "": { name: "app", version: "1.0.0" },
      "node_modules/runtime": { version: "2.0.0" },
      "node_modules/runtime/node_modules/nested": { version: "1.0.0" },
      "node_modules/other/node_modules/nested": { version: "2.0.0" },
      "node_modules/dev-only": { version: "3.0.0", dev: true },
      "node_modules/link": { version: "1.0.0", link: true },
    },
  });
  assert.deepEqual(versions, {
    nested: ["1.0.0", "2.0.0"],
    runtime: ["2.0.0"],
  });
});

test("npm audit 必须完整提供五个安全计数字段", () => {
  assert.equal(parseNpmAuditOutput(JSON.stringify({
    metadata: { vulnerabilities: { total: 0 } },
  })).kind, "infrastructure_error");
  assert.equal(parseNpmAuditOutput(JSON.stringify({
    metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
  })).kind, "infrastructure_error");
  assert.deepEqual(parseNpmAuditOutput(JSON.stringify({
    metadata: { vulnerabilities: {
      low: 0,
      moderate: 2,
      high: 0,
      critical: 0,
      total: 2,
      info: 4,
    } },
  })), {
    kind: "report",
    counts: { low: 0, moderate: 2, high: 0, critical: 0, total: 2 },
  });
  assert.equal(parseNpmAuditOutput(JSON.stringify({ message: "Invalid package tree" })).kind, "infrastructure_error");
  assert.equal(parseNpmAuditOutput(JSON.stringify({ metadata: { vulnerabilities: {} } })).kind, "infrastructure_error");
  assert.equal(parseNpmAuditOutput(JSON.stringify({ metadata: { vulnerabilities: { high: "0" } } })).kind, "infrastructure_error");
  assert.equal(parseNpmAuditOutput("not-json").kind, "infrastructure_error");
});

test("Bulk Advisory 报告只把 high 与 critical 设为阻断", () => {
  const summary = summarizeBulkAdvisories({
    alpha: [{ id: 1, severity: "moderate", title: "moderate issue" }],
    beta: [{ id: 2, severity: "high", title: "high issue", url: "https://example.test/GHSA" }],
    gamma: [{ id: 3, severity: "critical", title: "critical issue" }],
  });
  assert.equal(summary.advisories.length, 3);
  assert.deepEqual(summary.blocking.map((item) => item.packageName), ["beta", "gamma"]);
});

test("Bulk Advisory 响应兼容普通 JSON 与遗漏编码头的 gzip JSON", () => {
  const report = { package: [{ id: 1, severity: "moderate" }] };
  assert.deepEqual(decodeAuditResponse(Buffer.from(JSON.stringify(report))), report);
  assert.deepEqual(decodeAuditResponse(gzipSync(JSON.stringify(report))), report);
});

test("Bulk Advisory 结构异常不会被当成零漏洞", () => {
  assert.throws(() => summarizeBulkAdvisories([]), /无法解析的报告/);
  assert.throws(() => summarizeBulkAdvisories({ package: [{ severity: "unknown" }] }), /无法解析的报告/);
});

test("有效 npm audit 报告按 high、critical 阻断，moderate-only 继续通过", async () => {
  const highExitCode = await runProductionAudit({
    npmAuditResult: { status: 1, stdout: npmAuditReport({ high: 1, total: 1 }) },
    waitImpl: async () => {},
  });
  const criticalExitCode = await runProductionAudit({
    npmAuditResult: { status: 1, stdout: npmAuditReport({ critical: 1, total: 1 }) },
    waitImpl: async () => {},
  });
  const moderateExitCode = await runProductionAudit({
    npmAuditResult: { status: 1, stdout: npmAuditReport({ moderate: 1, total: 1 }) },
    waitImpl: async () => {},
  });

  assert.equal(highExitCode, 1);
  assert.equal(criticalExitCode, 1);
  assert.equal(moderateExitCode, 0);
});

test("npm audit 基础设施异常时 Bulk API 仍保持失败关闭", async () => {
  const npmAuditResult = { stdout: JSON.stringify({ message: "endpoint failed" }) };
  const emptyLockfile = new URL("./fixtures/empty-package-lock.json", import.meta.url);
  await assert.rejects(
    runProductionAudit({ npmAuditResult, lockfilePath: emptyLockfile, fetchImpl: async () => new Response("{}") }),
    /没有可审计的生产依赖|ENOENT/,
  );
});

test("Bulk API 的 moderate 可通过而 high 必须阻断", async () => {
  const npmAuditResult = { stdout: JSON.stringify({ message: "endpoint failed" }) };
  const lockfilePath = new URL("./fixtures/production-package-lock.json", import.meta.url);
  const moderateExitCode = await runProductionAudit({
    npmAuditResult,
    lockfilePath,
    fetchImpl: async () => new Response(JSON.stringify({
      runtime: [{ id: 1, severity: "moderate", title: "moderate issue" }],
    })),
  });
  const highExitCode = await runProductionAudit({
    npmAuditResult,
    lockfilePath,
    fetchImpl: async () => new Response(JSON.stringify({
      runtime: [{ id: 2, severity: "high", title: "high issue" }],
    })),
  });
  assert.equal(moderateExitCode, 0);
  assert.equal(highExitCode, 1);
});

test("有效 npm audit 报告不会触发 Bulk API 回退", async () => {
  let fallbackCalled = false;
  const exitCode = await runProductionAudit({
    npmAuditResult: {
      status: 1,
      stdout: npmAuditReport({ moderate: 1, total: 1 }),
    },
    fetchImpl: async () => {
      fallbackCalled = true;
      return new Response("{}");
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(fallbackCalled, false);
});

test("npm audit 超时且 Bulk API 不可用时保持失败关闭", async () => {
  const error = new Error("spawnSync timed out");
  error.code = "ETIMEDOUT";
  const npmAuditResult = { error, stdout: "partial output" };
  const lockfilePath = new URL("./fixtures/production-package-lock.json", import.meta.url);
  let fallbackAttempts = 0;
  await assert.rejects(
    runProductionAudit({
      npmAuditResult,
      lockfilePath,
      fetchImpl: async () => {
        fallbackAttempts += 1;
        throw new Error("network unavailable");
      },
      waitImpl: async () => {},
    }),
    /network unavailable/,
  );
  assert.equal(fallbackAttempts, 3);
});
