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

registerDesktopScheme();

let mainWindow: BrowserWindow | undefined;
let runtime: DesktopRuntime | undefined;
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

async function createMainWindow(): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const partition = "persist:review-workspace";
  const workspaceSession = session.fromPartition(partition);
  initializeFenbiSession();
  installFenbiSessionIpc(developmentUrl);
  installDesktopCredentialStorageIpc(developmentUrl);
  installDesktopVaultIpc(developmentUrl);
  if (isPackagedDesktop()) {
    runtime = await startDesktopRuntime();
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
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = undefined;
  if (!runtime) return;
  const failedRuntime = runtime;
  runtime = undefined;
  await failedRuntime.stop();
}

async function launchMainWindowWithRecovery(): Promise<void> {
  while (true) {
    try {
      await createMainWindow();
      return;
    } catch (error) {
      await cleanupFailedLaunch();
      const response = await showRuntimeFailure(error);
      if (response === 0) continue;
      app.quit();
      return;
    }
  }
}

if (isSquirrelLifecycleInvocation(process.argv)) {
  app.quit();
} else {
  const singleInstance = app.requestSingleInstanceLock();
  if (!singleInstance) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });
    app.whenReady()
      .then(launchMainWindowWithRecovery)
      .catch(() => app.quit());
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", (event) => {
      if (!runtime) return;
      event.preventDefault();
      const activeRuntime = runtime;
      runtime = undefined;
      void activeRuntime.stop().finally(() => app.quit());
    });
  }
}

process.on("uncaughtException", (error) => {
  void dialog.showErrorBox("错题复盘运行错误", error.message);
});
