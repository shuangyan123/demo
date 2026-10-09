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
  if (process.platform !== "win32" || (entry !== "lockfile" && entry !== "Local State")) return;
  const file = path.join(profile, entry); const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) return;
  if (entry === "lockfile") return stat.size === 0 ? `${file}:${stat.dev}:${stat.ino}` : undefined;
  if (stat.size === 0 || stat.size > 4096) return;
  const bytes = readFileSync(file); const text = bytes.toString("utf8");
  if (bytes.length !== stat.size || !Buffer.from(text, "utf8").equals(bytes)) return;
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
  return `${file}:${stat.dev}:${stat.ino}:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function isInitialRuntimeEntry(profile: string, entry: string): boolean {
  return initialRuntimeEntryBinding(profile, entry) !== undefined;
}

/** Runtime-only 文件不证明历史新旧；仍需无 Recall 残留、Main 明确授权及重新检查。 */
export function isPristineProfile(profile: string): boolean {
  if (!exists(profile)) return true;
  if (!lstatSync(profile).isDirectory()) return false;
  return readdirSync(profile).every(entry => isInitialRuntimeEntry(profile, entry));
}

/** 仅首次创建绑定 Local State 的 inode 与完整字节；既有 legacy/anchor 恢复规则保持原样。 */
export function initialProfileBinding(paths: StorageHostPaths): readonly string[] {
  const binding = [...storagePathBinding(paths)];
  if (exists(path.join(paths.defaultUserData, "Local State"))) {
    const localState = initialRuntimeEntryBinding(paths.defaultUserData, "Local State");
    if (!localState) throw new Error("unsafe_initial_runtime_file");
    binding.push(localState);
  }
  return Object.freeze(binding);
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
    const stat = lstatSync(directory);
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(realpathSync.native(directory)) !== normalize(directory))
      throw new Error("unsafe_storage_path");
    return `${directory}:${stat.dev}:${stat.ino}`;
  });
  const lockFile = path.join(paths.defaultUserData, "lockfile");
  if (exists(lockFile)) {
    const lock = lstatSync(lockFile);
    if (!lock.isFile() || lock.isSymbolicLink() || lock.size !== 0) throw new Error("unsafe_lockfile");
    binding.push(`${lockFile}:${lock.dev}:${lock.ino}`);
  }
  return Object.freeze(binding);
}
