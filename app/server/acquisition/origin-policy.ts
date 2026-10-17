import { RouteSecurityError } from "../http/route-security.ts";

function origin(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("invalid origin");
  return url.origin.toLowerCase();
}

/** allowedOrigins 是本地任务的来源选择范围；可选服务端配置只能进一步收窄，不能由请求覆盖。 */
export function acquisitionOrigins(selection: string[], configured = process.env.RECALL_ACQUISITION_ALLOWED_ORIGINS): string[] {
  let selected: string[];
  try { selected = selection.map(origin); }
  catch { throw new RouteSecurityError("invalid_acquisition_origins", "采集来源配置无效", 400); }
  if (configured === undefined) return selected;
  let trusted: Set<string>;
  try {
    const values: unknown = JSON.parse(configured);
    if (!Array.isArray(values) || !values.every(value => typeof value === "string")) throw new Error("invalid config");
    trusted = new Set(values.map(origin));
  } catch { throw new RouteSecurityError("invalid_acquisition_policy", "服务端采集来源策略无效", 503); }
  if (selected.some(value => !trusted.has(value))) {
    throw new RouteSecurityError("acquisition_origin_not_authorized", "采集来源超出服务端授权范围", 403);
  }
  return selected;
}
