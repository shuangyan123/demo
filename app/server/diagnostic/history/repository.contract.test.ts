import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { DiagnosticHistoryOpen, DiagnosticHistoryRepository, DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import type { IssuedDiagnosticCapturedAttemptV1 } from "../../../types/domains/first-party-diagnostic-capture.ts";
import { createControlledDiagnosticCaptureMechanism, createDiagnosticCaptureMechanism } from "../../../services/first-party-diagnostic/capture-authority-core.ts";
import { STORAGE_DOMAIN_REGISTRY } from "../../../services/storage-domain-registry.ts";
import { resolveManagedStorage, storageBootstrapPath, storageIdentityPath } from "../../../../desktop/storage-bootstrap.ts";
import { writeStorageRecord } from "../../../../desktop/storage-bootstrap-io.ts";
import { openDiagnosticHistoryRepository } from "./repository.ts";
import { createDiagnosticHistoryRepository } from "./repository-core.ts";
import { diagnosticHistoryIO, diagnosticDurabilityFailure, diagnosticReplacementObservation, diagnosticIOFailure, type DiagnosticHistoryIO } from "./io.ts";
import { DIAGNOSTIC_HISTORY_MAX_BYTES, DIAGNOSTIC_HISTORY_MAX_CAPTURES, encodeDiagnosticSnapshot } from "./record.ts";

type Context = { after: (fn: () => void) => void };
const instant = Date.parse("2026-10-07T01:02:03.000Z");
function capture(id: string, option = "four", now = instant, controlled = true): IssuedDiagnosticCapturedAttemptV1 {
  const factory = controlled ? createControlledDiagnosticCaptureMechanism : createDiagnosticCaptureMechanism;
  const mechanism = factory({ generateAttemptId: () => id, now: () => now });
  const started = mechanism.begin({ specId: "int-add-2-3", specRevision: "r1" });
  assert.equal(started.kind, "started");
  if (started.kind !== "started") throw new Error("capture setup failed");
  const result = started.session.submit({ selectedOptionId: option });
  assert.equal(result.kind, "captured");
  if (result.kind !== "captured") throw new Error("capture setup failed");
  return result.attempt;
}
function opened(t: Context, result: DiagnosticHistoryOpen): DiagnosticHistoryRepository {
  assert.equal(result.kind, "opened");
  if (result.kind !== "opened") throw new Error("repository setup failed");
  t.after(() => result.repository.close());
  return result.repository;
}
function complete(repository: DiagnosticHistoryRepository): DiagnosticHistorySnapshotV1 {
  const result = repository.readCompleteSnapshot();
  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") throw new Error("expected complete snapshot");
  return result.snapshot;
}
function fixture(t: Context, ids?: Readonly<{ profileId: string; epochId: string }>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "recall-history-contract-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("recall-history-contract-"));
    rmSync(root, { recursive: true, force: true });
  });
  const appData = path.join(root, "os-config");
  const defaultUserData = path.join(appData, "legacy-profile");
  mkdirSync(path.join(defaultUserData, "Partitions", "review-workspace"), { recursive: true });
  const paths = { appData, defaultUserData, defaultSessionData: defaultUserData };
  if (ids) {
    const identity = { formatVersion: 1, profileId: ids.profileId, epochId: ids.epochId } as const;
    mkdirSync(path.dirname(storageIdentityPath(defaultUserData)), { recursive: true });
    writeStorageRecord(storageIdentityPath(defaultUserData), identity, "create");
    mkdirSync(path.dirname(storageBootstrapPath(paths)), { recursive: true });
    writeStorageRecord(storageBootstrapPath(paths), { ...identity, activeManagedRoot: defaultUserData, profileLayout: "legacy-root" }, "create");
  }
  const result = resolveManagedStorage(paths);
  assert.ok(result.kind === "ready" || result.kind === "legacy_existing_profile");
  if (result.kind !== "ready" && result.kind !== "legacy_existing_profile") throw new Error("Host config setup failed");
  const config = result.config;
  const directory = path.join(config.managedFilesRoot, "diagnostic-history");
  const file = path.join(directory, "history.json");
  return { root, paths, config, directory, file, repository: opened(t, openDiagnosticHistoryRepository(config)) };
}
function mutate(file: string, change: (record: Record<string, unknown>) => void) {
  const record: Record<string, unknown> = JSON.parse(readFileSync(file, "utf8"));
  change(record);
  const payload = { ...record };
  delete payload.integrity;
  record.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  writeFileSync(file, JSON.stringify(record));
}
function captureRecord(record: Record<string, unknown>): Record<string, unknown> {
  assert.ok(Array.isArray(record.captures));
  return record.captures[0] as Record<string, unknown>;
}

