import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { diagnosticHistoryIO, diagnosticIOFailure } from "./io.ts";
import { createRepositoryRenameFixture, renamePathDetails } from "../../../../test-support/repository-rename-fixture.ts";
import { createRepositoryRenameObservation, renameDigest } from "../../../../test-support/repository-rename-observation.ts";

// 独立按文件执行；本轮不加入 contracts aggregator、hosted CI 或 release gate。
// 只证明生产 IO primitive 的字节替换兼容性；这些合成正文不是学习历史或 durability 证明。
for (const longPath of [false, true]) {
  test(`Windows filesystem ${longPath ? "long" : "short"} native rename compatibility`, t => {
    assert.equal(process.platform, "win32", "invoke this explicit compatibility contract on Windows; no silent skip");
    const owned = createRepositoryRenameFixture(t, longPath ? 280 : undefined);
    const observation = createRepositoryRenameObservation(t, owned, "filesystem");
    const io = { ...diagnosticHistoryIO, ...observation.wrap({}) };
    const oldText = JSON.stringify({ fixture: "filesystem-only", state: "OLD" });
    const newText = JSON.stringify({ fixture: "filesystem-only", state: "NEW" });
    // OLD 准备使用同目录短文件名，避免长候选写入前就把兼容性失败归到 rename。
    const seed = path.join(path.dirname(owned.target), "seed.tmp"), source = `${owned.target}.${randomUUID()}.tmp`;
    let failed = false, primary: unknown, stage = "fixture_prepare";
    try {
      owned.assertOwned(); owned.assertPublication(source, owned.target);
      assert.ok(seed.length < 260, "OLD seed path must stay below the long-path boundary");
      observation.event("path_budget", { source: renamePathDetails(source), destination: renamePathDetails(owned.target),
        mode: longPath ? "source_exceeds_260" : "both_at_most_230", supportsAllHostPaths: false });
      mkdirSync(path.dirname(owned.target), { recursive: true });
      stage = "OLD_seed_write"; io.writeTemporary(seed, oldText);
      stage = "OLD_seed_link"; io.publishNew(seed, owned.target); io.removeTemporary(seed);
      assert.equal(readFileSync(owned.target, "utf8"), oldText);
      stage = "NEW_candidate_write"; io.writeTemporary(source, newText);
      observation.event("before_native_files", {
        canonical: renameDigest(readFileSync(owned.target), "actual_OLD_raw_file_read"),
        candidate: renameDigest(readFileSync(source), "actual_NEW_raw_file_read"),
      });
      stage = "native_rename"; observation.publishStarted(source, owned.target);
      observation.native("native_started", source, owned.target);
      try { io.publishReplacement(source, owned.target); }
      catch (error) {
        observation.native("native_threw", source, owned.target, error);
        // 兼容性失败仍原样 FAIL；独立 OLD 检查即使失败也不能覆盖原 native 异常。
        try {
          const bytes = readFileSync(owned.target);
          const oldIntact = bytes.equals(Buffer.from(oldText));
          observation.event("rejected_native_OLD_check", { oldIntact, canonical: renameDigest(bytes, "post_rejection_actual_file_read") });
          assert.ok(oldIntact, "native refusal changed OLD bytes");
        } catch (integrityError) {
          observation.event("rejected_native_integrity_failure", { ...diagnosticIOFailure(integrityError, "readFileSync") });
        }
        throw error;
      }
      observation.native("native_returned", source, owned.target);
      stage = "NEW_independent_readback";
      assert.equal(readFileSync(owned.target, "utf8"), newText);
      const read = io.read(owned.target);
      assert.equal(read.kind, "record");
      if (read.kind === "record") assert.equal(read.text, newText);
      assert.throws(() => lstatSync(source), (error: unknown) => diagnosticIOFailure(error, "lstatSync").ioCode === "ENOENT");
      observation.settled({ kind: "native_rename_returned_and_NEW_readback_verified" });
    } catch (error) { failed = true; primary = error; observation.event("case_failed", { stage }); throw error; }
    finally {
      // 与生产 primitive 一样尝试 temp cleanup；ENOENT 是 native rename 已消费 source 的预期结果。
      let cleanupError: unknown;
      for (const file of [seed, source]) {
        try { io.removeTemporary(file); }
        catch (error) {
          if (diagnosticIOFailure(error, "unlinkSync").ioCode !== "ENOENT") {
            observation.event("cleanup_failure", { file, ...diagnosticIOFailure(error, "unlinkSync") });
            cleanupError ??= error;
          }
        }
      }
      if (cleanupError !== undefined && !failed) {
        failed = true; primary = cleanupError;
        observation.finish(true, primary);
        throw cleanupError;
      }
      if (observation.finish(failed, primary) && !failed) throw new Error("windows_filesystem_evidence_failure");
    }
  });
}
