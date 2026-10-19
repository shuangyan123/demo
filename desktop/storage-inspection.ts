import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { isCanonicalStoragePath } from "./storage-bootstrap-record.ts";
import type { StorageHostPaths } from "./storage-bootstrap.ts";

function exists(target: string): boolean {
  try { lstatSync(target); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** 任一 Recall namespace 残留都不是首次创建许可；不解析 captures 来猜 Host identity。 */
export function hasUnanchoredStorage(paths: StorageHostPaths): boolean {
  return [path.join(paths.appData, "recall-storage"), path.join(paths.defaultUserData, ".recall-storage"),
    path.join(paths.defaultUserData, "managed-files")].some(exists);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

/** 仅识别已实测的 Windows Electron 43 首次运行残留；字段、文件名都不是 Recall authority。
 * 不解密/传播 key、不重写文件；未知字段、非规范 JSON、link 与非空锁一律拒绝。
 */
function initialRuntimeEntryBinding(profile: string, entry: string): string | undefined {
  if (process.platform !== "win32" || !["lockfile", "Local State", "DevToolsActivePort"].includes(entry)) return;
  const file = path.join(profile, entry); const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) return;
  if (entry === "lockfile") return stat.size === BigInt(0) ? "empty_runtime_lock" : undefined;
  if (stat.size === BigInt(0) || stat.size > BigInt(4096)) return;
  const bytes = readFileSync(file); const text = bytes.toString("utf8");
  const after = lstatSync(file, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino
    || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs
    || BigInt(bytes.length) !== stat.size || !Buffer.from(text, "utf8").equals(bytes)) return;
  if (entry === "DevToolsActivePort") {
    // Electron 43 的 CDP 启动器交给 Chromium 写入：十进制端口 + 换行 + browser UUID 路径。
    // 不接受 URL、额外行、任意内容或仅凭文件名的例外；该记录不提供 profile identity。
    const port = /^([1-9][0-9]{0,4})\n\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.exec(text);
    return stat.size <= BigInt(64) && port && Number(port[1]) <= 65535
      ? createHash("sha256").update(bytes).digest("hex") : undefined;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return; }
  // Chromium 写入紧凑 JSON；round-trip 同时拒绝被 JSON.parse 隐藏的重复字段。
  if (JSON.stringify(value) !== text.trim() || !exactKeys(value, ["os_crypt", "uninstall_metrics"])
    || !exactKeys(value.os_crypt, ["audit_enabled", "encrypted_key"])
    || !exactKeys(value.uninstall_metrics, ["installation_date2"])) return;
  const crypt = value.os_crypt; const installation = value.uninstall_metrics.installation_date2;
  if (typeof crypt.audit_enabled !== "boolean" || typeof crypt.encrypted_key !== "string"
    || typeof installation !== "string" || !/^[0-9]{1,20}$/.test(installation)) return;
  const key = Buffer.from(crypt.encrypted_key, "base64");
  if (key.length <= 5 || key.toString("base64") !== crypt.encrypted_key || key.subarray(0, 5).toString("ascii") !== "DPAPI") return;
  // Chromium 可延后首次落盘、原子替换文件或更新 audit flag；已有 key/date 仍不能被静默换掉。
  return createHash("sha256").update(JSON.stringify([crypt.encrypted_key, installation])).digest("hex");
}

export function isInitialRuntimeEntry(profile: string, entry: string): boolean {
  return initialRuntimeEntryBinding(profile, entry) !== undefined;
}

/** Runtime-only 文件不证明历史新旧；仍需无 Recall 残留、Main 明确授权及重新检查。 */
export type InitialProfileRejection = "profile_not_directory" | "local_state_invalid" | "runtime_lock_invalid"
  | "debug_port_record_invalid" | "historical_partition_present" | "unknown_profile_entry";
export function initialProfileRejection(profile: string): InitialProfileRejection | undefined {
  if (!exists(profile)) return;
  if (!lstatSync(profile).isDirectory()) return "profile_not_directory";
  for (const entry of readdirSync(profile)) {
    if (isInitialRuntimeEntry(profile, entry)) continue;
    if (entry === "Local State") return "local_state_invalid";
    if (entry === "lockfile") return "runtime_lock_invalid";
    if (entry === "DevToolsActivePort") return "debug_port_record_invalid";
    return entry === "Partitions" ? "historical_partition_present" : "unknown_profile_entry";
  }
}
export function isPristineProfile(profile: string): boolean {
  return initialProfileRejection(profile) === undefined;
}

export type InitialProfileBinding = Readonly<{ directories: readonly string[]; localState?: string; debugPort?: string }>;

/** 目录身份与运行时状态分离；Local State 缺失可转为已识别状态，已有安全材料仍保留绑定。 */
export function initialProfileBinding(paths: StorageHostPaths): InitialProfileBinding {
  const directories = storagePathBinding(paths);
  let localState: string | undefined;
  if (exists(path.join(paths.defaultUserData, "Local State"))) {
    localState = initialRuntimeEntryBinding(paths.defaultUserData, "Local State");
    if (!localState) throw new Error("unsafe_initial_runtime_file");
  }
  let debugPort: string | undefined;
  if (exists(path.join(paths.defaultUserData, "DevToolsActivePort"))) {
    debugPort = initialRuntimeEntryBinding(paths.defaultUserData, "DevToolsActivePort");
    if (!debugPort) throw new Error("unsafe_initial_runtime_file");
  }
  return Object.freeze({ directories, localState, debugPort });
}

/** 绑定已存在的 Host ancestors；拒绝 junction/symlink 和可观察的位置替换。
 * 不是针对恶意并发 OS owner 的无竞态保证；仍依赖既有单 writer 假设。
 */
export function storagePathBinding(paths: StorageHostPaths): readonly string[] {
  if (!Object.values(paths).every(isCanonicalStoragePath) || paths.defaultUserData !== paths.defaultSessionData)
    throw new Error("invalid_host_paths");
  const relative = path.relative(paths.defaultUserData, path.join(paths.appData, "recall-storage"));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
    throw new Error("bootstrap_inside_profile");
  const directories = new Set<string>();
  for (const target of [paths.appData, path.dirname(paths.defaultUserData)]) {
    for (let directory = target; ; directory = path.dirname(directory)) {
      directories.add(directory);
      if (directory === path.dirname(directory)) break;
    }
  }
  if (exists(paths.defaultUserData)) directories.add(paths.defaultUserData);
  for (const directory of [path.join(paths.defaultUserData, ".recall-storage"), path.join(paths.appData, "recall-storage")])
    if (exists(directory)) directories.add(directory);
  const binding = [...directories].sort().map(directory => {
    // NTFS 的 64 位文件 ID 可超出 Number 安全范围；舍入会把不同目录误认成同一目录。
    const stat = lstatSync(directory, { bigint: true });
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(realpathSync.native(directory)) !== normalize(directory))
      throw new Error("unsafe_storage_path");
    return `${directory}:${stat.dev}:${stat.ino}`;
  });
  const lockFile = path.join(paths.defaultUserData, "lockfile");
  if (exists(lockFile)) {
    const lock = lstatSync(lockFile);
    if (!lock.isFile() || lock.isSymbolicLink() || lock.size !== 0) throw new Error("unsafe_lockfile");
  }
  return Object.freeze(binding);
}