test("trusted capture append/close/reopen recovers exact facts, immutable complete snapshot and lookup", (t) => {
  const { config, repository } = fixture(t);
  const attempt = capture("attempt-a");
  assert.equal(repository.initialize().kind, "complete");
  assert.equal(repository.appendCapturedAttempt(attempt).kind, "committed");
  repository.close();
  const reopened = opened(t, openDiagnosticHistoryRepository(config));
  const snapshot = complete(reopened);
  assert.deepEqual(snapshot.captures, [attempt]);
  assert.equal(snapshot.generation, 1);
  assert.deepEqual(reopened.resolveCapturedAttempt(attempt.id), { kind: "resolved", attempt, generation: 1 });
  assert.deepEqual(reopened.resolveCapturedAttempt("absent"), { kind: "not_found", generation: 1 });
  for (const value of [snapshot, snapshot.captures, ...snapshot.captures, snapshot.captures[0].optionIds,
    snapshot.captures[0].responseFormat, snapshot.captures[0].provenance]) assert.ok(Object.isFrozen(value));
});

test("fresh Node process recovers complete committed facts without original capture mechanism or memory", (t) => {
  const { paths, repository } = fixture(t);
  repository.initialize();
  const attempt = capture("cross-process-attempt");
  repository.appendCapturedAttempt(attempt);
  const expected = complete(repository);
  repository.close();
  const bootstrap = pathToFileURL(path.resolve("desktop/storage-bootstrap.ts")).href;
  const repo = pathToFileURL(path.resolve("app/server/diagnostic/history/repository.ts")).href;
  const script = `import { resolveManagedStorage } from ${JSON.stringify(bootstrap)};
    import { openDiagnosticHistoryRepository } from ${JSON.stringify(repo)};
    const host = resolveManagedStorage(JSON.parse(process.argv[1]));
    if (host.kind !== "ready") throw new Error("Host resolution failed");
    const opened = openDiagnosticHistoryRepository(host.config);
    if (opened.kind !== "opened") throw new Error("Repository open failed");
    try { process.stdout.write(JSON.stringify(opened.repository.readCompleteSnapshot())); }
    finally { opened.repository.close(); }`;
  const recovered: unknown = JSON.parse(execFileSync(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, JSON.stringify(paths)], { encoding: "utf8" }));
  assert.deepEqual(recovered, { kind: "complete", snapshot: expected });
});

for (const options of [["four", "five"], ["five", "four"]]) {
  test(`retry sequence ${options.join(" then ")} retains both captures after reopen without Kernel derivation`, (t) => {
    const { config, repository } = fixture(t);
    repository.initialize();
    const attempts = options.map((option, index) => capture(`attempt-${index}`, option));
    for (const attempt of attempts) assert.equal(repository.appendCapturedAttempt(attempt).kind, "committed");
    repository.close();
    assert.deepEqual(complete(opened(t, openDiagnosticHistoryRepository(config))).captures, attempts);
  });
}

test("same identity/same canonical facts confirms idempotently, different IDs at same instant remain distinct", (t) => {
  const { file, repository } = fixture(t);
  repository.initialize();
  const attempt = capture("same-id");
  repository.appendCapturedAttempt(attempt);
  const before = readFileSync(file, "utf8");
  assert.equal(repository.appendCapturedAttempt(capture("same-id")).kind, "confirmed");
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(repository.appendCapturedAttempt(capture("retry-id")).kind, "committed");
  const snapshot = complete(repository);
  assert.equal(snapshot.captures.length, 2);
  assert.equal(snapshot.captures[0].occurredAt, snapshot.captures[1].occurredAt);
});

for (const [name, replacement] of [
  ["response", () => capture("same-id", "five")],
  ["occurredAt", () => capture("same-id", "four", instant + 1000)],
  ["assistance/provenance", () => capture("same-id", "four", instant, false)],
] as const) {
  test(`same attempt ID changed ${name} rejects genuine conflicting capture and preserves original`, (t) => {
    const { file, repository } = fixture(t);
    repository.initialize();
    const original = capture("same-id");
    repository.appendCapturedAttempt(original);
    const before = readFileSync(file, "utf8");
    assert.deepEqual(repository.appendCapturedAttempt(replacement()), { kind: "conflict", reason: "attempt_identity_conflict" });
    assert.equal(readFileSync(file, "utf8"), before);
    assert.deepEqual(complete(repository).captures, [original]);
  });
}

