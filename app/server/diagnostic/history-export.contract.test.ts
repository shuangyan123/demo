import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { POST } from "../../api/diagnostic/export/route.ts";
import type { DiagnosticHistoryExportV1 } from "../../types/domains/diagnostic-history-export.ts";
import { exportDiagnosticHistory } from "./history-export.ts";
import { closeDiagnosticRuntime, composeDiagnosticRuntime } from "./runtime.ts";
import { createDiagnosticHistoryRepository } from "./history/repository-core.ts";
import { diagnosticHistoryIO } from "./history/io.ts";
import { encodeDiagnosticSnapshot } from "./history/record.ts";

let storage: ReturnType<typeof diagnosticStorageFixture>;
beforeEach(() => { closeDiagnosticRuntime(); storage = diagnosticStorageFixture(); });
afterEach(() => { closeDiagnosticRuntime(); storage.cleanup(); });

function files(directory = storage.root): unknown {
  return readdirSync(directory, { withFileTypes: true }).map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? [entry.name, files(file)]
      : [entry.name, statSync(file).mtimeMs, createHash("sha256").update(readFileSync(file)).digest("hex")];
  });
}
function request(url = "http://localhost/api/diagnostic/export", init: RequestInit = {}) {
  return new Request(url, { method: "POST", headers: {
    origin: "http://localhost", "sec-fetch-site": "same-origin", "x-recall-export-intent": "diagnostic-history",
  }, ...init });
}
async function seed() {
  const active = composeDiagnosticRuntime(storage.config);
  for (const selectedOptionId of ["five", "four"]) {
    const issued = active.issue();
    assert.equal(issued.kind, "issued");
    if (issued.kind !== "issued") throw Error("fixture_issue_failed");
    const captured = active.capture({ sessionId: issued.sessionId, selectedOptionId });
    assert.equal(captured.kind, "captured");
    if (captured.kind !== "captured") throw Error("fixture_capture_failed");
    assert.equal((await active.append(captured.attempt)).kind, "committed");
  }
  return active;
}

test("export without composed Host runtime creates no domain or bootstrap", () => {
  const before = files();
  assert.deepEqual(exportDiagnosticHistory(), { kind: "unavailable" });
  assert.deepEqual(files(), before);
});

