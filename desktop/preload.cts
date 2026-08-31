import { contextBridge, ipcRenderer } from "electron";
import type {
  CredentialHostResult,
  DesktopCredentialProtectionStatus,
  DesktopCredentialUnprotectResult,
  DesktopCredentialEnvelope,
} from "./credential-storage-envelope.js";
import type {
  FenbiSessionClearResult,
  FenbiSessionPreloadBridge,
  FenbiSessionResult,
  FenbiSessionStatus,
} from "./fenbi-session-types.js";

contextBridge.exposeInMainWorld("reviewDesktopVault", {
  getState: () => ipcRenderer.invoke("review-vault:get-state"),
  chooseVault: () => ipcRenderer.invoke("review-vault:choose"),
  ensureManagedTree: (managedRoot: string) => ipcRenderer.invoke("review-vault:ensure-tree", managedRoot),
  listMarkdown: (managedRoot: string) => ipcRenderer.invoke("review-vault:list", managedRoot),
  readMarkdown: (managedRoot: string, relativePath: string) => ipcRenderer.invoke("review-vault:read", managedRoot, relativePath),
  writeMarkdown: (managedRoot: string, relativePath: string, markdown: string) => ipcRenderer.invoke("review-vault:write", managedRoot, relativePath, markdown),
  removeMarkdown: (managedRoot: string, relativePath: string) => ipcRenderer.invoke("review-vault:remove", managedRoot, relativePath),
  startWatching: (managedRoot: string) => ipcRenderer.invoke("review-vault:watch-start", managedRoot),
  stopWatching: () => ipcRenderer.invoke("review-vault:watch-stop"),
  onVaultChanged: (listener: (change: { revision: number; occurredAt: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: { revision: number; occurredAt: string }) => listener(change);
    ipcRenderer.on("review-vault:changed", handler);
    return () => ipcRenderer.removeListener("review-vault:changed", handler);
  },
});

contextBridge.exposeInMainWorld("reviewDesktopWindow", {
  setTitleBarTheme: (mode: "light" | "dark") => ipcRenderer.invoke("review-titlebar:set-theme", mode),
});

/** 凭据桥只传递版本化上下文包，不暴露 Electron safeStorage 或通用解密原语。 */
contextBridge.exposeInMainWorld("reviewDesktopCredentialProtection", {
  getStatus: () => ipcRenderer.invoke("review-credential-storage:status") as Promise<CredentialHostResult<DesktopCredentialProtectionStatus>>,
  protectCredential: (context: string, secret: string) => ipcRenderer.invoke("review-credential-storage:protect", context, secret) as Promise<CredentialHostResult<DesktopCredentialEnvelope>>,
  unprotectCredential: (context: string, envelope: DesktopCredentialEnvelope) => ipcRenderer.invoke("review-credential-storage:unprotect", context, envelope) as Promise<CredentialHostResult<DesktopCredentialUnprotectResult>>,
});

/** 只返回脱敏 session 状态与 clear receipt；不暴露 Electron Session 或 Cookie API。 */
const reviewFenbiSession: FenbiSessionPreloadBridge = {
  getStatus: () => ipcRenderer.invoke("review-fenbi-session:get-status") as Promise<FenbiSessionResult<FenbiSessionStatus>>,
  clear: () => ipcRenderer.invoke("review-fenbi-session:clear") as Promise<FenbiSessionResult<FenbiSessionClearResult>>,
};

contextBridge.exposeInMainWorld("reviewFenbiSession", reviewFenbiSession);