test("raw JSON, spread copies and cast flags cannot become issued writer capability", (t) => {
  const { repository } = fixture(t);
  repository.initialize();
  const original = capture("trusted");
  for (const fake of [JSON.parse(JSON.stringify(original)), { ...original }, { ...original, verified: true },
    { ...original, provenance: { ...original.provenance, ordering: "after_reveal" } }]) {
    assert.deepEqual(repository.appendCapturedAttempt(fake), { kind: "rejected", reason: "untrusted_capture" });
  }
  assert.equal(complete(repository).generation, 0);
});

for (const field of ["profileId", "epochId"] as const) {
  test(`reopen rejects stored ${field} mismatch even with recomputed ordinary digest`, (t) => {
    const { config, file, repository } = fixture(t);
    repository.initialize(); repository.appendCapturedAttempt(capture("attempt")); repository.close();
    mutate(file, (record) => { record[field] = randomUUID(); });
    assert.deepEqual(opened(t, openDiagnosticHistoryRepository(config)).readCompleteSnapshot(), { kind: "corrupt", reason: field === "profileId" ? "profile_mismatch" : "epoch_mismatch" });
  });
}

const invalidFacts: ReadonlyArray<readonly [string, (attempt: Record<string, unknown>) => void]> = [
  ["unknown exact spec revision", (a) => { a.specRevision = "unknown-r2"; }],
  ["content revision", (a) => { a.contentRevision = "r2"; }],
  ["ordered option IDs", (a) => { a.optionIds = ["five", "four", "six"]; }],
  ["selected option identity", (a) => { a.selectedOptionId = "other"; }],
  ["response schema/version", (a) => { a.responseFormat = { kind: "single_option_id", schemaVersion: 2 }; }],
  ["source owner", (a) => { a.sourceOwnerId = "caller"; }],
  ["attempt identity", (a) => { a.id = ""; }],
  ["occurredAt", (a) => { a.occurredAt = "2026-10-07"; }],
  ["assistance", (a) => { a.assistance = "unknown"; }],
  ["assistance provenance", (a) => { (a.provenance as Record<string, unknown>).assistanceBasis = "uncontrolled_surface"; }],
  ["mechanism version", (a) => { (a.provenance as Record<string, unknown>).mechanism = "capture/v2"; }],
  ["presentation binding", (a) => { (a.provenance as Record<string, unknown>).presentation = "canonical_snapshot_issued"; }],
  ["capture schema", (a) => { a.schemaVersion = 2; }],
  ["reveal ordering", (a) => { (a.provenance as Record<string, unknown>).ordering = "after_reveal"; }],
  ["extra derived authority", (a) => { a.correctness = "correct"; }],
];
for (const [name, change] of invalidFacts) {
  test(`strict reopen rejects changed ${name} without digest becoming authority`, (t) => {
    const { config, file, repository } = fixture(t);
    // 先报告原始 setup 失败；不能让未确认的 append 变成后续 captures[0] 的无信息 TypeError。
    const initialized = repository.initialize();
    assert.equal(initialized.kind, "complete", JSON.stringify({ kind: initialized.kind, durabilityFailure: diagnosticDurabilityFailure(initialized) }));
    const appended = repository.appendCapturedAttempt(capture("attempt"));
    assert.equal(appended.kind, "committed", JSON.stringify({ kind: appended.kind, durabilityFailure: diagnosticDurabilityFailure(appended) }));
    repository.close();
    mutate(file, (record) => change(captureRecord(record)));
    assert.equal(opened(t, openDiagnosticHistoryRepository(config)).readCompleteSnapshot().kind, "corrupt");
  });
}

test("conflicting duplicate attempt IDs and missing generation members fail complete snapshot validation", (t) => {
  const { config, file, repository } = fixture(t);
  repository.initialize(); repository.appendCapturedAttempt(capture("same-id")); repository.close();
  mutate(file, (record) => { record.captures = [capture("same-id"), capture("same-id", "five")]; record.generation = 2; });
  const reopened = opened(t, openDiagnosticHistoryRepository(config));
  assert.deepEqual(reopened.readCompleteSnapshot(), { kind: "corrupt", reason: "duplicate_attempt_identity" });
  mutate(file, (record) => { record.captures = []; });
  assert.equal(reopened.readCompleteSnapshot().kind, "corrupt");
});

for (const damage of ["malformed", "truncated", "unsupported", "extra-field", "duplicate-key", "digest", "oversized"]) {
  test(`${damage} history never becomes complete-empty`, (t) => {
    const { config, file, repository } = fixture(t);
    repository.initialize(); repository.appendCapturedAttempt(capture("attempt")); repository.close();
    const before = readFileSync(file, "utf8");
    if (damage === "malformed") writeFileSync(file, "{");
    if (damage === "truncated") writeFileSync(file, before.slice(0, -3));
    if (damage === "unsupported") writeFileSync(file, JSON.stringify({ formatVersion: 2 }));
    if (damage === "extra-field") mutate(file, (record) => { record.complete = true; });
    if (damage === "duplicate-key") writeFileSync(file, before.replace('{', '{"formatVersion":1,'));
    if (damage === "digest") writeFileSync(file, before.replace('"selectedOptionId":"four"', '"selectedOptionId":"five"'));
    if (damage === "oversized") writeFileSync(file, " ".repeat(DIAGNOSTIC_HISTORY_MAX_BYTES + 1));
    assert.equal(opened(t, openDiagnosticHistoryRepository(config)).readCompleteSnapshot().kind,
      damage === "unsupported" ? "unsupported_version" : "corrupt");
  });
}

