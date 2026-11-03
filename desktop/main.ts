import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { installPermissionBoundary } from "./permissions.js";
import { DESKTOP_ENTRY_URL, installDesktopProtocol, registerDesktopScheme } from "./protocol.js";
import { isPackagedDesktop, showRuntimeFailure, startDesktopRuntime, type DesktopRuntime } from "./runtime.js";
import { installDesktopCredentialStorageIpc } from "./credential-storage.js";
import { installDesktopVaultIpc } from "./vault.js";
import { isSquirrelLifecycleInvocation } from "./squirrel-lifecycle.js";
import { initializeFenbiSession } from "./fenbi-session.js";
import { installFenbiSessionIpc } from "./fenbi-session-ipc.js";
import { createFenbiWebContentsController } from "./fenbi-web-contents-controller.js";
import { installFenbiWebContentsIpc } from "./fenbi-web-contents-ipc.js";
import { createDesktopInitialProfile, inspectDesktopInitialProfile, resolveDesktopManagedStorage } from "./managed-storage.js";
import { completeInitialProfileDecision, type FreshProfileCandidate } from "./profile-initialization.ts";
import { DiagnosticStartupFailure } from "./diagnostic-readiness.js";
import type { ManagedStorageHostConfig } from "../app/platform/managed-storage.js";

registerDesktopScheme();

let mainWindow: BrowserWindow | undefined;
let runtime: DesktopRuntime | undefined;
let fenbiViewController: ReturnType<typeof createFenbiWebContentsController> | undefined;
let fenbiViewIpcCleanup: (() => void) | undefined;
const TITLE_BAR_HEIGHT = 52;
// 开发时从工作树取图标，安装版从受控 runtime 资源取图标；缺失时保留 Electron 默认图标。
const recallWindowIconPath = [
  path.join(process.resourcesPath, ".desktop-runtime", "app", "public", "brand", "recall", "app", "recall.ico"),
  path.join(import.meta.dirname, "..", "public", "brand", "recall", "app", "recall.ico"),
].find((candidate) => existsSync(candidate));

function installTitleBarIpc(): void {
  ipcMain.removeHandler("review-titlebar:set-theme");
  ipcMain.handle("review-titlebar:set-theme", (event, mode: unknown) => {
    if (event.sender !== mainWindow?.webContents || (mode !== "light" && mode !== "dark")) {
      throw new Error("标题栏主题参数无效");
    }
    mainWindow.setTitleBarOverlay({
      color: "#00000000",
      symbolColor: mode === "dark" ? "#f5f5f5" : "#171717",
      height: TITLE_BAR_HEIGHT,
    });
  });
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function disposeFenbiWebContents(): void {
  fenbiViewIpcCleanup?.();
  fenbiViewIpcCleanup = undefined;
  fenbiViewController?.dispose();
  fenbiViewController = undefined;
}

async function createMainWindow(storageConfig: ManagedStorageHostConfig): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const partition = "persist:review-workspace";
  const workspaceSession = session.fromPartition(partition);
  initializeFenbiSession();
  installFenbiSessionIpc(developmentUrl);
  installDesktopCredentialStorageIpc(developmentUrl);
  installDesktopVaultIpc(developmentUrl);
  if (isPackagedDesktop()) {
    runtime = await startDesktopRuntime(storageConfig);
    installDesktopProtocol(runtime.baseUrl, runtime.token, workspaceSession.protocol);
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#f7f7f5",
    icon: recallWindowIconPath,
    title: "错题复盘",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#171717",
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: Boolean(developmentUrl),
    },
  });
  fenbiViewController = createFenbiWebContentsController(mainWindow);
  fenbiViewIpcCleanup = installFenbiWebContentsIpc(developmentUrl, fenbiViewController, mainWindow);
  mainWindow.once("closed", () => {
    disposeFenbiWebContents();
    mainWindow = undefined;
  });
  installTitleBarIpc();
  installPermissionBoundary(workspaceSession, developmentUrl);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("review-app://workspace/")
      || Boolean(developmentUrl && new URL(url).origin === new URL(developmentUrl).origin);
    if (!allowed) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(developmentUrl ?? DESKTOP_ENTRY_URL);
}

