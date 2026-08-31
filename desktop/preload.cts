import { contextBridge, ipcRenderer } from "electron";
import type {
  CredentialHostResult,
  DesktopCredentialProtectionStatus,
  DesktopCredentialUnprotectResult,
  DesktopCredentialEnvelope,
} from "./credential-storage-envelope.js";
import type {
  FenbiViewBounds,
  FenbiViewPreloadBridge,
  FenbiViewResult,
  FenbiViewState,
} from "./fenbi-web-contents-types.js";
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

const FENBI_VIEW_STATE_CHANGED_CHANNEL = "review-fenbi-view:state-changed";

function sanitizeFenbiViewState(value: unknown): FenbiViewState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const host = candidate.host === "www.fenbi.com" || candidate.host === "tiku.fenbi.com" ? candidate.host : undefined;
  const lastError = candidate.lastError === "view_unavailable"
    || candidate.lastError === "load_failed"
    || candidate.lastError === "navigation_unavailable"
    ? candidate.lastError
    : undefined;
  if (![candidate.available, candidate.visible, candidate.loading, candidate.canGoBack, candidate.canGoForward].every((item) => typeof item === "boolean")) return undefined;
  return {
    available: candidate.available,
    visible: candidate.visible,
    loading: candidate.loading,
    ...(host ? { host } : {}),
    canGoBack: candidate.canGoBack,
    canGoForward: candidate.canGoForward,
    ...(lastError ? { lastError } : {}),
  } as FenbiViewState;
}

/** Renderer 只得到固定动作与脱敏 state；remote Fenbi WebContents 不加载此 preload。 */
const reviewFenbiView: FenbiViewPreloadBridge = {
  getState: () => ipcRenderer.invoke("review-fenbi-view:get-state") as Promise<FenbiViewResult<FenbiViewState>>,
  show: () => ipcRenderer.invoke("review-fenbi-view:show") as Promise<FenbiViewResult<FenbiViewState>>,
  hide: () => ipcRenderer.invoke("review-fenbi-view:hide") as Promise<FenbiViewResult<FenbiViewState>>,
  setBounds: (bounds: FenbiViewBounds) => ipcRenderer.invoke("review-fenbi-view:set-bounds", bounds) as Promise<FenbiViewResult<FenbiViewState>>,
  openHome: () => ipcRenderer.invoke("review-fenbi-view:open-home") as Promise<FenbiViewResult<FenbiViewState>>,
  reload: () => ipcRenderer.invoke("review-fenbi-view:reload") as Promise<FenbiViewResult<FenbiViewState>>,
  goBack: () => ipcRenderer.invoke("review-fenbi-view:go-back") as Promise<FenbiViewResult<FenbiViewState>>,
  goForward: () => ipcRenderer.invoke("review-fenbi-view:go-forward") as Promise<FenbiViewResult<FenbiViewState>>,
  onStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const state = sanitizeFenbiViewState(value);
      if (state) listener(state);
    };
    ipcRenderer.on(FENBI_VIEW_STATE_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(FENBI_VIEW_STATE_CHANGED_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("reviewFenbiView", reviewFenbiView);
