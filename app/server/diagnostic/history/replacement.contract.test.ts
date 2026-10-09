import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { diagnosticStorageFixture } from "../../../../test-support/diagnostic-storage.ts";
import { replacementFailureEvidenceIO, withReplacementFailureEvidence } from "../../../../test-support/replacement-failure-diagnostics.ts";
import { createControlledDiagnosticCaptureMechanism } from "../../../services/first-party-diagnostic/capture-authority-core.ts";
import { createDiagnosticHistoryRepository } from "./repository-core.ts";
import { diagnosticHistoryIO, diagnosticDurabilityFailure, diagnosticReplacementObservation, diagnosticIOFailure, type DiagnosticHistoryIO } from "./io.ts";
import { encodeDiagnosticSnapshot, parseDiagnosticSnapshot } from "./record.ts";
import type { DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import { DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET, DIAGNOSTIC_REPLACEMENT_OFFSETS_MS } from "./replacement.ts";

const unconfirmed = { kind: "unavailable", code: "storage_unavailable", reason: "commit_unconfirmed" };
const failure = (code = "EPERM") => Object.assign(Error("private native error"), { code, syscall: "rename", errno: -4048 });
function payload(file: string): DiagnosticHistorySnapshotV1 {
  const value = JSON.parse(readFileSync(file, "utf8"));
  delete value.integrity;
  return value;
}
function capture(id = "retry-attempt") {
  const mechanism = createControlledDiagnosticCaptureMechanism({ generateAttemptId: () => id, now: () => Date.parse("2026-10-07T08:00:00Z") });
  const started = mechanism.begin({ specId: "int-add-2-3", specRevision: "r1" });
  if (started.kind !== "started") throw Error("capture setup");
  const captured = started.session.submit({ selectedOptionId: "five" });
  if (captured.kind !== "captured") throw Error("capture setup");
  return captured.attempt;
}
function fixture(context: { after(fn: () => void): void }, override: Partial<DiagnosticHistoryIO> = {}, preserve = () => false) {
  const storage = diagnosticStorageFixture();
  const waits: number[] = []; let clock = 100;
  const opened = createDiagnosticHistoryRepository(storage.config, { ...diagnosticHistoryIO,
    replacementPlatform: "win32", replacementNow: () => clock, async waitForReplacementRetry(ms) { waits.push(ms); clock += ms; }, ...override });
  if (opened.kind !== "opened") throw Error("repository setup");
  const repository = opened.repository;
  context.after(() => { repository.close(); if (!preserve()) storage.cleanup(); });
  assert.equal(repository.initialize().kind, "complete");
  return { ...storage, repository, waits, disk: () => JSON.parse(readFileSync(storage.file, "utf8")) };
}

test("replacement succeeds on first attempt; normal confirmation and exact capture facts remain unchanged", async context => {
  let readsAfterPublication = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; },
    read(file, observe) { if (published) readsAfterPublication++; return diagnosticHistoryIO.read(file, observe); },
  });
  const attempt = capture();
  const immediate = state.repository.appendCapturedAttempt(attempt);
  assert.equal(immediate instanceof Promise, false, "no delayed continuation on first native success");
  const result = await immediate;
  assert.equal(result.kind, "committed"); assert.equal(readsAfterPublication, 1); assert.deepEqual(state.waits, []);
  assert.deepEqual(state.disk().captures, [attempt]); assert.equal(state.disk().generation, 1);
  assert.equal(diagnosticReplacementObservation(result)?.attemptCount, 1);
  assert.deepEqual(diagnosticReplacementObservation(result)?.failures, []);
  assert.deepEqual(Object.keys(result).sort(), ["kind", "snapshot"]);
});

