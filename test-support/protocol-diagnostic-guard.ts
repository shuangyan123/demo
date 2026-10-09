import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDiagnosticStorageConfig } from "../app/server/diagnostic/storage-config.ts";
import { parseStorageRecord } from "../desktop/storage-bootstrap-record.ts";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ownerFile = (root: string) => path.join(root, "protocol-test-owner.json");
const ownerRecord = (root: string, token: string, parentPid: number) => ({ kind: "recall_protocol_test_fixture_v1",
  parentPid, fixtureRoot: root, tokenSha256: createHash("sha256").update(token).digest("hex") });

/** 仅父 contract 对自己刚创建的 fixture 显式授权；随机测试凭据不写入 owner record。 */
export function protocolBackendInvocation(root: string, token: string) {
  assertDisposableRoot(root);
  if (!TOKEN.test(token)) throw new Error("protocol_test_token_required");
  writeFileSync(ownerFile(root), JSON.stringify(ownerRecord(root, token, process.pid)), { flag: "wx", mode: 0o600 });
  return { kind: "recall_protocol_test_init_v1", parentPid: process.pid, fixtureRoot: root, token };
}

function assertRegular(location: string, directory: boolean) {
  const info = lstatSync(location);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())
    || realpathSync(location) !== location) throw new Error("protocol_test_unsafe_fixture");
  if (!directory && info.size > 8192) throw new Error("protocol_test_invalid_fixture_record");
}
function assertDisposableRoot(root: string) {
  // 先检查 lexical allowlist，真实用户路径不能进入任何文件读取或 repository 初始化。
  if (path.resolve(root) !== root || path.dirname(root) !== path.resolve(os.tmpdir())
    || !/^recall-durable-submission-test-[A-Za-z0-9]{6}$/.test(path.basename(root)))
    throw new Error("protocol_test_unsafe_fixture");
  assertRegular(root, true);
}

export function protocolRequestAuthorized(supplied: unknown, token: string | undefined): boolean {
  return typeof token === "string" && TOKEN.test(token) && typeof supplied === "string" && TOKEN.test(supplied)
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}

/** 必须在 initializeDiagnosticRuntime 前调用；ambient config 自身不授予测试权限。 */
export function authorizeProtocolDiagnosticBackend(message: unknown, context: {
  connected: boolean; parentPid: number; token: string | undefined; payload: string | undefined;
}) {
  if (!context.connected || !message || typeof message !== "object" || Array.isArray(message))
    throw new Error("protocol_test_authorization_required");
  const value = message as Record<string, unknown>;
  if (Object.keys(value).length !== 4 || value.kind !== "recall_protocol_test_init_v1"
    || value.parentPid !== context.parentPid || typeof value.fixtureRoot !== "string")
    throw new Error("protocol_test_authorization_required");
  if (!protocolRequestAuthorized(value.token, context.token)) throw new Error("protocol_test_token_required");
  const root = value.fixtureRoot;
  assertDisposableRoot(root);
  const parsed = parseDiagnosticStorageConfig(context.payload);
  const appData = path.join(root, "os-config"), profile = path.join(appData, "test-profile");
  if (parsed.kind !== "configured" || parsed.config.managedRoot !== profile || parsed.config.profileRoot !== profile
    || parsed.config.managedFilesRoot !== path.join(profile, "managed-files")) throw new Error("protocol_test_invalid_layout");
  for (const directory of [appData, profile, path.join(profile, ".recall-storage"), path.join(appData, "recall-storage")])
    assertRegular(directory, true);
  for (const directory of [parsed.config.managedFilesRoot, path.join(parsed.config.managedFilesRoot, "diagnostic-history")]) {
    try { assertRegular(directory, true); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  assertRegular(ownerFile(root), false);
  if (readFileSync(ownerFile(root), "utf8") !== JSON.stringify(ownerRecord(root, context.token!, context.parentPid)))
    throw new Error("protocol_test_fixture_not_owned");
  const anchor = path.join(profile, ".recall-storage/identity.json"), bootstrap = path.join(appData, "recall-storage/bootstrap.json");
  assertRegular(anchor, false); assertRegular(bootstrap, false);
  const identity = parseStorageRecord(readFileSync(anchor, "utf8"), false);
  const record = parseStorageRecord(readFileSync(bootstrap, "utf8"), true);
  if (identity.kind !== "valid" || record.kind !== "valid" || !("activeManagedRoot" in record.record)
    || record.record.activeManagedRoot !== profile || record.record.profileLayout !== "legacy-root"
    || [identity.record, record.record].some(item => item.profileId !== parsed.config.profileId || item.epochId !== parsed.config.epochId))
    throw new Error("protocol_test_invalid_fixture_identity");
  return { token: context.token!, config: parsed.config };
}
