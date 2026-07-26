import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
].join("; ");

const nextConfig: NextConfig = {
  // 隐藏 Next 开发期左下角指示器，避免它遮挡应用自己的底部设置入口；错误覆盖层仍会正常显示。
  devIndicators: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
