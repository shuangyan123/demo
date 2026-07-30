import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeDesktopVaultRelativePath, resolveDesktopVaultPath } from "./vault-path-security.ts";

test("桌面 Vault 拒绝绝对路径、父级穿越和非 Markdown 扩展名", () => {
  assert.throws(() => normalizeDesktopVaultRelativePath("../outside.md", true), /VAULT_PATH_INVALID/);
  assert.throws(() => normalizeDesktopVaultRelativePath("C:\\outside.md", true), /VAULT_PATH_INVALID/);
  assert.throws(() => normalizeDesktopVaultRelativePath("AI知识库/脚本.exe", true), /VAULT_EXTENSION_INVALID/);
  assert.equal(normalizeDesktopVaultRelativePath("AI知识库/政治理论/民主.md", true), path.join("AI知识库", "政治理论", "民主.md"));
});

test("桌面 Vault 解析逐段拒绝符号链接逃逸", async (context) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "review-vault-contract-"));
  const root = path.join(temporary, "vault");
  const outside = path.join(temporary, "outside");
  await mkdir(path.join(root, "AI知识库"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "AI知识库", "safe.md"), "safe", "utf8");
  assert.equal(await resolveDesktopVaultPath(root, "AI知识库/safe.md", false), path.join(root, "AI知识库", "safe.md"));
  try {
    await symlink(outside, path.join(root, "AI知识库", "escape"), "junction");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EPERM") context.skip("当前 Windows 环境不允许创建测试 junction");
    else throw error;
  }
  await assert.rejects(() => resolveDesktopVaultPath(root, "AI知识库/escape/note.md", true), /VAULT_SYMLINK_REJECTED/);
  await rm(temporary, { recursive: true, force: true });
});

test("Vault IPC 校验调用来源、正文上限且 preload 不暴露绝对路径", () => {
  const ipc = readFileSync(new URL("./vault.ts", import.meta.url), "utf8");
  const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
  assert.match(ipc, /assertTrustedSender/);
  assert.match(ipc, /MAX_MARKDOWN_BYTES/);
  assert.match(ipc, /app\.getPath\("userData"\)/);
  assert.doesNotMatch(preload, /rootPath|filePaths|absolute/i);
});