for (const code of ["EPERM", "EBUSY", "EACCES"]) for (const failures of [1, 2, 3]) {
  test(`${code} ${failures} times then success: every retry revalidates OLD and NEW, one canonical commit`, async context => {
    let attempts = 0; let temporary: string | undefined; const reads: string[] = [];
    const state = fixture(context, {
      publishReplacement(from, to) {
        temporary ??= from; assert.equal(from, temporary, "same temp is reused");
        attempts++; if (attempts <= failures) throw failure(code);
        diagnosticHistoryIO.publishReplacement(from, to);
      },
      read(file, observe) { reads.push(file); return diagnosticHistoryIO.read(file, observe); },
    });
    const attempt = capture(); const result = (await state.repository.appendCapturedAttempt(attempt));
    assert.equal(result.kind, "committed"); assert.equal(attempts, failures + 1);
    assert.deepEqual(state.waits, DIAGNOSTIC_REPLACEMENT_OFFSETS_MS.slice(1, failures + 1).map((offset, index) => offset - DIAGNOSTIC_REPLACEMENT_OFFSETS_MS[index]));
    assert.deepEqual(state.disk().captures, [attempt]); assert.equal(state.disk().generation, 1);
    const detail = diagnosticReplacementObservation(result)!;
    assert.equal(detail.terminalReason, "succeeded"); assert.equal(detail.attemptBudget, 9); assert.equal(detail.waitBudgetMs, 2000);
    assert.ok(detail.failures.every(item => item.io.ioCode === code && item.diskState === "expected_old" && item.beforeRetryState === "expected_old"));
    assert.equal(reads.filter(file => file === temporary).length, failures * 2, "temp checked after failure and after wait");
    assert.ok(Object.isFrozen(detail) && Object.isFrozen(detail.failures) && detail.failures.every(Object.isFrozen));
    assert.doesNotMatch(JSON.stringify(detail), /private|selectedOptionId|history\.json/);
  });
}

test("permanent EPERM exhausts exactly nine attempts and 2000ms recovery deadline, OLD remains valid and cleanup is secondary", async context => {
  let attempts = 0;
  const state = fixture(context, { publishReplacement() { attempts++; throw failure(); } });
  const before = readFileSync(state.file, "utf8"); const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET);
  assert.deepEqual(state.waits, [50, 100, 150, 200, 250, 250, 500, 500]); assert.equal(readFileSync(state.file, "utf8"), before);
  assert.equal(state.repository.readCompleteSnapshot().kind, "complete");
  assert.deepEqual(readdirSync(path.dirname(state.file)), ["history.json"]);
  const detail = diagnosticDurabilityFailure(result)!;
  assert.equal(detail.replacement?.terminalReason, "deadline_exhausted"); assert.equal(detail.replacement?.failures.length, 9);
  assert.equal(detail.stage, "replacement_rename"); assert.equal(detail.io?.ioCode, "EPERM");
});

test("reported EPERM after native publication accepts exact NEW, no second rename or temp required, still confirms", async context => {
  let attempts = 0; let readsAfterPublication = 0; let published = false;
  const lifecycle = { preserve: true };
  const trace: unknown[] = [];
  const candidates: Array<{ name: string; text: string }> = [];
  const state = fixture(context, {
    writeTemporary(file, text) {
      candidates.push({ name: path.basename(file), text });
      try { diagnosticHistoryIO.writeTemporary(file, text); }
      catch (error) { trace.push(diagnosticIOFailure(error, "writeFileSync")); throw error; }
    },
    publishReplacement(from, to) {
      attempts++;
      try { diagnosticHistoryIO.publishReplacement(from, to); }
      catch (error) { trace.push({ phase: "native_publication", ...diagnosticIOFailure(error, "renameSync") }); throw error; }
      published = true;
      trace.push({ phase: "native_publication", operation: "renameSync", result: "success", followedBy: "synthetic_EPERM" });
      throw failure();
    },
    directoryState(file, observe) {
      const result = diagnosticHistoryIO.directoryState(file, detail => { trace.push(detail); observe?.(detail); });
      trace.push({ operation: "directoryState", name: path.basename(file), result });
      return result;
    },
    read(file, observe) {
      if (published) readsAfterPublication++;
      try {
        const result = diagnosticHistoryIO.read(file, detail => { trace.push(detail); observe?.(detail); });
        trace.push({ operation: "read", name: path.basename(file), result: result.kind, afterPublication: published });
        return result;
      }
      catch (error) { trace.push(diagnosticIOFailure(error, "closeSync")); throw error; }
    },
    removeTemporary(file) {
      try { diagnosticHistoryIO.removeTemporary(file); trace.push({ operation: "unlinkSync", name: path.basename(file), result: "success" }); }
      catch (error) { trace.push(diagnosticIOFailure(error, "unlinkSync")); throw error; }
    },
  }, () => lifecycle.preserve);
  let result: Awaited<ReturnType<typeof state.repository.appendCapturedAttempt>> | undefined;
  await withReplacementFailureEvidence(context, { ...state, lifecycle, candidates }, () => ({
    result: result ?? null, durability: result ? diagnosticDurabilityFailure(result) : null,
    replacement: result ? diagnosticReplacementObservation(result) : null,
    attempts, waits: state.waits, published, readsAfterPublication, trace,
  }), async () => {
    result = await state.repository.appendCapturedAttempt(capture());
    assert.equal(result.kind, "committed"); assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
    assert.equal(readsAfterPublication, 2, "strict recovery read plus existing commit confirmation");
    assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "already_published");
    assert.equal(diagnosticReplacementObservation(result)?.failures[0].diskState, "expected_new");
  });
  lifecycle.preserve = false;
});

