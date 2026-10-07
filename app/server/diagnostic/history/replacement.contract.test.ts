import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { diagnosticStorageFixture } from "../../../../test-support/diagnostic-storage.ts";
import { createControlledDiagnosticCaptureMechanism } from "../../../services/first-party-diagnostic/capture-authority-core.ts";
import { createDiagnosticHistoryRepository } from "./repository-core.ts";
import { diagnosticHistoryIO, diagnosticDurabilityFailure, diagnosticReplacementObservation, type DiagnosticHistoryIO } from "./io.ts";
import { encodeDiagnosticSnapshot, parseDiagnosticSnapshot } from "./record.ts";
import type { DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import { DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET, DIAGNOSTIC_REPLACEMENT_DELAYS_MS } from "./replacement.ts";

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
function fixture(context: { after(fn: () => void): void }, override: Partial<DiagnosticHistoryIO> = {}) {
  const storage = diagnosticStorageFixture();
  const waits: number[] = [];
  const opened = createDiagnosticHistoryRepository(storage.config, { ...diagnosticHistoryIO,
    replacementPlatform: "win32", waitForReplacementRetry(ms) { waits.push(ms); }, ...override });
  if (opened.kind !== "opened") throw Error("repository setup");
  const repository = opened.repository;
  context.after(() => { repository.close(); storage.cleanup(); });
  assert.equal(repository.initialize().kind, "complete");
  return { ...storage, repository, waits, disk: () => JSON.parse(readFileSync(storage.file, "utf8")) };
}

test("replacement succeeds on first attempt; normal confirmation and exact capture facts remain unchanged", context => {
  let readsAfterPublication = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; },
    read(file, observe) { if (published) readsAfterPublication++; return diagnosticHistoryIO.read(file, observe); },
  });
  const attempt = capture();
  const result = state.repository.appendCapturedAttempt(attempt);
  assert.equal(result.kind, "committed"); assert.equal(readsAfterPublication, 1); assert.deepEqual(state.waits, []);
  assert.deepEqual(state.disk().captures, [attempt]); assert.equal(state.disk().generation, 1);
  assert.equal(diagnosticReplacementObservation(result)?.attemptCount, 1);
  assert.deepEqual(diagnosticReplacementObservation(result)?.failures, []);
  assert.deepEqual(Object.keys(result).sort(), ["kind", "snapshot"]);
});

for (const code of ["EPERM", "EBUSY", "EACCES"]) for (const failures of [1, 2, 3]) {
  test(`${code} ${failures} times then success: every retry revalidates OLD and NEW, one canonical commit`, context => {
    let attempts = 0; let temporary: string | undefined; const reads: string[] = [];
    const state = fixture(context, {
      publishReplacement(from, to) {
        temporary ??= from; assert.equal(from, temporary, "same temp is reused");
        attempts++; if (attempts <= failures) throw failure(code);
        diagnosticHistoryIO.publishReplacement(from, to);
      },
      read(file, observe) { reads.push(file); return diagnosticHistoryIO.read(file, observe); },
    });
    const attempt = capture(); const result = state.repository.appendCapturedAttempt(attempt);
    assert.equal(result.kind, "committed"); assert.equal(attempts, failures + 1);
    assert.deepEqual(state.waits, DIAGNOSTIC_REPLACEMENT_DELAYS_MS.slice(0, failures));
    assert.deepEqual(state.disk().captures, [attempt]); assert.equal(state.disk().generation, 1);
    const detail = diagnosticReplacementObservation(result)!;
    assert.equal(detail.terminalReason, "succeeded"); assert.equal(detail.attemptBudget, 4); assert.equal(detail.waitBudgetMs, 500);
    assert.ok(detail.failures.every(item => item.io.ioCode === code && item.diskState === "expected_old" && item.beforeRetryState === "expected_old"));
    assert.equal(reads.filter(file => file === temporary).length, failures * 2, "temp checked after failure and after wait");
    assert.ok(Object.isFrozen(detail) && Object.isFrozen(detail.failures) && detail.failures.every(Object.isFrozen));
    assert.doesNotMatch(JSON.stringify(detail), /private|selectedOptionId|history\.json/);
  });
}

