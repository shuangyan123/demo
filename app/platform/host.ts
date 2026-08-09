import type { HostCapabilities, HostRuntime } from "./capabilities.ts";
import { createDesktopHost } from "./desktop/desktop-host-adapter.ts";
import { createWebHost } from "./web/web-host-adapter.ts";

const SERVER_HOST: HostRuntime = { kind: "server", capabilities: {} };

/** 惰性解析宿主，避免模块导入或 Next.js 预渲染阶段读取 window。 */
export function resolveHost(target: Window | undefined = typeof window === "undefined" ? undefined : window): HostRuntime {
  if (!target) return SERVER_HOST;
  return createDesktopHost(target) ?? createWebHost(target);
}

/** 业务代码统一依赖这个入口；getter 保留测试注入和 preload 启动顺序。 */
export const host: { readonly kind: HostRuntime["kind"]; readonly capabilities: HostCapabilities } = {
  get kind() {
    return resolveHost().kind;
  },
  get capabilities() {
    return resolveHost().capabilities;
  },
};
