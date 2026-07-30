import { app, BrowserWindow, dialog, session, shell } from "electron";
import path from "node:path";
import { installPermissionBoundary } from "./permissions.js";
import { DESKTOP_ENTRY_URL, installDesktopProtocol, registerDesktopScheme } from "./protocol.js";
import { isPackagedDesktop, showRuntimeFailure, startDesktopRuntime, type DesktopRuntime } from "./runtime.js";
import { installDesktopVaultIpc } from "./vault.js";

registerDesktopScheme();

let mainWindow: BrowserWindow | undefined;
let runtime: DesktopRuntime | undefined;

function isSquirrelLifecycleInvocation(): boolean {
  return process.argv.some((argument) => /^--squirrel-(install|updated|uninstall|obsolete)$/.test(argument));
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
    title: "错题复盘",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.js"),
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: Boolean(developmentUrl),
    },
  });
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

if (isSquirrelLifecycleInvocation()) {
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
