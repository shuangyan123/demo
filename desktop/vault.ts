import { app, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeDesktopVaultRelativePath, resolveDesktopVaultPath } from "./vault-path-security.js";

const VAULT_STATE_FILE = "review-desktop-vault.json";
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
let activeWatcher: FSWatcher | undefined;
let watcherRevision = 0;
const CATEGORIES = ["政治理论", "常识判断", "申论"];

type StoredVaultState = {
  rootPath: string;
  vaultName: string;
};

function isTrustedSender(event: IpcMainInvokeEvent, developmentUrl?: string): boolean {
  const value = event.senderFrame?.url ?? event.sender.getURL();
  if (value.startsWith("review-app://workspace/")) return true;
  if (!developmentUrl) return false;
  try {
    return new URL(value).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, developmentUrl?: string): void {
  if (!isTrustedSender(event, developmentUrl)) throw new Error("VAULT_UNTRUSTED_SENDER");
}

function statePath(): string {
  return path.join(app.getPath("userData"), VAULT_STATE_FILE);
}

async function loadState(): Promise<StoredVaultState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as StoredVaultState;
    if (!path.isAbsolute(parsed.rootPath) || !parsed.vaultName) return undefined;
    if (!(await stat(parsed.rootPath)).isDirectory()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function saveState(state: StoredVaultState): Promise<void> {
  await writeFile(statePath(), JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
}

async function requireState(): Promise<StoredVaultState> {
  const state = await loadState();
  if (!state) throw new Error("VAULT_NOT_SELECTED");
  return state;
}

function stopWatcher(): void {
  activeWatcher?.close();
  activeWatcher = undefined;
}

async function startWatcher(event: IpcMainInvokeEvent, managedRoot: string): Promise<void> {
  const state = await requireState();
  const root = await resolveDesktopVaultPath(state.rootPath, normalizeDesktopVaultRelativePath(managedRoot), false);
  stopWatcher();
  activeWatcher = watch(root, { recursive: true }, (_eventType, filename) => {
    if (filename && !filename.toString().toLowerCase().endsWith(".md")) return;
    watcherRevision += 1;
    if (!event.sender.isDestroyed()) {
      event.sender.send("review-vault:changed", {
        revision: watcherRevision,
        occurredAt: new Date().toISOString(),
      });
    }
  });
  event.sender.once("destroyed", stopWatcher);
}

async function walkMarkdown(root: string, directory: string, prefix = ""): Promise<Array<{ path: string; markdown: string }>> {
  const result: Array<{ path: string; markdown: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "Attachments" || entry.name === "附件" || entry.name === "Trash" || entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = await resolveDesktopVaultPath(root, path.relative(root, path.join(directory, entry.name)), false);
    if (entry.isDirectory()) result.push(...await walkMarkdown(root, entryPath, relative));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const info = await stat(entryPath);
      if (info.size > MAX_MARKDOWN_BYTES) throw new Error("VAULT_MARKDOWN_TOO_LARGE");
      result.push({ path: relative, markdown: await readFile(entryPath, "utf8") });
    }
  }
  return result;
}

/** 安装最小 Vault IPC；绝对路径只存在于主进程 userData 配置。 */
export function installDesktopVaultIpc(developmentUrl?: string): void {
  stopWatcher();
  for (const channel of ["review-vault:get-state", "review-vault:choose", "review-vault:ensure-tree", "review-vault:list", "review-vault:read", "review-vault:write", "review-vault:remove", "review-vault:watch-start", "review-vault:watch-stop"]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle("review-vault:get-state", async (event) => {
    assertTrustedSender(event, developmentUrl);
    const state = await loadState();
    return state ? { configured: true, vaultName: state.vaultName } : { configured: false, vaultName: "" };
  });
  ipcMain.handle("review-vault:choose", async (event) => {
    assertTrustedSender(event, developmentUrl);
    stopWatcher();
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "选择 Obsidian Vault" });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const rootPath = await realpath(result.filePaths[0]);
    const state = { rootPath, vaultName: path.basename(rootPath) };
    await saveState(state);
    return { cancelled: false, vaultName: state.vaultName };
  });
  ipcMain.handle("review-vault:ensure-tree", async (event, managedRoot: string) => {
    assertTrustedSender(event, developmentUrl);
    const state = await requireState();
    const root = await resolveDesktopVaultPath(state.rootPath, normalizeDesktopVaultRelativePath(managedRoot), true);
    await mkdir(root, { recursive: true });
    for (const category of CATEGORIES) await mkdir(await resolveDesktopVaultPath(state.rootPath, path.join(managedRoot, category), true), { recursive: true });
  });
  ipcMain.handle("review-vault:list", async (event, managedRoot: string) => {
    assertTrustedSender(event, developmentUrl);
    const state = await requireState();
    const root = await resolveDesktopVaultPath(state.rootPath, normalizeDesktopVaultRelativePath(managedRoot), false);
    return walkMarkdown(state.rootPath, root);
  });
  ipcMain.handle("review-vault:read", async (event, managedRoot: string, relativePath: string) => {
    assertTrustedSender(event, developmentUrl);
    const state = await requireState();
    const target = await resolveDesktopVaultPath(state.rootPath, path.join(normalizeDesktopVaultRelativePath(managedRoot), normalizeDesktopVaultRelativePath(relativePath, true)), false);
    const info = await stat(target);
    if (info.size > MAX_MARKDOWN_BYTES) throw new Error("VAULT_MARKDOWN_TOO_LARGE");
    return readFile(target, "utf8");
  });
  ipcMain.handle("review-vault:write", async (event, managedRoot: string, relativePath: string, markdown: string) => {
    assertTrustedSender(event, developmentUrl);
    if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) throw new Error("VAULT_MARKDOWN_TOO_LARGE");
    const state = await requireState();
    const target = await resolveDesktopVaultPath(state.rootPath, path.join(normalizeDesktopVaultRelativePath(managedRoot), normalizeDesktopVaultRelativePath(relativePath, true)), true);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, markdown, "utf8");
  });
  ipcMain.handle("review-vault:remove", async (event, managedRoot: string, relativePath: string) => {
    assertTrustedSender(event, developmentUrl);
    const state = await requireState();
    const target = await resolveDesktopVaultPath(state.rootPath, path.join(normalizeDesktopVaultRelativePath(managedRoot), normalizeDesktopVaultRelativePath(relativePath, true)), true);
    await rm(target, { force: true });
  });
  ipcMain.handle("review-vault:watch-start", async (event, managedRoot: string) => {
    assertTrustedSender(event, developmentUrl);
    await startWatcher(event, managedRoot);
  });
  ipcMain.handle("review-vault:watch-stop", async (event) => {
    assertTrustedSender(event, developmentUrl);
    stopWatcher();
  });
}
