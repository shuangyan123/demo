/** Next 的 DEBUG sink 会输出内部 request override headers，必须在 child 启动前禁用。
 * negative namespace 优先于 exact/wildcard enable；保留其他应用的调试配置。
 */
export function desktopRuntimeEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const entries = Object.entries(parent);
  const debug = entries.find(([key]) => key.toUpperCase() === "DEBUG")?.[1];
  const env = { ...parent };
  for (const [key] of entries) if (key.toUpperCase() === "DEBUG") delete env[key];
  env.DEBUG = [debug, "-next:*"].filter(Boolean).join(",");
  return env;
}
