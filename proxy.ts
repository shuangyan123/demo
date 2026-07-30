import { NextResponse, type NextRequest } from "next/server";

const TOKEN_HEADER = "x-review-runtime-token";

/**
 * 桌面安装版的 standalone 服务只接受 Electron 主进程注入的一次性令牌。
 * 普通 Web 开发与部署没有该环境变量，因此继续保持原有访问方式。
 */
export function proxy(request: NextRequest) {
  const requiredToken = process.env.REVIEW_DESKTOP_RUNTIME_TOKEN;
  if (!requiredToken) return NextResponse.next();
  const suppliedToken = request.headers.get(TOKEN_HEADER);
  if (!suppliedToken || suppliedToken.length !== requiredToken.length || suppliedToken !== requiredToken) {
    return new NextResponse("Desktop runtime access denied", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const headers = new Headers(request.headers);
  headers.delete(TOKEN_HEADER);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/:path*",
};