const diagnosticFaults: Array<[string, (io: typeof replacementFailureEvidenceIO) => typeof replacementFailureEvidenceIO]> = [
  ["OLD read", io => { let first = true; return { ...io, read(file) { if (first) { first = false; throw failure("EIO"); } return io.read(file); } }; }],
  ["directory enumeration", io => ({ ...io, list() { throw failure("EACCES"); } })],
  ["hashing", io => ({ ...io, hash() { throw failure("EIO"); } })],
  ["evidence write", io => ({ ...io, write() { throw failure("ENOSPC"); } })],
  ["multiple observations", io => ({ ...io, read() { throw failure("EIO"); }, list() { throw failure("EACCES"); },
    hash() { throw failure("EIO"); }, write() { throw failure("ENOSPC"); } })],
];
for (const [name, inject] of diagnosticFaults) test(`failure diagnostics preserve primary error and fixture despite ${name} failure`, async context => {
  const hooks: Array<() => void> = [], lifecycle = { preserve: false };
  const state = fixture({ after(fn) { hooks.push(fn); } }, {}, () => lifecycle.preserve);
  const original = Object.assign(new Error("synthetic primary test failure"), { code: "TEST_PRIMARY_FAILURE" });
  const messages: string[] = [];
  context.after(() => { state.repository.close(); assert.equal(existsSync(state.root), true); });
  const candidates = [{ name: "synthetic-new.tmp", text: "synthetic NEW only" }];
  const damagedBytes = Buffer.from([0xff, 0x00, 0xfe]);
  writeFileSync(path.join(path.dirname(state.file), candidates[0].name), damagedBytes);
  await assert.rejects(withReplacementFailureEvidence({ diagnostic(text) { messages.push(text); } },
    { ...state, lifecycle, candidates }, () => ({ result: { kind: "unavailable", reason: "synthetic_primary" } }),
    async () => { throw original; }, inject(replacementFailureEvidenceIO)), error => error === original);
  for (const hook of hooks) hook();
  assert.equal(lifecycle.preserve, true); assert.equal(existsSync(state.file), true);
  assert.ok(messages.some(text => text.includes(state.root)), "retained location remains visible");
  assert.ok(messages.some(text => text.includes("diagnostic collection failure")), "secondary diagnostics are reported separately");
  assert.doesNotMatch(messages.join("\n"), /private native error|synthetic NEW|selectedOptionId|TEST_PRIMARY_FAILURE/);
  if (name !== "evidence write" && name !== "multiple observations") {
    const evidence = JSON.parse(readFileSync(path.join(state.root, "failure-evidence.json"), "utf8"));
    assert.equal(evidence.result.reason, "synthetic_primary"); assert.ok(evidence.collectionFailures.length > 0);
    if (name !== "hashing") {
      const observed = evidence.files.find((file: { name: string }) => file.name === candidates[0].name);
      assert.equal(observed.bytes, damagedBytes.byteLength);
      assert.equal(observed.sha256, createHash("sha256").update(damagedBytes).digest("hex"), "hash actual file bytes without UTF-8 replacement");
    }
    assert.doesNotMatch(JSON.stringify(evidence), /synthetic NEW only|private native error/);
  }
  context.diagnostic(`Expected diagnostic-failure fixture retained: ${state.root}`);
});