test("permanent EPERM exhausts exactly four attempts and 500ms wait budget, OLD remains valid and cleanup is secondary", context => {
  let attempts = 0;
  const state = fixture(context, { publishReplacement() { attempts++; throw failure(); } });
  const before = readFileSync(state.file, "utf8"); const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET);
  assert.deepEqual(state.waits, [50, 150, 300]); assert.equal(readFileSync(state.file, "utf8"), before);
  assert.equal(state.repository.readCompleteSnapshot().kind, "complete");
  assert.deepEqual(readdirSync(path.dirname(state.file)), ["history.json"]);
  const detail = diagnosticDurabilityFailure(result)!;
  assert.equal(detail.replacement?.terminalReason, "retry_exhausted"); assert.equal(detail.replacement?.failures.length, 4);
  assert.equal(detail.stage, "replacement_rename"); assert.equal(detail.io?.ioCode, "EPERM");
});

test("reported EPERM after native publication accepts exact NEW, no second rename or temp required, still confirms", context => {
  let attempts = 0; let readsAfterPublication = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { attempts++; diagnosticHistoryIO.publishReplacement(from, to); published = true; throw failure(); },
    read(file, observe) { if (published) readsAfterPublication++; return diagnosticHistoryIO.read(file, observe); },
  });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.equal(result.kind, "committed"); assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
  assert.equal(readsAfterPublication, 2, "strict recovery read plus existing commit confirmation");
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "already_published");
  assert.equal(diagnosticReplacementObservation(result)?.failures[0].diskState, "expected_new");
});

for (const damage of ["other_generation", "same_generation_content", "malformed", "missing", "profile", "epoch", "integrity", "unsupported", "capacity"] as const) {
  test(`EPERM with unexpected target ${damage} never retries or overwrites it`, context => {
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
    if (damage === "same_generation_content") assert.equal(state.repository.appendCapturedAttempt(capture("base")).kind, "committed");
    armed = true;
    const result = state.repository.appendCapturedAttempt(capture());
    assert.deepEqual(result, unconfirmed); assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "state_changed");
    if (damage === "other_generation" || damage === "same_generation_content")
      assert.equal(parseDiagnosticSnapshot(unexpected, state.config).kind, "complete", "unexpected target is valid, not merely malformed");
    assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
    if (damage === "missing") assert.equal(existsSync(state.file), false); else assert.equal(readFileSync(state.file, "utf8"), unexpected);
  });
}

for (const damage of ["missing", "malformed", "wrong_capture", "wrong_profile", "wrong_generation", "integrity"] as const) {
  test(`EPERM with temp ${damage} fails closed without retry`, context => {
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
    const before = readFileSync(state.file, "utf8"); const result = state.repository.appendCapturedAttempt(capture());
    assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
    assert.equal(readFileSync(state.file, "utf8"), before); assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "temp_invalid");
  });
}

test("state changing during wait is revalidated before retry", context => {
  let target = ""; let attempts = 0;
  const state = fixture(context, {
    publishReplacement(_from, to) { target = to; attempts++; throw failure(); },
    waitForReplacementRetry() { const value = payload(target); writeFileSync(target, encodeDiagnosticSnapshot({ ...value, generation: 1, captures: [capture("other")] })); },
  });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1);
  assert.equal(diagnosticReplacementObservation(result)?.failures[0].beforeRetryState, "unexpected");
});

test("exact NEW appearing during wait is accepted and confirmed without a second rename", context => {
  let source = ""; let target = ""; let attempts = 0;
  const state = fixture(context, {
    publishReplacement(from, to) { source = from; target = to; attempts++; throw failure(); },
    waitForReplacementRetry() { diagnosticHistoryIO.publishReplacement(source, target); },
  });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.equal(result.kind, "committed"); assert.equal(attempts, 1);
  assert.equal(diagnosticReplacementObservation(result)?.failures[0].beforeRetryState, "expected_new");
});