test("complete export preserves facts, excludes Host identity, verifies digest and changes no files", async () => {
  const active = await seed();
  const disk = JSON.parse(readFileSync(storage.file, "utf8"));
  const before = files();
  const result = exportDiagnosticHistory();
  assert.equal(result.kind, "exported");
  if (result.kind !== "exported") throw Error("expected_export");
  const archive = JSON.parse(result.source) as DiagnosticHistoryExportV1;
  const { integrity, ...payload } = archive;
  assert.deepEqual(Object.keys(payload), ["format", "formatVersion", "exportedAt", "sourceOwnerId", "scope", "restoreSupport", "notice", "authority", "captureCount", "captures"]);
  assert.equal(archive.notice, "目前不可导入恢复");
  assert.deepEqual(archive.captures, disk.captures);
  assert.equal(archive.captureCount, 2);
  assert.equal(archive.restoreSupport, "not_implemented");
  assert.equal(archive.authority, "unverified_portable_copy");
  assert.equal(integrity.algorithm, "sha256");
  assert.equal(integrity.digest, createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
  for (const value of [storage.config.profileId, storage.config.epochId, storage.root]) assert.equal(result.source.includes(value), false);
  assert.doesNotMatch(result.source, /profileId|epochId|generation|managedRoot|bootstrap|apiKey|cookie|directoryHandle|vault|verifiedCorrectOptionId|learningTarget/);
  assert.deepEqual(files(), before);
  assert.deepEqual(active.readiness(), { kind: "ready" });
  for (const capture of archive.captures) assert.deepEqual(active.resolveAttempt(capture.id), capture);
});

test("only a verified initialized empty history may export zero records", () => {
  composeDiagnosticRuntime(storage.config);
  const before = files();
  const result = exportDiagnosticHistory();
  assert.equal(result.kind, "exported");
  if (result.kind === "exported") assert.equal(JSON.parse(result.source).captureCount, 0);
  assert.deepEqual(files(), before);
});

const invalidCases: Array<[string, (disk: Record<string, unknown>) => void]> = [
  ["unknown version", disk => { disk.formatVersion = 99; }],
  ["wrong profile", disk => { disk.profileId = "other-profile"; }],
  ["wrong epoch", disk => { disk.epochId = "other-epoch"; }],
  ["checksum mismatch", disk => { disk.integrity = "0".repeat(64); }],
  ["duplicate attempts", disk => { const captures = disk.captures as unknown[]; captures.push(captures[0]); disk.generation = captures.length; }],
  ["missing canonical spec", disk => { (disk.captures as Record<string, unknown>[])[0].specRevision = "missing"; }],
  ["changed option order", disk => { ((disk.captures as Record<string, unknown>[])[0].optionIds as string[]).reverse(); }],
  ["secret field injection", disk => { (disk.captures as Record<string, unknown>[])[0].cookie = "secret"; }],
];
for (const [name, mutate] of invalidCases) test(`${name} rejects the whole export without repair or index mutation`, async () => {
  const active = await seed();
  const disk = JSON.parse(readFileSync(storage.file, "utf8"));
  const first = active.resolveAttempt(disk.captures[0].id);
  mutate(disk);
  writeFileSync(storage.file, JSON.stringify(disk));
  const before = files();
  assert.deepEqual(exportDiagnosticHistory(), { kind: "invalid" });
  assert.deepEqual(files(), before);
  assert.deepEqual(active.readiness(), { kind: "ready" });
  assert.equal(active.resolveAttempt(first!.id), first);
});

test("missing record and malformed JSON remain unavailable rather than empty", async () => {
  await seed();
  writeFileSync(storage.file, "{broken");
  assert.deepEqual(exportDiagnosticHistory(), { kind: "invalid" });
  assert.equal(readFileSync(storage.file, "utf8"), "{broken");
  unlinkSync(storage.file);
  const before = files();
  assert.deepEqual(exportDiagnosticHistory(), { kind: "incomplete" });
  assert.deepEqual(files(), before);
});

test("repository read failure leaves readiness intact and never initializes or writes", () => {
  let failRead = false;
  const active = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
    ...diagnosticHistoryIO,
    read: (...args) => failRead ? { kind: "unavailable", code: "storage_unavailable", reason: "snapshot_read_failed" } : diagnosticHistoryIO.read(...args),
  }));
  failRead = true;
  const before = files();
  assert.deepEqual(exportDiagnosticHistory(), { kind: "unavailable" });
  assert.deepEqual(active.readiness(), { kind: "ready" });
  assert.deepEqual(files(), before);
});

test("HTTP export is a no-store attachment with only the portable projection", async () => {
  await seed();
  const before = files();
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition")!, /^attachment;/);
  assert.equal((await response.json()).format, "recall-diagnostic-history-export");
  assert.deepEqual(files(), before);
});