for (const damage of ["other_generation", "same_generation_content", "malformed", "missing", "profile", "epoch", "integrity", "unsupported", "capacity"] as const) {
  test(`EPERM with unexpected target ${damage} never retries or overwrites it`, async context => {
    let attempts = 0; let unexpected = ""; let armed = false;
    const state = fixture(context, { publishReplacement(from, to) {
      if (damage === "same_generation_content" && !armed) { diagnosticHistoryIO.publishReplacement(from, to); return; }
      attempts++;
      const old = payload(to);
      unexpected = damage === "other_generation" ? encodeDiagnosticSnapshot({ ...old, generation: 1, captures: [capture("other-commit")] })
        : damage === "same_generation_content" ? encodeDiagnosticSnapshot({ ...old, captures: [capture("changed-base")], generation: 1 })
          : damage === "malformed" ? "{" : damage === "capacity" ? " ".repeat(4 * 1024 * 1024 + 1)
            : damage === "unsupported" ? JSON.stringify({ formatVersion: 2 })
              : encodeDiagnosticSnapshot({ ...old, [damage === "profile" ? "profileId" : "epochId"]: "different" });
      if (damage === "integrity") unexpected = readFileSync(to, "utf8").replace(/"integrity":"[a-f0-9]+"/, '"integrity":"' + "0".repeat(64) + '"');
      if (damage === "missing") unlinkSync(to); else writeFileSync(to, unexpected);
      throw failure();
    } });
    if (damage === "same_generation_content") assert.equal((await state.repository.appendCapturedAttempt(capture("base"))).kind, "committed");
    armed = true;
    const result = (await state.repository.appendCapturedAttempt(capture()));
    assert.deepEqual(result, unconfirmed); assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "state_changed");
    if (damage === "other_generation" || damage === "same_generation_content")
      assert.equal(parseDiagnosticSnapshot(unexpected, state.config).kind, "complete", "unexpected target is valid, not merely malformed");
    assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
    if (damage === "missing") assert.equal(existsSync(state.file), false); else assert.equal(readFileSync(state.file, "utf8"), unexpected);
  });
}

for (const damage of ["missing", "malformed", "wrong_capture", "wrong_profile", "wrong_generation", "integrity"] as const) {
  test(`EPERM with temp ${damage} fails closed without retry`, async context => {
    let attempts = 0;
    const state = fixture(context, { publishReplacement(from) {
      attempts++;
      if (damage === "missing") unlinkSync(from);
      else if (damage === "malformed") writeFileSync(from, "{");
      else {
        const value = payload(from);
        const changed = damage === "wrong_capture" ? { ...value, captures: [capture("other-attempt")] }
          : damage === "wrong_profile" ? { ...value, profileId: "different" }
            : { ...value, generation: 0, captures: [] };
        writeFileSync(from, damage === "integrity" ? readFileSync(from, "utf8").replace(/"integrity":"[a-f0-9]+"/, '"integrity":"' + "0".repeat(64) + '"') : encodeDiagnosticSnapshot(changed));
      }
      throw failure();
    } });
    const before = readFileSync(state.file, "utf8"); const result = (await state.repository.appendCapturedAttempt(capture()));
    assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
    assert.equal(readFileSync(state.file, "utf8"), before); assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "temp_invalid");
  });
}

test("state changing during wait is revalidated before retry", async context => {
  let target = ""; let attempts = 0;
  const state = fixture(context, {
    publishReplacement(_from, to) { target = to; attempts++; throw failure(); },
    async waitForReplacementRetry() { const value = payload(target); writeFileSync(target, encodeDiagnosticSnapshot({ ...value, generation: 1, captures: [capture("other")] })); },
  });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1);
  assert.equal(diagnosticReplacementObservation(result)?.failures[0].beforeRetryState, "unexpected");
});

test("exact NEW appearing during wait is accepted and confirmed without a second rename", async context => {
  let source = ""; let target = ""; let attempts = 0;
  const state = fixture(context, {
    publishReplacement(from, to) { source = from; target = to; attempts++; throw failure(); },
    async waitForReplacementRetry() { diagnosticHistoryIO.publishReplacement(source, target); },
  });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.equal(result.kind, "committed"); assert.equal(attempts, 1);
  assert.equal(diagnosticReplacementObservation(result)?.failures[0].beforeRetryState, "expected_new");
});

for (const code of ["ENOSPC", "EIO", "ENOENT", "EINVAL", "EROFS", "EEXIST"]) {
  test(`${code} never retries or runs recovery reads`, async context => {
    let attempts = 0; let reads = 0;
    const state = fixture(context, {
      publishReplacement() { attempts++; throw failure(code); },
      read(file, observe) { reads++; return diagnosticHistoryIO.read(file, observe); },
    });
    reads = 0; const result = (await state.repository.appendCapturedAttempt(capture()));
    assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.equal(reads, 1); assert.deepEqual(state.waits, []);
    assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "non_retryable");
  });
}

test("non-Windows replacement retains one attempt even for EPERM", async context => {
  let attempts = 0;
  const state = fixture(context, { replacementPlatform: "linux", publishReplacement() { attempts++; throw failure(); } });
  assert.deepEqual((await state.repository.appendCapturedAttempt(capture())), unconfirmed); assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
});