async function cleanupFailedLaunch(): Promise<void> {
  disposeFenbiWebContents();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = undefined;
  if (!runtime) return;
  const failedRuntime = runtime;
  runtime = undefined;
  await failedRuntime.stop();
}

async function launchMainWindowWithRecovery(storageConfig: ManagedStorageHostConfig): Promise<void> {
  while (true) {
    try {
      await createMainWindow(storageConfig);
      return;
    } catch (error) {
      await cleanupFailedLaunch();
      if (error instanceof DiagnosticStartupFailure) {
        showStorageFailure(error.kind);
        app.quit();
        return;
      }
      const response = await showRuntimeFailure(error);
      if (response === 0) continue;
      app.quit();
      return;
    }
  }
}

function showStorageFailure(kind: string): void {
  dialog.showErrorBox("本地学习资料无法确认", `启动已停止，现有资料已保留。\n状态：${kind}`);
}

async function launchInitialProfile(candidate: FreshProfileCandidate): Promise<void> {
  // 开发服务器不拥有 Main composition；不能写完 metadata 后假称 diagnostic 已可用。
  if (!isPackagedDesktop()) { showStorageFailure("desktop_runtime_required"); app.quit(); return; }
  const result = await completeInitialProfileDecision(candidate, async () => {
    const decision = await dialog.showMessageBox({ type: "question", title: "创建本地学习资料",
      message: "是否在这台设备上创建本地学习资料？", detail: "已有或无法确认的资料不会被覆盖。",
      buttons: ["创建本地资料", "取消"], defaultId: 1, cancelId: 1, noLink: true });
    return decision.response === 0;
  }, createDesktopInitialProfile);
  if (result.kind === "ready") await launchMainWindowWithRecovery(result.config);
  else { if (result.kind !== "cancelled") showStorageFailure("reason" in result ? result.reason : result.kind); app.quit(); }
}

/**
 * The pre-ready resolver only classifies historical storage. Electron itself may
 * create the pristine profile directory / Local State while becoming ready.
 * Capture the one-use candidate only after this Host-owned runtime transition,
 * then preserve the normal post-consent candidate and path revalidation.
 */
async function launchFreshProfileAfterReady(): Promise<void> {
  const state = resolveDesktopManagedStorage();
  if (state.kind !== "uninitialized") {
    showStorageFailure("reason" in state ? state.reason : state.kind);
    app.quit();
    return;
  }
  const inspected = inspectDesktopInitialProfile();
  if (inspected.kind !== "eligible") {
    showStorageFailure("reason" in inspected ? inspected.reason : inspected.kind);
    app.quit();
    return;
  }
  await launchInitialProfile(inspected.candidate);
}

function installApplicationLifecycle(): void {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!runtime) return;
    event.preventDefault();
    const activeRuntime = runtime;
    runtime = undefined;
    void activeRuntime.stop().finally(() => app.quit());
  });
}

if (isSquirrelLifecycleInvocation(process.argv)) {
  app.quit();
} else {
  const singleInstance = app.requestSingleInstanceLock();
  if (!singleInstance) {
    app.quit();
  } else {
    // 存储失败不进入 renderer/runtime 重试循环；禁止默认空 profile 隐式替代已有历史。
    const storageState = resolveDesktopManagedStorage();
    if (storageState.kind !== "ready" && storageState.kind !== "legacy_existing_profile") {
      if (storageState.kind === "uninitialized") {
        installApplicationLifecycle();
        app.whenReady().then(launchFreshProfileAfterReady).catch(() => app.quit());
      } else { showStorageFailure("reason" in storageState ? storageState.reason : storageState.kind); app.exit(1); }
    } else {
      installApplicationLifecycle();
      app.whenReady()
        .then(() => launchMainWindowWithRecovery(storageState.config))
        .catch(() => app.quit());
    }
  }
}

process.on("uncaughtException", (error) => {
  void dialog.showErrorBox("错题复盘运行错误", error.message);
});