test("HTTP denies cross-site, opaque origin, missing intent, query paths and any body", async () => {
  await seed();
  const before = files();
  const cases: Array<[Request, number]> = [
    [request(undefined, { headers: { origin: "https://other.test", "sec-fetch-site": "cross-site", "x-recall-export-intent": "diagnostic-history" } }), 403],
    [request(undefined, { headers: { origin: "https://other.test", "sec-fetch-site": "same-origin", "x-recall-export-intent": "diagnostic-history" } }), 403],
    [request(undefined, { headers: { origin: "null", "sec-fetch-site": "same-origin", "x-recall-export-intent": "diagnostic-history" } }), 400],
    [request(undefined, { headers: { "sec-fetch-site": "same-origin" } }), 403],
    [request(undefined, { headers: { origin: "http://localhost", "x-recall-export-intent": "diagnostic-history" } }), 403],
    [request(undefined, { headers: { "sec-fetch-site": "none", "x-recall-export-intent": "diagnostic-history" } }), 403],
    [request(undefined, { headers: { "sec-fetch-site": "same-site", "x-recall-export-intent": "diagnostic-history" } }), 403],
    [request("http://localhost/api/diagnostic/export?path=C:/private"), 400],
    [request(undefined, { body: JSON.stringify({ profileId: "override" }) }), 400],
  ];
  for (const [input, status] of cases) {
    const response = await POST(input);
    assert.equal(response.status, status);
    assert.equal(response.headers.has("content-disposition"), false);
    assert.doesNotMatch(await response.text(), /C:\/private|override|captures/);
  }
  assert.deepEqual(files(), before);
});

test("desktop proxy metadata shape still requires intent and an already composed Host repository", async () => {
  const headers = { "x-recall-export-intent": "diagnostic-history" };
  assert.equal((await POST(request(undefined, { headers: {} }))).status, 403);
  assert.equal((await POST(request(undefined, { headers }))).status, 503);
  await seed();
  const before = files();
  assert.equal((await POST(request(undefined, { headers }))).status, 200);
  assert.deepEqual(files(), before);
});

test("HTTP accepts a closed zero-byte stream but rejects streamed data despite a zero Content-Length", async () => {
  composeDiagnosticRuntime(storage.config);
  const headers = { origin: "http://localhost", "sec-fetch-site": "same-origin",
    "x-recall-export-intent": "diagnostic-history", "content-length": "0" };
  for (const content of [undefined, "{}", " "]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { if (content === undefined) controller.close(); else controller.enqueue(new TextEncoder().encode(content)); },
      cancel() { cancelled = true; },
    });
    const init: RequestInit & { duplex: "half" } = { headers, body, duplex: "half" };
    const before = files();
    assert.equal((await POST(request(undefined, init))).status, content === undefined ? 200 : 400);
    assert.equal(cancelled, content !== undefined);
    assert.deepEqual(files(), before);
  }
});

test("recomputed checksum cannot smuggle foreign facts through canonical validation", async () => {
  await seed();
  const disk = JSON.parse(readFileSync(storage.file, "utf8"));
  disk.captures[0].provenance.ordering = "after_reveal";
  delete disk.integrity;
  writeFileSync(storage.file, encodeDiagnosticSnapshot(disk));
  assert.deepEqual(exportDiagnosticHistory(), { kind: "invalid" });
});

test("export during pending publication returns busy without changing readiness or completing the write", async () => {
  let release!: () => void;
  let calls = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const active = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
    ...diagnosticHistoryIO, replacementPlatform: "win32",
    async waitForReplacementRetry() { await waiting; },
    publishReplacement(from, to) {
      if (++calls === 1) throw Object.assign(new Error("fixture contention"), { code: "EPERM" });
      diagnosticHistoryIO.publishReplacement(from, to);
    },
  }));
  const issued = active.issue();
  if (issued.kind !== "issued") throw Error("fixture_issue_failed");
  const captured = active.capture({ sessionId: issued.sessionId, selectedOptionId: "five" });
  if (captured.kind !== "captured") throw Error("fixture_capture_failed");
  const pending = active.append(captured.attempt);
  try {
    const before = files();
    assert.deepEqual(exportDiagnosticHistory(), { kind: "busy" });
    assert.deepEqual(active.readiness(), { kind: "ready" });
    assert.deepEqual(files(), before);
    assert.equal(calls, 1);
  } finally { release(); }
  assert.equal((await pending).kind, "committed");
  const exported = exportDiagnosticHistory();
  assert.equal(exported.kind, "exported");
  if (exported.kind === "exported") assert.equal(JSON.parse(exported.source).captureCount, 1);
});