test("read never initializes; explicit initialization alone creates verified complete-empty", (t) => {
  const { config, directory, repository } = fixture(t);
  assert.deepEqual(repository.readCompleteSnapshot(), { kind: "uninitialized" });
  assert.deepEqual(repository.appendCapturedAttempt(capture("attempt")), { kind: "uninitialized" });
  assert.ok(!existsSync(config.managedFilesRoot));
  assert.equal(repository.initialize().kind, "complete");
  assert.ok(existsSync(directory));
  assert.equal(complete(repository).generation, 0);
  assert.deepEqual(complete(repository).captures, []);
  assert.equal(repository.initialize().kind, "complete");
  repository.close();
  assert.deepEqual(complete(opened(t, openDiagnosticHistoryRepository(config))).captures, []);
});

test("initialized history later missing is incomplete across reopen and cannot reinitialize empty", (t) => {
  const { config, file, repository } = fixture(t);
  repository.initialize(); repository.appendCapturedAttempt(capture("attempt"));
  rmSync(file);
  assert.deepEqual(repository.readCompleteSnapshot(), { kind: "incomplete", reason: "history_record_missing" });
  repository.close();
  const reopened = opened(t, openDiagnosticHistoryRepository(config));
  assert.deepEqual(reopened.initialize(), { kind: "incomplete", reason: "history_record_missing" });
  assert.ok(!existsSync(file));
});

for (const phase of ["partial-temp", "before-publish", "after-publish"]) {
  test(`interrupted ${phase} publication reopens only previous or new complete snapshot`, (t) => {
    const { config, file, repository } = fixture(t);
    repository.initialize(); repository.appendCapturedAttempt(capture("first")); repository.close();
    const io = { ...diagnosticHistoryIO,
      writeTemporary: (temporary: string, text: string) => {
        if (phase === "partial-temp") { writeFileSync(temporary, "{"); throw new Error("interrupted"); }
        diagnosticHistoryIO.writeTemporary(temporary, text);
      },
      publishReplacement: (from: string, to: string) => {
        if (phase === "before-publish") throw new Error("interrupted");
        diagnosticHistoryIO.publishReplacement(from, to);
        if (phase === "after-publish") throw new Error("interrupted");
      },
    };
    const interrupted = opened(t, createDiagnosticHistoryRepository(config, io));
    assert.deepEqual(interrupted.appendCapturedAttempt(capture("second")), { kind: "unavailable", code: "storage_unavailable", reason: "commit_unconfirmed" });
    interrupted.close();
    writeFileSync(`${file}.orphan.tmp`, "{");
    const snapshot = complete(opened(t, openDiagnosticHistoryRepository(config)));
    assert.deepEqual(snapshot.captures.map((a) => a.id), phase === "after-publish" ? ["first", "second"] : ["first"]);
  });
}

test("interrupted initialization retains reservation and fails incomplete across reopen", (t) => {
  const { config, repository } = fixture(t); repository.close();
  const broken = opened(t, createDiagnosticHistoryRepository(config, { ...diagnosticHistoryIO,
    publishNew: () => { throw new Error("interrupted"); } }));
  assert.equal(broken.initialize().kind, "unavailable"); broken.close();
  const reopened = opened(t, openDiagnosticHistoryRepository(config));
  assert.equal(reopened.readCompleteSnapshot().kind, "incomplete");
  assert.equal(reopened.initialize().kind, "incomplete");
});

test("finite capacity returns explicit failure without eviction, truncation or generation change", (t) => {
  const { config, file, repository } = fixture(t);
  repository.initialize(); repository.close();
  const captures = Array.from({ length: DIAGNOSTIC_HISTORY_MAX_CAPTURES }, (_, index) => capture(`attempt-${index}`));
  const snapshot: DiagnosticHistorySnapshotV1 = { formatVersion: 1, profileId: config.profileId, epochId: config.epochId,
    generation: captures.length, captures };
  const before = encodeDiagnosticSnapshot(snapshot);
  writeFileSync(file, before);
  const reopened = opened(t, openDiagnosticHistoryRepository(config));
  assert.deepEqual(reopened.appendCapturedAttempt(capture("overflow")), { kind: "rejected", reason: "capacity_exceeded" });
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(complete(reopened).captures.length, captures.length);
});