test("initial link failure is never retried", context => {
  const storage = diagnosticStorageFixture(); let links = 0;
  const opened = createDiagnosticHistoryRepository(storage.config, { ...diagnosticHistoryIO,
    publishNew() { links++; throw failure(); }, async waitForReplacementRetry() { assert.fail("creation must not wait"); } });
  if (opened.kind !== "opened") throw Error("setup");
  context.after(() => { opened.repository.close(); storage.cleanup(); });
  assert.deepEqual(opened.repository.initialize(), unconfirmed); assert.equal(links, 1);
});

test("retry success still fails if final confirmation cannot read NEW", async context => {
  let calls = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { if (++calls === 1) throw failure(); diagnosticHistoryIO.publishReplacement(from, to); published = true; },
    read(file, observe) { return published ? { kind: "unavailable", code: "storage_unavailable", reason: "snapshot_read_failed" } : diagnosticHistoryIO.read(file, observe); },
  });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(calls, 2);
  assert.equal(diagnosticDurabilityFailure(result)?.stage, "confirmation_read");
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "succeeded");
});

test("already-NEW recovery never bypasses final confirmation", async context => {
  let afterPublicationReads = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; throw failure(); },
    read(file, observe) { if (published && ++afterPublicationReads > 1) return { kind: "missing" }; return diagnosticHistoryIO.read(file, observe); },
  });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(diagnosticDurabilityFailure(result)?.confirmationFailure, "file_missing");
});

test("cleanup failure cannot override exhausted rename failure", async context => {
  const state = fixture(context, { publishReplacement() { throw failure(); }, removeTemporary() { throw failure("EACCES"); } });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); const detail = diagnosticDurabilityFailure(result)!;
  assert.equal(detail.io?.ioCode, "EPERM"); assert.equal(detail.cleanupFailure?.ioCode, "EACCES");
  assert.equal(detail.replacement?.terminalReason, "deadline_exhausted");
});

test("read/close exception during state inspection fails closed without a retry", async context => {
  let failed = false; let attempts = 0;
  const state = fixture(context, {
    publishReplacement() { attempts++; failed = true; throw failure(); },
    read(file, observe) { if (failed) throw Error("close failed"); return diagnosticHistoryIO.read(file, observe); },
  });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "state_changed");
});

test("wait failure terminates without another rename and retains the original candidate", async context => {
  let attempts = 0;
  const state = fixture(context, { publishReplacement() { attempts++; throw failure(); }, async waitForReplacementRetry() { throw Error("wait unavailable"); } });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "wait_failed");
  assert.equal(diagnosticDurabilityFailure(result)?.io?.ioCode, "EPERM");
});

test("untrusted code getter never authorizes retry or escapes IO sanitization", async context => {
  let attempts = 0; let getterCalls = 0;
  const state = fixture(context, { publishReplacement() {
    attempts++; throw Object.defineProperty(Error("private"), "code", { get() { getterCalls++; return "EPERM"; } });
  } });
  const result = (await state.repository.appendCapturedAttempt(capture()));
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.equal(getterCalls, 0);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "non_retryable");
});

for (const failures of [5, 6, 7]) test(`${failures} failures then success at ${DIAGNOSTIC_REPLACEMENT_OFFSETS_MS[failures]}ms admits measured tail without cap preemption`, async context => {
  let calls = 0;
  const state = fixture(context, { publishReplacement(from, to) {
    if (++calls <= failures) throw failure();
    diagnosticHistoryIO.publishReplacement(from, to);
  } });
  const attempt = capture();
  const result = await state.repository.appendCapturedAttempt(attempt);
  assert.equal(result.kind, "committed"); assert.equal(calls, failures + 1);
  assert.deepEqual(state.disk().captures, [attempt]);
  const detail = diagnosticReplacementObservation(result)!;
  assert.equal(detail.firstFailureTimeMs, 100);
  assert.deepEqual(detail.attempts.map(item => item.actualOffsetMs), DIAGNOSTIC_REPLACEMENT_OFFSETS_MS.slice(0, failures + 1));
  assert.equal(detail.attempts.at(-1)?.succeeded, true);
  assert.ok(detail.failures.every(item => item.diskState === "expected_old" && item.beforeRetryState === "expected_old"));
});

