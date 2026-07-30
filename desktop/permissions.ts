import { desktopCapturer, dialog, type Session } from "electron";

function isTrustedOrigin(url: string, developmentUrl?: string): boolean {
  if (url.startsWith("review-app://workspace/")) return true;
  if (!developmentUrl) return false;
  try {
    return new URL(url).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

/** 权限只授予应用 origin；媒体请求仍由 Chromium 的用户手势约束。 */
export function installPermissionBoundary(targetSession: Session, developmentUrl?: string): void {
  const allowedPermissions = new Set(["media", "fileSystem"]);
  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    allowedPermissions.has(permission) && isTrustedOrigin(requestingOrigin, developmentUrl)
  ));
  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.has(permission) && isTrustedOrigin(webContents.getURL(), developmentUrl));
  });

  targetSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isTrustedOrigin(request.frame?.url ?? "", developmentUrl)) {
      callback({});
      return;
    }
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
    const available = sources.slice(0, 12);
    const result = await dialog.showMessageBox({
      type: "question",
      title: "选择共享来源",
      message: "选择要共享的屏幕或窗口",
      detail: "只有本次枚举出的来源可以被选择。",
      buttons: [...available.map((source) => source.name), "取消"],
      cancelId: available.length,
      noLink: true,
    });
    const source = available[result.response];
    callback(source ? { video: source } : {});
  });
}