test("repository path uses trusted managed-files domain; serialized record excludes derived authority and content", (t) => {
  const { config, file, repository } = fixture(t);
  repository.initialize(); repository.appendCapturedAttempt(capture("attempt"));
  assert.equal(file, path.join(config.managedFilesRoot, "diagnostic-history", "history.json"));
  assert.doesNotMatch(readFileSync(file, "utf8"), /correctness|verifiedCorrectOptionId|answerKey|explanation|learningTarget|LearningEvent|Evidence|LearnerTargetState|VerificationDecision|"complete"|"prompt"|"text"/);
  assert.equal(STORAGE_DOMAIN_REGISTRY.filter((domain) => domain.domainId === "diagnostic-history").length, 1);
});

test("same profile/epoch at a different trusted location preserves history identity", (t) => {
  const first = fixture(t);
  first.repository.initialize(); first.repository.appendCapturedAttempt(capture("attempt")); first.repository.close();
  const next = fixture(t, first.config); next.repository.close();
  mkdirSync(next.config.managedFilesRoot);
  cpSync(first.directory, next.directory, { recursive: true }); // contract fixture only，生产无 copy/migration。
  const recovered = complete(opened(t, openDiagnosticHistoryRepository(next.config)));
  assert.equal(recovered.profileId, first.config.profileId);
  assert.equal(recovered.epochId, first.config.epochId);
  assert.notEqual(next.file, first.file);
  assert.equal(recovered.captures[0].id, "attempt");
});

test("offline active profile is unavailable and cannot recreate/fallback; close releases single-instance ownership", (t) => {
  const { config, root, repository } = fixture(t);
  assert.deepEqual(openDiagnosticHistoryRepository(config), { kind: "unavailable", code: "storage_unavailable", reason: "repository_already_open" });
  const renamedProfile = path.join(root, "offline-profile");
  // 仅移动临时 fixture：模拟 Host 已解析 root 随后离线，保持真实 config 原状。
  assert.equal(path.dirname(config.profileRoot), path.join(root, "os-config"));
  renameSync(config.profileRoot, renamedProfile);
  repository.close();
  assert.deepEqual(repository.readCompleteSnapshot(), { kind: "closed" });
  const unavailable = opened(t, openDiagnosticHistoryRepository(config));
  assert.equal(unavailable.initialize().kind, "unavailable");
  assert.ok(!existsSync(config.managedFilesRoot));
  assert.ok(existsSync(renamedProfile));
  assert.deepEqual(readdirSync(root).sort(), ["offline-profile", "os-config"]);
});

const unconfirmed = { kind: "unavailable", code: "storage_unavailable", reason: "commit_unconfirmed" } as const;
function ioError(code: string, syscall: string, errno = -4048) {
  return Object.assign(new Error("synthetic private message C:/private/secret/history.json"), {
    code, syscall, errno, path: "C:/private/source", dest: "C:/private/destination", cause: "private cause",
  });
}
function instrumentedFixture(t: Context, override: Partial<DiagnosticHistoryIO>) {
  const base = fixture(t);
  assert.equal(base.repository.initialize().kind, "complete");
  base.repository.close();
  return { ...base, repository: opened(t, createDiagnosticHistoryRepository(base.config, { ...diagnosticHistoryIO, ...override })) };
}

