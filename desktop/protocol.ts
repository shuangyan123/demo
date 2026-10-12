import { protocol, type Protocol } from "electron";

const DESKTOP_SCHEME = "review-app";
const DESKTOP_HOST = "workspace";

export function registerDesktopScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      codeCache: true,
    },
  }]);
}

/** 将稳定的 review-app origin 代理到随机 loopback，并在主进程边界注入运行令牌。 */
export function installDesktopProtocol(baseUrl: string, token: string, targetProtocol: Protocol = protocol): void {
  if (targetProtocol.isProtocolHandled(DESKTOP_SCHEME)) targetProtocol.unhandle(DESKTOP_SCHEME);
  targetProtocol.handle(DESKTOP_SCHEME, async (request) => {
    const source = new URL(request.url);
    if (source.host !== DESKTOP_HOST) return new Response("Not found", { status: 404 });
    const target = new URL(`${source.pathname}${source.search}`, baseUrl);
    const headers = new Headers(request.headers);
    headers.set("x-review-runtime-token", token);
    headers.delete("origin");
    headers.delete("host");
    const bodyAllowed = request.method !== "GET" && request.method !== "HEAD";
    const init = {
      method: request.method,
      headers,
      body: bodyAllowed ? request.body : undefined,
      redirect: "manual",
      duplex: "half",
    } as RequestInit & { duplex: "half" };
    // 内部 loopback 用 Node fetch 保留请求元数据；net.fetch 会添加 Chromium 的 site:none，误拒绝原生 POST。
    return fetch(new Request(target, init));
  });
}

export const DESKTOP_ENTRY_URL = `${DESKTOP_SCHEME}://${DESKTOP_HOST}/`;