for (const code of ["ENOSPC", "EIO", "ENOENT", "EINVAL", "EROFS", "EEXIST"]) {
  test(`${code} never retries or runs recovery reads`, context => {
    let attempts = 0; let reads = 0;
    const state = fixture(context, {
      publishReplacement() { attempts++; throw failure(code); },
      read(file, observe) { reads++; return diagnosticHistoryIO.read(file, observe); },
    });
    reads = 0; const result = state.repository.appendCapturedAttempt(capture());
    assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.equal(reads, 1); assert.deepEqual(state.waits, []);
    assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "non_retryable");
  });
}

test("non-Windows replacement retains one attempt even for EPERM", context => {
  let attempts = 0;
  const state = fixture(context, { replacementPlatform: "linux", publishReplacement() { attempts++; throw failure(); } });
  assert.deepEqual(state.repository.appendCapturedAttempt(capture()), unconfirmed); assert.equal(attempts, 1); assert.deepEqual(state.waits, []);
});

test("initial link failure is never retried", context => {
  const storage = diagnosticStorageFixture(); let links = 0;
  const opened = createDiagnosticHistoryRepository(storage.config, { ...diagnosticHistoryIO,
    publishNew() { links++; throw failure(); }, waitForReplacementRetry() { assert.fail("creation must not wait"); } });
  if (opened.kind !== "opened") throw Error("setup");
  context.after(() => { opened.repository.close(); storage.cleanup(); });
  assert.deepEqual(opened.repository.initialize(), unconfirmed); assert.equal(links, 1);
});

test("retry success still fails if final confirmation cannot read NEW", context => {
  let calls = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { if (++calls === 1) throw failure(); diagnosticHistoryIO.publishReplacement(from, to); published = true; },
    read(file, observe) { return published ? { kind: "unavailable", code: "storage_unavailable", reason: "snapshot_read_failed" } : diagnosticHistoryIO.read(file, observe); },
  });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(calls, 2);
  assert.equal(diagnosticDurabilityFailure(result)?.stage, "confirmation_read");
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "succeeded");
});

test("already-NEW recovery never bypasses final confirmation", context => {
  let afterPublicationReads = 0; let published = false;
  const state = fixture(context, {
    publishReplacement(from, to) { diagnosticHistoryIO.publishReplacement(from, to); published = true; throw failure(); },
    read(file, observe) { if (published && ++afterPublicationReads > 1) return { kind: "missing" }; return diagnosticHistoryIO.read(file, observe); },
  });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(diagnosticDurabilityFailure(result)?.confirmationFailure, "file_missing");
});

test("cleanup failure cannot override exhausted rename failure", context => {
  const state = fixture(context, { publishReplacement() { throw failure(); }, removeTemporary() { throw failure("EACCES"); } });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); const detail = diagnosticDurabilityFailure(result)!;
  assert.equal(detail.io?.ioCode, "EPERM"); assert.equal(detail.cleanupFailure?.ioCode, "EACCES");
  assert.equal(detail.replacement?.terminalReason, "retry_exhausted");
});

test("read/close exception during state inspection fails closed without a retry", context => {
  let failed = false; let attempts = 0;
  const state = fixture(context, {
    publishReplacement() { attempts++; failed = true; throw failure(); },
    read(file, observe) { if (failed) throw Error("close failed"); return diagnosticHistoryIO.read(file, observe); },
  });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "state_changed");
});

test("wait failure terminates without another rename and retains the original candidate", context => {
  let attempts = 0;
  const state = fixture(context, { publishReplacement() { attempts++; throw failure(); }, waitForReplacementRetry() { throw Error("wait unavailable"); } });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "wait_failed");
  assert.equal(diagnosticDurabilityFailure(result)?.io?.ioCode, "EPERM");
});

test("untrusted code getter never authorizes retry or escapes IO sanitization", context => {
  let attempts = 0; let getterCalls = 0;
  const state = fixture(context, { publishReplacement() {
    attempts++; throw Object.defineProperty(Error("private"), "code", { get() { getterCalls++; return "EPERM"; } });
  } });
  const result = state.repository.appendCapturedAttempt(capture());
  assert.deepEqual(result, unconfirmed); assert.equal(attempts, 1); assert.equal(getterCalls, 0);
  assert.equal(diagnosticReplacementObservation(result)?.terminalReason, "non_retryable");
});
