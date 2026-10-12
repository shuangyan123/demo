import { createHash, randomUUID } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagnosticHistoryIO, diagnosticIOFailure, diagnosticReplacementObservation, diagnosticDurabilityFailure,
  type DiagnosticHistoryIO, type DiagnosticIOOperation } from "../app/server/diagnostic/history/io.ts";
import { encodeDiagnosticSnapshot, parseDiagnosticSnapshot } from "../app/server/diagnostic/history/record.ts";
import { renamePathDetails, type RepositoryRenameFixture } from "./repository-rename-fixture.ts";

export function renameDigest(bytes: string | Buffer, origin: string) {
  return { origin, bytes: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sha256Basis: Buffer.isBuffer(bytes) ? "raw_file_bytes" : "utf8_encoding_of_text" };
}
function inventory(root: string): Array<{ relativePath: string; bytes: number; sha256: string }> {
  return readdirSync(root).sort().flatMap(name => {
    const file = path.join(root, name), state = lstatSync(file);
    if (state.isSymbolicLink()) throw new Error("evidence_symlink_rejected");
    if (state.isDirectory()) return inventory(file).map(item => ({ ...item, relativePath: path.join(name, item.relativePath) }));
    if (!state.isFile()) throw new Error("evidence_non_regular_file");
    const digest = renameDigest(readFileSync(file), "actual_file_read");
    return [{ relativePath: name, bytes: digest.bytes, sha256: digest.sha256 }];
  });
}