for (const [syscall, stage] of [["open", "temporary_open"], ["write", "temporary_write"],
  ["fsync", "temporary_fsync"], ["close", "temporary_close"], ["unknown", "temporary_write_or_flush"]] as const) {
  test(`instrumentation classifies temp ${syscall}, with no publication/retry and unchanged external failure`, t => {
    const calls: string[] = [];
    const { repository } = instrumentedFixture(t, {
      writeTemporary() { calls.push("write"); throw ioError("EIO", syscall); },
      publishReplacement() { calls.push("rename"); },
      removeTemporary() { calls.push("cleanup"); },
    });
    const result = repository.appendCapturedAttempt(capture("diagnostic-attempt"));
    assert.deepEqual(result, unconfirmed);
    assert.deepEqual(calls, ["write", "cleanup"]);
    const detail = diagnosticDurabilityFailure(result);
    assert.ok(detail);
    assert.equal(detail.stage, stage); assert.equal(detail.publication, "not_attempted");
    assert.equal(detail.operation, "writeFileSync"); assert.equal(detail.io?.ioCode, "EIO");
    assert.equal(detail.io?.syscall, syscall === "unknown" ? null : syscall);
    assert.equal(detail.mode, "replace"); assert.equal(detail.confirmationFailure, null);
    assert.doesNotMatch(JSON.stringify(detail), /private|secret|message|cause|C:\//);
    assert.deepEqual(Reflect.ownKeys(result).sort(), ["kind", "code", "reason"].sort());
    assert.equal(diagnosticDurabilityFailure({ ...result }), null);
  });
}

test("instrumentation retains original native temp open EEXIST classification without replacing write/flush primitive", t => {
  const { repository, file } = instrumentedFixture(t, { writeTemporary(temporary, text) {
    writeFileSync(temporary, "synthetic collision");
    diagnosticHistoryIO.writeTemporary(temporary, text);
  } });
  const before = readFileSync(file, "utf8");
  const result = repository.appendCapturedAttempt(capture("collision-attempt"));
  assert.deepEqual(result, unconfirmed);
  const detail = diagnosticDurabilityFailure(result);
  assert.equal(detail?.stage, "temporary_open"); assert.equal(detail?.io?.ioCode, "EEXIST");
  assert.equal(detail?.io?.syscall, "open"); assert.equal(typeof detail?.io?.errno, "number");
  assert.equal(detail?.publicationFailure?.sourceExists, true); assert.equal(detail?.publicationFailure?.destinationExists, true);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("instrumentation distinguishes first link publication and preserves reservation/cleanup semantics", t => {
  const base = fixture(t); base.repository.close();
  const calls: string[] = [];
  const repository = opened(t, createDiagnosticHistoryRepository(base.config, { ...diagnosticHistoryIO,
    publishNew() { calls.push("link"); throw ioError("EEXIST", "link"); },
    removeTemporary(file) { calls.push("cleanup"); diagnosticHistoryIO.removeTemporary(file); },
  }));
  const result = repository.initialize();
  assert.deepEqual(result, unconfirmed);
  const detail = diagnosticDurabilityFailure(result);
  assert.equal(detail?.stage, "publication_link"); assert.equal(detail?.operation, "linkSync");
  assert.equal(detail?.mode, "create"); assert.equal(detail?.publication, "reported_failure");
  assert.equal(detail?.io?.ioCode, "EEXIST"); assert.equal(detail?.confirmationFailure, null);
  assert.equal(detail?.publicationFailure?.sourceExists, true); assert.equal(detail?.publicationFailure?.destinationExists, false);
  assert.match(detail?.publicationFailure?.sourceFile ?? "", /^history\.json\.[a-f0-9-]+\.tmp$/);
  assert.equal(detail?.publicationFailure?.destinationFile, "history.json");
  assert.deepEqual(calls, ["link", "cleanup"]); assert.ok(existsSync(base.directory)); assert.ok(!existsSync(base.file));
});

for (const afterPublication of [false, true]) {
  test(`instrumentation retains rename failure; exact NEW ${afterPublication} controls bounded recovery`, t => {
    const { repository, file } = instrumentedFixture(t, { replacementPlatform: "win32", waitForReplacementRetry() {}, publishReplacement(from, to) {
      if (afterPublication) diagnosticHistoryIO.publishReplacement(from, to);
      throw ioError("EPERM", "rename");
    } });
    const result = repository.appendCapturedAttempt(capture("rename-attempt"));
    const replacement = diagnosticReplacementObservation(result);
    assert.equal(replacement?.failures[0].io.ioCode, "EPERM");
    assert.equal(replacement?.terminalReason, afterPublication ? "already_published" : "retry_exhausted");
    assert.equal(replacement?.attemptCount, afterPublication ? 1 : 4);
    if (afterPublication) {
      assert.equal(result.kind, "committed");
      assert.equal(diagnosticDurabilityFailure(result), null);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).generation, 1);
      return;
    }
    assert.deepEqual(result, unconfirmed);
    const detail = diagnosticDurabilityFailure(result);
    assert.equal(detail?.stage, "replacement_rename"); assert.equal(detail?.operation, "renameSync");
    assert.equal(detail?.publication, "reported_failure"); assert.equal(detail?.mode, "replace");
    assert.equal(detail?.io?.ioCode, "EPERM"); assert.equal(detail?.confirmationFailure, null);
    assert.equal(detail?.publicationFailure?.sourceExists, !afterPublication);
    assert.equal(detail?.publicationFailure?.destinationExists, true);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).generation, afterPublication ? 1 : 0);
  });
}