for (const drift of [20, 100, 101]) test(`final reserved probe has finite scheduling grace: ${drift}ms drift`, async context => {
  let clock = 0; let calls = 0;
  const state = fixture(context, { replacementNow: () => clock,
    async waitForReplacementRetry(ms) { clock += ms; if (clock === 2000) clock += drift; },
    publishReplacement(from, to) { if (++calls < 9) throw failure(); diagnosticHistoryIO.publishReplacement(from, to); },
  });
  const result = await state.repository.appendCapturedAttempt(capture());
  assert.equal(calls, drift <= 100 ? 9 : 8);
  assert.equal(result.kind, drift <= 100 ? "committed" : "unavailable");
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, drift <= 100 ? "succeeded" : "deadline_exhausted");
});

test("validation consuming the deadline schedules no new wait; already NEW still needs independent confirmation", async context => {
  let clock = 0; let failed = false; let waits = 0; let calls = 0;
  const state = fixture(context, { replacementNow: () => clock,
    publishReplacement() { calls++; failed = true; throw failure(); },
    read(file, observe) { const result = diagnosticHistoryIO.read(file, observe); if (failed) clock = 2000; return result; },
    async waitForReplacementRetry() { waits++; },
  });
  const result = await state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(calls, 1); assert.equal(waits, 0);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "deadline_exhausted");
});

test("attempt ceiling remains finite even when a faulty timer never advances its clock", async context => {
  let calls = 0;
  const state = fixture(context, { replacementNow: () => 0, async waitForReplacementRetry() {},
    publishReplacement() { calls++; throw failure(); } });
  const result = await state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(calls, 9);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "attempt_cap_exhausted");
});

test("temp changed across async wait is revalidated without a second native attempt", async context => {
  let source = ""; let calls = 0;
  const state = fixture(context, { publishReplacement(from) { source = from; calls++; throw failure(); },
    async waitForReplacementRetry() { await Promise.resolve(); writeFileSync(source, "{broken"); },
  });
  const result = await state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(calls, 1);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "temp_invalid");
  assert.equal(diagnosticReplacementObservation(result)?.failures[0].beforeRetryState, "unexpected");
});

test("pending writer rejects interleaving append/read/initialize; close retains path ownership until confirmation", async context => {
  let release!: () => void; let calls = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const state = fixture(context, { async waitForReplacementRetry() { await waiting; },
    publishReplacement(from, to) { if (++calls === 1) throw failure(); diagnosticHistoryIO.publishReplacement(from, to); },
  });
  const attempt = capture(); const pending = state.repository.appendCapturedAttempt(attempt);
  assert.ok(pending instanceof Promise);
  const busy = { kind: "unavailable", code: "storage_unavailable", reason: "operation_in_progress" };
  assert.deepEqual(await state.repository.appendCapturedAttempt(capture("second")), busy);
  assert.deepEqual(state.repository.readCompleteSnapshot(), busy); assert.deepEqual(state.repository.initialize(), busy);
  assert.deepEqual(Reflect.apply(state.repository.readCompleteSnapshot, state.repository, [undefined, true]), busy,
    "public read cannot borrow the private confirmation bypass");
  state.repository.close();
  assert.deepEqual(createDiagnosticHistoryRepository(state.config), { kind: "unavailable", code: "storage_unavailable", reason: "repository_already_open" });
  release(); assert.equal((await pending).kind, "committed"); assert.equal(calls, 2);
  assert.deepEqual(state.disk().captures, [attempt]);
  const reopened = createDiagnosticHistoryRepository(state.config);
  assert.equal(reopened.kind, "opened");
  if (reopened.kind === "opened") { assert.equal(reopened.repository.readCompleteSnapshot().kind, "complete"); reopened.repository.close(); }
});

test("production timer yields to another scheduled task during the measured 1.5s recovery", async context => {
  let calls = 0; let ranDuringWait = false;
  const state = fixture(context, { replacementNow: diagnosticHistoryIO.replacementNow,
    waitForReplacementRetry: diagnosticHistoryIO.waitForReplacementRetry,
    publishReplacement(from, to) {
      if (++calls <= 7) throw failure();
      assert.equal(ranDuringWait, true);
      diagnosticHistoryIO.publishReplacement(from, to);
    },
  });
  const scheduled = new Promise<void>(resolve => setTimeout(() => {
    assert.ok(calls >= 1 && calls < 8, "scheduled task runs before recovery completes"); assert.equal(state.disk().generation, 0);
    ranDuringWait = true; resolve();
  }, 1200));
  const result = await state.repository.appendCapturedAttempt(capture());
  await scheduled;
  assert.equal(result.kind, "committed"); assert.equal(calls, 8);
});