/** 目标用例专用：透明代理真实 IO；关键窗口仅内存记录，结束后才解析、哈希、取证。 */
export function createRepositoryRenameObservation(context: { diagnostic(text: string): void },
  fixture: RepositoryRenameFixture, mode: "controlled_new" | "native_recovery" | "filesystem") {
  const started = performance.now(), events: Record<string, unknown>[] = [];
  const reads: { file: string; phase: string; result: ReturnType<DiagnosticHistoryIO["read"]> }[] = [];
  const waits: number[] = [];
  let candidate: string | undefined, temporary = "", attempts = 0, nativeAttempts = 0, syntheticCount = 0;
  let identity: { profileId: string; epochId: string } | undefined;
  let result: { kind: string } | undefined;
  const event = (kind: string, detail: Record<string, unknown> = {}) => {
    events.push({ sequence: events.length + 1, elapsedMs: performance.now() - started, kind, ...detail });
  };
  function native(kind: "native_started" | "native_returned" | "native_threw", from: string, to: string, error?: unknown) {
    if (kind === "native_started") nativeAttempts++;
    event(kind, { attempt: attempts, from: renamePathDetails(from), to: renamePathDetails(to),
      ...(kind === "native_threw" ? diagnosticIOFailure(error, "renameSync") : {}) });
  }
  function wrap(override: Partial<DiagnosticHistoryIO>): Partial<DiagnosticHistoryIO> {
    return { ...override,
      read(file, observe) {
        const phase = observe ? "confirmation" : attempts ? "replacement_gate" : "append_base";
        try {
          const read = diagnosticHistoryIO.read(file, failure => { event("native_IO_failure", { file, phase, ...failure }); observe?.(failure); });
          reads.push({ file, phase, result: read }); return read;
        } catch (error) { event("read_threw", { file, phase, ...diagnosticIOFailure(error, "readFileSync") }); throw error; }
      },
      writeTemporary(file, text) {
        temporary = file; candidate = text; event("memory_write_input", { file });
        try { diagnosticHistoryIO.writeTemporary(file, text); event("write_and_flush_returned", { file }); }
        catch (error) { event("write_or_flush_threw", { file, ...diagnosticIOFailure(error, "writeFileSync") }); throw error; }
      },
      waitForReplacementRetry(milliseconds) {
        waits.push(milliseconds); event("wait_requested", { milliseconds });
        return (override.waitForReplacementRetry ?? diagnosticHistoryIO.waitForReplacementRetry)(milliseconds);
      },
      removeTemporary(file) {
        try { diagnosticHistoryIO.removeTemporary(file); event("unlink_returned", { file }); }
        catch (error) { event("unlink_threw", { file, ...diagnosticIOFailure(error, "unlinkSync") }); throw error; }
      },
    };
  }
  function finish(failed: boolean, primary: unknown): boolean {
    if (!failed && process.env.RECALL_TEST_REPOSITORY_RENAME_OBSERVE !== "1" && mode !== "filesystem") return false;
    const evidenceFailures: Record<string, unknown>[] = [];
    const failure = (stage: string, error: unknown, operation: DiagnosticIOOperation = "readFileSync") => {
      evidenceFailures.push({ stage, ...diagnosticIOFailure(error, operation) });
    };
    let directory: string | undefined, written = false;
    let preservation: Record<string, unknown> = { status: failed ? "NOT_ATTEMPTED" : "NOT_NEEDED" };
    try {
      directory = fileURLToPath(new URL(`../.cache/repository-rename-contract-evidence-${randomUUID()}/`, import.meta.url));
      mkdirSync(directory);
      if (failed) {
        try {
          fixture.assertOwned();
          const before = inventory(fixture.root), destination = path.join(directory, "fixture");
          cpSync(fixture.root, destination, { recursive: true, force: false, errorOnExist: true, dereference: false });
          const after = inventory(destination);
          if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("fixture_copy_hash_mismatch");
          preservation = { status: "COPY_HASH_VERIFIED", source: fixture.root, destination, files: after };
        } catch (error) { failure("fixture_preservation", error); preservation = { status: "FAILED", destinationMayBePartial: true }; }
      }
      const canonical = (text: string | undefined) => {
        if (!identity || text === undefined) return null;
        const parsed = parseDiagnosticSnapshot(text, identity);
        return parsed.kind === "complete" ? encodeDiagnosticSnapshot(parsed.snapshot) : null;
      };
      const base = reads.find(read => read.phase === "append_base" && read.file === fixture.target && read.result.kind === "record");
      const old = canonical(base?.result.kind === "record" ? base.result.text : undefined), next = canonical(candidate);
      function diskFile(file: string) {
        let operation: DiagnosticIOOperation = "lstatSync";
        let exists: boolean | null = null;
        try {
          const state = lstatSync(file);
          exists = true;
          if (!state.isFile() || state.isSymbolicLink()) throw new Error("post_settlement_non_regular_file");
          operation = "readFileSync";
          return { ...renamePathDetails(file), existenceOrigin: "post_settlement_lstatSync", exists: true,
            content: renameDigest(readFileSync(file), "post_settlement_actual_file_read") };
        } catch (error) {
          const safe = diagnosticIOFailure(error, operation);
          if (operation !== "lstatSync" || safe.ioCode !== "ENOENT") failure("post_settlement_file", error, operation);
          return { ...renamePathDetails(file), existenceOrigin: "post_settlement_lstatSync",
            exists: operation === "lstatSync" && safe.ioCode === "ENOENT" ? false : exists, failure: safe };
        }
      }
      const replacement = result ? diagnosticReplacementObservation(result) : null;
      const primaryMetadata = diagnosticIOFailure(primary, "renameSync");
      const gateClass = (state: string | null) => state === "expected_new" ? "NEW"
        : state === "expected_old" ? "OLD" : state === null ? "NOT_CHECKED" : "INVALID";
      const report = { schema: "repository-rename-observation/v2", mode, failed, node: process.version, platform: process.platform,
        elapsedMs: performance.now() - started, primaryError: failed ? { origin: "test_case_exception_not_native_attribution",
          ioCode: primaryMetadata.ioCode, syscall: primaryMetadata.syscall, errno: primaryMetadata.errno } : null,
        attempts, nativeAttempts, syntheticCount, waits, resultKind: result?.kind ?? "NOT_RETURNED",
        replacement, durabilityFailure: result ? diagnosticDurabilityFailure(result) : null,
        productionDiskGates: replacement?.failures.map(item => ({ attempt: item.attempt, afterFailure: item.diskState,
          afterFailureClassification: gateClass(item.diskState), beforeRetry: item.beforeRetryState,
          beforeRetryClassification: gateClass(item.beforeRetryState), origin: "production_strict_snapshot_gate" })) ?? [],
        confirmationReadCount: reads.filter(read => read.phase === "confirmation").length,
        paths: [fixture.root, fixture.target, temporary].filter(Boolean).map(renamePathDetails),
        candidate: candidate === undefined ? null : renameDigest(candidate, "memory_write_input_not_a_file_read"),
        reads: reads.map(read => ({ file: read.file, phase: read.phase, kind: read.result.kind,
          ...(read.result.kind === "record" ? { content: renameDigest(read.result.text, "production_real_read_decoded_text"),
            classification: !identity ? "NOT_CHECKED" : canonical(read.result.text) === next && next !== null ? "NEW"
              : canonical(read.result.text) === old && old !== null ? "OLD" : "INVALID",
            classificationOrigin: "post_settlement_reconstruction_not_production_gate" } : {}) })),
        files: [fixture.target, temporary].filter(Boolean).map(diskFile), events, preservation, evidenceFailures,
        limits: ["decoded read hashes re-encode UTF-8; raw file hashes are separate", "successful read records aggregate IO, not individual open/close syscalls",
          "fixture copy occurs after production temporary cleanup, before normal test cleanup", "controlled NEW does not prove atomic rename, crash consistency or full durability",
          "Node error metadata does not expose Win32 GetLastError"] };
      writeFileSync(path.join(directory, "observation.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); written = true;
    } catch (error) { failure("evidence_collection_or_write", error, "writeFileSync"); }
    try { context.diagnostic(JSON.stringify({ repositoryRenameEvidence: directory, written, preservation, evidenceFailures })); }
    catch (error) { failure("diagnostic_output", error); }
    return evidenceFailures.length !== 0;
  }
  return { wrap, native, event, finish,
    bind(value: { profileId: string; epochId: string }) { identity = value; },
    publishStarted(from: string, to: string) { attempts++; fixture.assertPublication(from, to); event("publish_attempt", { attempt: attempts }); },
    synthetic() { syntheticCount++; event("synthetic_EPERM", { count: syntheticCount }); },
    settled(value: { kind: string }) { result = value; event("settled", { resultKind: value.kind }); },
    summary: () => ({ nativeAttempts, syntheticCount, waitCount: waits.length, confirmationReadCount: reads.filter(read => read.phase === "confirmation").length }),
  };
}