test("cleanup failure is secondary and cannot override primary rename failure", t => {
  const calls: string[] = [];
  const { repository } = instrumentedFixture(t, {
    replacementPlatform: "win32", waitForReplacementRetry() {},
    writeTemporary(file, text) { calls.push("write"); diagnosticHistoryIO.writeTemporary(file, text); },
    publishReplacement() { calls.push("rename"); throw ioError("EPERM", "rename"); },
    removeTemporary() { calls.push("cleanup"); throw ioError("EACCES", "unlink"); },
  });
  const result = repository.appendCapturedAttempt(capture("cleanup-attempt"));
  assert.deepEqual(result, unconfirmed);
  const detail = diagnosticDurabilityFailure(result);
  assert.equal(detail?.stage, "replacement_rename"); assert.equal(detail?.io?.ioCode, "EPERM");
  assert.equal(detail?.cleanupFailure?.operation, "unlinkSync"); assert.equal(detail?.cleanupFailure?.ioCode, "EACCES");
  assert.deepEqual(calls, ["write", "rename", "rename", "rename", "rename", "cleanup"]);
});

test("cleanup-only failure remains nonfatal after successful publication and confirmation", t => {
  const { repository } = instrumentedFixture(t, { removeTemporary() { throw ioError("EPERM", "unlink"); } });
  const result = repository.appendCapturedAttempt(capture("committed-despite-cleanup"));
  assert.equal(result.kind, "committed"); assert.equal(diagnosticDurabilityFailure(result), null);
  assert.equal(complete(repository).generation, 1);
});

test("instrumentation distinguishes confirmation reopen/read failure after publication returned success", t => {
  let published = false;
  const { repository, file } = instrumentedFixture(t, {
    publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; },
    read(file, observe) {
      if (!published) return diagnosticHistoryIO.read(file, observe);
      observe?.(diagnosticIOFailure(ioError("EACCES", "open"), "openSync"));
      return { kind: "unavailable", code: "storage_unavailable", reason: "snapshot_read_failed" };
    },
  });
  const result = repository.appendCapturedAttempt(capture("read-failure-attempt"));
  assert.deepEqual(result, unconfirmed);
  const detail = diagnosticDurabilityFailure(result);
  assert.equal(detail?.stage, "confirmation_read"); assert.equal(detail?.operation, "openSync");
  assert.equal(detail?.publication, "reported_success"); assert.equal(detail?.confirmationFailure, "reopen_or_read_failed");
  assert.equal(detail?.io?.ioCode, "EACCES"); assert.equal(detail?.io?.syscall, "open");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).generation, 1);
});

test("native missing confirmation record retains ENOENT and does not initialize/repair/retry", t => {
  let published = false;
  const { repository, file } = instrumentedFixture(t, {
    publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); rmSync(to); published = true; },
    read(file, observe) { return diagnosticHistoryIO.read(file, published ? observe : undefined); },
  });
  const result = repository.appendCapturedAttempt(capture("missing-after-publication"));
  assert.deepEqual(result, unconfirmed);
  const detail = diagnosticDurabilityFailure(result);
  assert.equal(detail?.publication, "reported_success"); assert.equal(detail?.stage, "confirmation_read");
  assert.equal(detail?.confirmationFailure, "file_missing"); assert.equal(detail?.operation, "lstatSync");
  assert.equal(detail?.io?.ioCode, "ENOENT"); assert.ok(!existsSync(file));
});

for (const [damage, expectedFailure, expectedReason] of [
  ["malformed", "malformed_snapshot", "malformed_snapshot"], ["integrity", "integrity_mismatch", "integrity_mismatch"],
  ["profile", "identity_mismatch", "profile_mismatch"], ["epoch", "identity_mismatch", "epoch_mismatch"],
  ["generation", "generation_mismatch", "invalid_snapshot_generation"],
  ["unsupported", "other_validation_failure", "unsupported_version"],
] as const) {
  test(`instrumentation distinguishes confirmation ${damage} validation failure`, t => {
    let published = false;
    const { repository } = instrumentedFixture(t, {
      publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; },
      read(file, observe) {
        const result = diagnosticHistoryIO.read(file, observe);
        if (!published || result.kind !== "record") return result;
        const record = JSON.parse(result.text);
        if (damage === "integrity") record.integrity = "0".repeat(64);
        if (damage === "profile") record.profileId = randomUUID();
        if (damage === "epoch") record.epochId = randomUUID();
        if (damage === "generation") record.generation = 0;
        if (damage === "unsupported") record.formatVersion = 2;
        return { kind: "record", text: damage === "malformed" ? "{" : JSON.stringify(record) };
      },
    });
    const result = repository.appendCapturedAttempt(capture("validation-attempt"));
    assert.deepEqual(result, unconfirmed);
    const detail = diagnosticDurabilityFailure(result);
    assert.equal(detail?.stage, "confirmation_validation"); assert.equal(detail?.operation, "parseDiagnosticSnapshot");
    assert.equal(detail?.publication, "reported_success"); assert.equal(detail?.confirmationFailure, expectedFailure);
    assert.equal(detail?.validationReason, expectedReason); assert.equal(detail?.io, null);
  });
}

