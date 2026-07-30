import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function normalizeDesktopVaultRelativePath(value: string, markdownOnly = false): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error("VAULT_PATH_INVALID");
  }
  if (markdownOnly && !normalized.toLowerCase().endsWith(".md")) throw new Error("VAULT_EXTENSION_INVALID");
  return segments.join(path.sep);
}

/** 逐段拒绝符号链接，并确保规范化后的最终路径仍在 Vault 根目录内。 */
export async function resolveDesktopVaultPath(rootPath: string, relativePath: string, allowMissing: boolean): Promise<string> {
  const root = await realpath(rootPath);
  const normalized = normalizeDesktopVaultRelativePath(relativePath);
  const target = path.resolve(root, normalized);
  const relation = path.relative(root, target);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("VAULT_PATH_OUTSIDE_ROOT");

  let cursor = root;
  for (const segment of relation.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) throw new Error("VAULT_SYMLINK_REJECTED");
      const resolved = await realpath(cursor);
      const resolvedRelation = path.relative(root, resolved);
      if (resolvedRelation.startsWith("..") || path.isAbsolute(resolvedRelation)) throw new Error("VAULT_PATH_OUTSIDE_ROOT");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT" && allowMissing) continue;
      throw error;
    }
  }
  return target;
}
