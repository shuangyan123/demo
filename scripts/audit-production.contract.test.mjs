import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  collectProductionVersions,
  decodeAuditResponse,
  parseNpmAuditOutput,
  runProductionAudit,
  summarizeBulkAdvisories,
} from "./audit-production.mjs";

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

test("npm audit 只有带漏洞计数的 JSON 才算有效报告", () => {
  assert.deepEqual(parseNpmAuditOutput(JSON.stringify({
    metadata: { vulnerabilities: { moderate: 2, high: 0, critical: 0, total: 2 } },
  })), {
    kind: "report",
    counts: { low: 0, moderate: 2, high: 0, critical: 0, total: 2 },
  });
  assert.equal(parseNpmAuditOutput(JSON.stringify({ message: "Invalid package tree" })).kind, "infrastructure_error");
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
      stdout: JSON.stringify({
        metadata: { vulnerabilities: { moderate: 1, high: 0, critical: 0, total: 1 } },
      }),
    },
    fetchImpl: async () => {
      fallbackCalled = true;
      return new Response("{}");
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(fallbackCalled, false);
});

test("npm audit 与 Bulk API 都不可用时保持失败关闭", async () => {
  const npmAuditResult = { stdout: JSON.stringify({ message: "endpoint failed" }) };
  const lockfilePath = new URL("./fixtures/production-package-lock.json", import.meta.url);
  await assert.rejects(
    runProductionAudit({
      npmAuditResult,
      lockfilePath,
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    }),
    /network unavailable/,
  );
});
