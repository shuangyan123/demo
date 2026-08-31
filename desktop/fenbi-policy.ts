import type { Session, WebContents, WebPreferences } from "electron";

// Keep this policy module directly executable by the source contract runner; the
// session authority exposes and enforces the same dedicated partition constant.
const FENBI_SESSION_PARTITION = "persist:review-fenbi" as const;

// Web 导航与 authenticated request 使用不同 allowlist，禁止用一个宽泛集合同时授权两种边界。
export const FENBI_WEB_ALLOWED_HOSTS = ["www.fenbi.com", "tiku.fenbi.com"] as const;
export const FENBI_REQUEST_ALLOWED_HOSTS = ["tiku.fenbi.com"] as const;

export function isAllowedFenbiWebHostname(hostname: string): boolean {
  return (FENBI_WEB_ALLOWED_HOSTS as readonly string[]).includes(hostname);
}

export function isAllowedFenbiRequestHostname(hostname: string): boolean {
  return (FENBI_REQUEST_ALLOWED_HOSTS as readonly string[]).includes(hostname);
}

function isAllowedFenbiUrl(value: string, isAllowedHostname: (hostname: string) => boolean): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.port === ""
      && isAllowedHostname(url.hostname);
  } catch {
    return false;
  }
}

/** Fenbi remote content 只能在显式登记的 HTTPS web host 上导航。 */
export function isAllowedFenbiWebUrl(value: string): boolean {
  return isAllowedFenbiUrl(value, isAllowedFenbiWebHostname);
}

/** Main-only authenticated request 只能访问显式登记的 HTTPS API host。 */
export function isAllowedFenbiRequestUrl(value: string): boolean {
  return isAllowedFenbiUrl(value, isAllowedFenbiRequestHostname);
}

/** Foundation 阶段不授予任何 Chromium privileged permission。 */
export function isFenbiPermissionAllowed(_permission: string): false {
  void _permission;
  return false;
}

/** 后续 WebContentsView 必须显式复用这组 remote-content webPreferences。 */
export function createFenbiWebPreferences(): Pick<
  WebPreferences,
  "nodeIntegration" | "contextIsolation" | "sandbox" | "webSecurity" | "allowRunningInsecureContent"
> & {
  partition: typeof FENBI_SESSION_PARTITION;
} {
  return {
    partition: FENBI_SESSION_PARTITION,
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
  if (!isAllowedFenbiWebUrl(url)) event.preventDefault();
}

/** 后续 WebContentsView 复用：拒绝 popup、外部导航和外部 server-side redirect。 */
export function installFenbiWebContentsPolicy(targetContents: WebContents): void {
  targetContents.setWindowOpenHandler(() => ({ action: "deny" }));
  targetContents.on("will-navigate", (event, url) => preventDisallowedNavigation(event, url));
  targetContents.on("will-redirect", (event, url) => preventDisallowedNavigation(event, url));
}
