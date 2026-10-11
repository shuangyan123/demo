import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagnosticIOFailure } from "../app/server/diagnostic/history/io.ts";

const cache = fileURLToPath(new URL("../.cache/", import.meta.url));
const layout = ["os-config", "legacy-profile", "managed-files", "diagnostic-history", "history.json"];
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const uuidTemplate = "00000000-0000-4000-8000-000000000000";
export const RENAME_PATH_BUDGET = 230;

export function renamePathDetails(file: string) {
  return { absolutePath: file, utf16Length: file.length, rootPrefix: path.parse(file).root,
    literalPrefix: file.slice(0, 8), extendedPrefix: file.startsWith("\\\\?\\") };
}

/** 仅测试自有目录；创建前预算，失败明确报错，不修改全局 TEMP 或 Windows 策略。 */
export function createRepositoryRenameFixture(context: { after(fn: () => void): void }, longSourceUnits?: number) {
  try { mkdirSync(cache, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  assert.ok(lstatSync(cache).isDirectory() && !lstatSync(cache).isSymbolicLink(), "fixture cache must be a real directory");
  const parent = realpathSync(cache);
  assert.equal(parent, path.resolve(cache), "fixture cache must not redirect to another directory");
  const root = path.join(parent, `rr-${randomBytes(8).toString("hex")}`);
  let target = path.join(root, ...layout);
  if (longSourceUnits !== undefined) {
    assert.ok(process.platform === "win32" && longSourceUnits > 260, "long-path contract requires Windows");
    const padding = longSourceUnits - `${target}.${uuidTemplate}.tmp`.length - 1;
    assert.ok(padding > 0 && padding <= 200, "cannot construct requested long source within one safe component");
    target = path.join(root, "p".repeat(padding), ...layout);
  }
  const sourceTemplate = `${target}.${uuidTemplate}.tmp`;
  if (longSourceUnits === undefined) {
    assert.ok(target.length <= RENAME_PATH_BUDGET && sourceTemplate.length <= RENAME_PATH_BUDGET,
      `rename fixture path budget exceeded: target=${target.length}, source=${sourceTemplate.length}, limit=${RENAME_PATH_BUDGET}`);
  } else assert.equal(sourceTemplate.length, longSourceUnits);
  mkdirSync(root, { mode: 0o700 }); // 不递归创建 root，不覆盖碰巧存在的目录。
  const ownership = lstatSync(root);
  function assertOwned() {
    assert.equal(path.dirname(root), parent);
    assert.match(path.basename(root), /^rr-[a-f0-9]{16}$/);
    assert.equal(realpathSync(parent), parent);
    const current = lstatSync(root);
    assert.ok(current.isDirectory() && !current.isSymbolicLink(), "fixture root changed type");
    assert.equal(realpathSync(root), root);
    assert.equal(current.dev, ownership.dev); assert.equal(current.ino, ownership.ino);
  }
  context.after(() => {
    assertOwned(); // 所有权失效时停止，不能递归删除未知目录。
    rmSync(root, { recursive: true, force: false });
  });
  function assertPublication(from: string, to: string) {
    // rename 关键窗口只做字符串检查；磁盘所有权检查放在准备及 cleanup 边界。
    assert.equal(to, target, "unexpected canonical publication target");
    assert.ok(path.isAbsolute(from) && from.startsWith(`${target}.`) && from.endsWith(".tmp"));
    assert.match(from.slice(target.length + 1, -4), uuidPattern);
    assert.equal(path.dirname(from), path.dirname(target));
    assert.equal(from.length, sourceTemplate.length);
    if (longSourceUnits === undefined) {
      assert.ok(from.length <= RENAME_PATH_BUDGET && to.length <= RENAME_PATH_BUDGET);
    }
  }
  function assertRegularOwnedFile(file: string) {
    assertOwned();
    assert.ok(file.startsWith(`${root}${path.sep}`) && path.resolve(file) === file);
    let directory = path.dirname(file);
    while (directory !== root) {
      const state = lstatSync(directory);
      assert.ok(state.isDirectory() && !state.isSymbolicLink(), "fixture parent is not an owned directory");
      directory = path.dirname(directory);
    }
    const state = lstatSync(file);
    assert.ok(state.isFile() && !state.isSymbolicLink(), "fixture file is not regular");
  }
  /** 测试状态构造：真实候选字节、写入/flush、独立回读；不证明原子 rename 或崩溃一致性。 */
  function establishCanonicalNew(from: string, to: string,
    onFailure: (error: unknown, operation: "lstatSync" | "readFileSync" | "writeFileSync" | "unlinkSync") => void) {
    let operation: "lstatSync" | "readFileSync" | "writeFileSync" | "unlinkSync" = "lstatSync";
    try {
      assertPublication(from, to);
      assertRegularOwnedFile(from); assertRegularOwnedFile(to);
      operation = "readFileSync"; const candidateBytes = readFileSync(from);
      operation = "writeFileSync"; writeFileSync(to, candidateBytes, { flag: "w", flush: true });
      operation = "readFileSync"; const confirmedBytes = readFileSync(to);
      assert.ok(confirmedBytes.equals(candidateBytes), "controlled NEW independent raw-byte readback mismatch");
      // 模拟 native rename 已消费 source：只删除重新核验的独占候选，unlink 错误不能当作成功。
      operation = "lstatSync"; assertRegularOwnedFile(from);
      operation = "unlinkSync"; unlinkSync(from);
      operation = "lstatSync";
      let sourceAbsence: (ReturnType<typeof diagnosticIOFailure> & {
        file: string; exists: false; origin: "post_unlink_lstatSync";
      }) | undefined;
      try { lstatSync(from); }
      catch (error) {
        const detail = diagnosticIOFailure(error, "lstatSync");
        if (detail.ioCode !== "ENOENT") throw error;
        sourceAbsence = { ...detail, file: from, exists: false, origin: "post_unlink_lstatSync" };
      }
      assert.ok(sourceAbsence, "controlled NEW source still exists after unlink");
      return { candidateBytes, confirmedBytes, sourceAbsence };
    } catch (error) {
      try { onFailure(error, operation); } catch { /* 观察失败不能替换原始准备错误。 */ }
      throw error;
    }
  }
  return { root, target, sourceTemplate, assertOwned, assertPublication, establishCanonicalNew };
}
export type RepositoryRenameFixture = ReturnType<typeof createRepositoryRenameFixture>;
