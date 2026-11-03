/** review-app 只映射 Main 自己创建的 IPv4 loopback runtime；路径永远不能替换 authority。 */
export function desktopProtocolTarget(requestUrl: string, baseUrl: string): URL | undefined {
  const source = new URL(requestUrl);
  if (source.protocol !== "review-app:" || source.host !== "workspace" || source.username || source.password) return undefined;
  const target = new URL(baseUrl);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || Number(target.port) <= 0 || target.username || target.password) {
    throw new Error("Desktop protocol requires its owned loopback runtime");
  }
  // URL setters 保持原 origin；new URL(path, base) 会把 //host 和 /\\host 解释为新主机。
  target.pathname = source.pathname;
  target.search = source.search;
  target.hash = "";
  return target;
}
