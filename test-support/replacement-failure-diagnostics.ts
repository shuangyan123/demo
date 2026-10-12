import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { diagnosticIOFailure } from "../app/server/diagnostic/history/io.ts";

type Digest = { bytes: number; sha256: string };
export const replacementFailureEvidenceIO = {
  read: (file: string) => readFileSync(file),
  list: (directory: string) => readdirSync(directory),
  present: (file: string) => existsSync(file),
  hash: (bytes: string | Buffer): Digest => ({ bytes: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex") }),
  write: (file: string, text: string) => writeFileSync(file, text, { flag: "wx" }),
};
type CollectionFailure = { stage: string; operation: string; ioCode: string | null; syscall: string | null; errno: number | null };

/** 仅合成 contract fixture：不导出正文/异常 message，诊断失败绝不能替换主断言失败。 */
export async function withReplacementFailureEvidence(context: { diagnostic(text: string): void }, state: {
  root: string; file: string; lifecycle: { preserve: boolean }; candidates: Array<{ name: string; text: string }>;
}, details: () => Record<string, unknown>, operation: () => Promise<void>, io = replacementFailureEvidenceIO) {
  const collectionFailures: CollectionFailure[] = [];
  function observe<T>(stage: string, operation: string, read: () => T): T | null {
    try { return read(); }
    catch (error) {
      const safe = diagnosticIOFailure(error, "readFileSync");
      collectionFailures.push({ stage, operation, ioCode: safe.ioCode, syscall: safe.syscall, errno: safe.errno });
      return null;
    }
  }
  function report(text: string) { observe("diagnostic_report", "context.diagnostic", () => context.diagnostic(text)); }
  function reportFailures() {
    for (const failure of [...collectionFailures]) report(`Replacement diagnostic collection failure: ${JSON.stringify(failure)}`);
  }
  const oldText = observe("OLD_read", "readFileSync", () => io.read(state.file));
  const old = oldText === null ? null : observe("OLD_hash", "createHash/update/digest", () => io.hash(oldText));
  try { await operation(); }
  catch (primary) {
    // 在任何诊断 IO 前锁定保留状态，after-hook 即使证据写入失败也不能清理 fixture。
    state.lifecycle.preserve = true;
    report(`Replacement failure fixture preserved: ${state.root}`);
    const listed = observe("directory_enumeration", "readdirSync", () => io.list(path.dirname(state.file))) ?? [];
    const candidates = state.candidates.map(item => ({ name: item.name,
      digest: observe("NEW_hash", "createHash/update/digest", () => io.hash(item.text)) }));
    const names = new Set(["history.json", ...candidates.map(item => item.name), ...listed.map(name => path.basename(name))]);
    const files = [...names].map(name => {
      const file = path.join(path.dirname(state.file), name);
      const present = observe("file_presence", "existsSync", () => io.present(file));
      if (present !== true) return { name, present, bytes: null, sha256: null };
      const text = observe("file_read", "readFileSync", () => io.read(file));
      const digest = text === null ? null : observe("file_hash", "createHash/update/digest", () => io.hash(text));
      return { name, present, bytes: digest?.bytes ?? null, sha256: digest?.sha256 ?? null };
    });
    const observations = observe("repository_observations", "details", details);
    const evidence = { fixtureRoot: state.root, node: process.version, platform: process.platform,
      ...observations, old, candidates, files, collectionFailures,
      lifecycle: "repository closes after test; failed fixture retained without cleanup" };
    const encoded = observe("evidence_encoding", "JSON.stringify", () => JSON.stringify(evidence, null, 2));
    if (encoded !== null) observe("evidence_write", "writeFileSync", () => io.write(path.join(state.root, "failure-evidence.json"), encoded));
    reportFailures();
    throw primary;
  }
  reportFailures();
}
