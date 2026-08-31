import type { Session, WebContents, WebPreferences } from "electron";

// 当前仓库唯一明确登记的 Fenbi Web host 来自现有 account-import adapter。
// 登录重定向 host 尚未有仓库证据，因此暂不扩大为任意 *.fenbi.com。
export const FENBI_ALLOWED_HOSTS = ["tiku.fenbi.com"] as const;

export function isAllowedFenbiHostname(hostname: string): boolean {
  return (FENBI_ALLOWED_HOSTS as readonly string[]).includes(hostname);
}

/** Fenbi remote content 只能在显式登记的 HTTPS host 上导航。 */
export function isAllowedFenbiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.port === ""
      && isAllowedFenbiHostname(url.hostname);
  } catch {
    return false;
  }
}

/** Foundation 阶段不授予任何 Chromium privileged permission。 */
export function isFenbiPermissionAllowed(_permission: string): false {
  return false;
}

/** 后续 WebContentsView 必须显式复用这组 remote-content webPreferences。 */
export function createFenbiWebPreferences(): Pick<
  WebPreferences,
  "nodeIntegration" | "contextIsolation" | "sandbox" | "webSecurity" | "allowRunningInsecureContent"
> {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };
}

/** 安装到 dedicated Fenbi session；不复用 Recall 的媒体/文件权限 boundary。 */
export function installFenbiRemoteContentPolicy(targetSession: Session): void {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  targetSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  targetSession.on("will-download", (event) => event.preventDefault());
}

function preventDisallowedNavigation(event: { preventDefault(): void }, url: string): void {
  if (!isAllowedFenbiUrl(url)) event.preventDefault();
}

/** 后续 WebContentsView 复用：拒绝 popup、外部导航和外部 server-side redirect。 */
export function installFenbiWebContentsPolicy(targetContents: WebContents): void {
  targetContents.setWindowOpenHandler(() => ({ action: "deny" }));
  targetContents.on("will-navigate", (event, url) => preventDisallowedNavigation(event, url));
  targetContents.on("will-redirect", (event, url) => preventDisallowedNavigation(event, url));
}
