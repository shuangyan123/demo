/* eslint-disable @typescript-eslint/no-require-imports -- Electron smoke must run as a CommonJS main process. */
const { app, BrowserWindow } = require("electron");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const preloadPath = resolve(__dirname, "..", ".desktop", "preload.cjs");
let mainWindow;

function finish(code) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.exit(code);
}

async function runSmoke() {
  if (!existsSync(preloadPath)) {
    console.error("preload integration smoke: compiled preload.cjs is missing");
    finish(1);
    return;
  }

  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  try {
    await mainWindow.loadURL("data:text/html,<html><body>preload smoke</body></html>");
    const evidence = await mainWindow.webContents.executeJavaScript(`({
      desktopBridge: Boolean(window.reviewDesktopVault || window.reviewDesktopWindow || window.reviewDesktopCredentialProtection || window.reviewFenbiSession || window.reviewFenbiView),
      credentialProtection: Boolean(window.reviewDesktopCredentialProtection),
      credentialProtectionMethods: Boolean(
        window.reviewDesktopCredentialProtection
        && typeof window.reviewDesktopCredentialProtection.getStatus === "function"
        && typeof window.reviewDesktopCredentialProtection.protectCredential === "function"
        && typeof window.reviewDesktopCredentialProtection.unprotectCredential === "function"
      ),
    })`, true);
    if (!evidence.desktopBridge || !evidence.credentialProtection || !evidence.credentialProtectionMethods) {
      console.error("preload integration smoke: expected Desktop bridge evidence was not exposed");
      finish(1);
      return;
    }
    console.log("preload integration smoke: sandboxed BrowserWindow exposed the narrow Desktop bridge");
    finish(0);
  } catch (error) {
    console.error(`preload integration smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    finish(1);
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(runSmoke).catch((error) => {
  console.error(`preload integration smoke failed before BrowserWindow: ${error instanceof Error ? error.message : "unknown error"}`);
  app.exit(1);
});