for (const damage of ["generation_mismatch", "expected_capture_missing", "content_mismatch"] as const) {
  test(`valid confirmation snapshot ${damage} is distinct from parse/integrity failure`, t => {
    let published = false;
    const { repository } = instrumentedFixture(t, {
      publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; },
      read(file, observe) {
        const result = diagnosticHistoryIO.read(file, observe);
        if (!published || result.kind !== "record") return result;
        const actual = JSON.parse(result.text);
        const captures = damage === "generation_mismatch" ? []
          : [capture(damage === "expected_capture_missing" ? "different-attempt" : "comparison-attempt", "five")];
        return { kind: "record", text: encodeDiagnosticSnapshot({ formatVersion: 1, profileId: actual.profileId,
          epochId: actual.epochId, generation: captures.length, captures }) };
      },
    });
    const result = repository.appendCapturedAttempt(capture("comparison-attempt", "four"));
    assert.deepEqual(result, unconfirmed);
    const detail = diagnosticDurabilityFailure(result);
    assert.equal(detail?.stage, "confirmation_compare"); assert.equal(detail?.operation, "compare_snapshot");
    assert.equal(detail?.publication, "reported_success"); assert.equal(detail?.confirmationFailure, damage);
    assert.equal(detail?.validationReason, null); assert.equal(detail?.io, null);
  });
}

test("IO sanitization rejects getters, raw paths/messages, unknown codes/syscalls and non-error throws", () => {
  let getterCalls = 0;
  const hostile = Object.defineProperties({}, { code: { get() { getterCalls++; return "EPERM"; } },
    syscall: { value: "C:/private/syscall" }, errno: { value: "private" }, message: { value: "private message" } });
  assert.deepEqual(diagnosticIOFailure(hostile, "renameSync"), { operation: "renameSync", ioCode: null, syscall: null, errno: null });
  assert.equal(getterCalls, 0);
  for (const error of ["private thrown string", null, ioError("PRIVATE_CODE", "private", Number.NaN),
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private proxy failure"); } })]) {
    assert.deepEqual(diagnosticIOFailure(error, "linkSync"), { operation: "linkSync", ioCode: null, syscall: null, errno: null });
  }
});

test("diagnostic observer cannot replace native missing-file result", t => {
  const { root } = fixture(t);
  const file = path.join(root, "not-present");
  assert.deepEqual(diagnosticHistoryIO.read(file, () => { throw Error("synthetic observer failure"); }), { kind: "missing" });
  assert.equal(diagnosticHistoryIO.directoryState(file, () => { throw Error("synthetic observer failure"); }), "missing");
});

for (const parsed of [false, true]) {
  test(`confirmation capacity failure originates from ${parsed ? "parser" : "fstat"}, not an invented IO exception`, t => {
    let published = false;
    const { repository } = instrumentedFixture(t, {
      publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; },
      read(file, observe) {
        if (!published) return diagnosticHistoryIO.read(file, observe);
        const oversized = " ".repeat(DIAGNOSTIC_HISTORY_MAX_BYTES + 1);
        if (parsed) return { kind: "record", text: oversized };
        writeFileSync(file, oversized); // fault fixture only：让既有 native fstat 边界拒绝。
        return diagnosticHistoryIO.read(file, observe);
      },
    });
    const result = repository.appendCapturedAttempt(capture("capacity-confirmation-attempt"));
    assert.deepEqual(result, unconfirmed);
    const detail = diagnosticDurabilityFailure(result);
    assert.equal(detail?.stage, parsed ? "confirmation_validation" : "confirmation_read");
    assert.equal(detail?.operation, parsed ? "parseDiagnosticSnapshot" : "fstatSync");
    assert.equal(detail?.confirmationFailure, "snapshot_capacity_exceeded"); assert.equal(detail?.io, null);
  });
}

test("non-error publication throw retains unknown sanitized IO and the same external failure", t => {
  const { repository } = instrumentedFixture(t, { writeTemporary() { throw "synthetic private thrown string"; } });
  const result = repository.appendCapturedAttempt(capture("unknown-io-attempt"));
  assert.deepEqual(result, unconfirmed);
  const detail = diagnosticDurabilityFailure(result);
  assert.equal(detail?.stage, "temporary_write_or_flush"); assert.equal(detail?.publication, "not_attempted");
  assert.deepEqual(detail?.io, { operation: "writeFileSync", ioCode: null, syscall: null, errno: null });
  assert.doesNotMatch(JSON.stringify(detail), /private|synthetic/);
});
