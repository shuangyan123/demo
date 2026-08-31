import { session, type Session } from "electron";
import { createFenbiSessionAuthority, FENBI_SESSION_PARTITION } from "./fenbi-session-authority.js";
import { installFenbiRemoteContentPolicy, isAllowedFenbiRequestUrl } from "./fenbi-policy.js";

const fenbiSessionAuthority = createFenbiSessionAuthority<Session>({
  fromPartition: (partition) => session.fromPartition(partition),
  installPolicy: installFenbiRemoteContentPolicy,
  hasSessionData: async (targetSession) => (await targetSession.cookies.get({})).length > 0,
  clearSession: async (targetSession) => {
    // 该 Session partition 只属于 Fenbi；清理不会触碰 Recall workspace 或业务数据库。
    await targetSession.clearStorageData();
    await targetSession.clearCache();
    await targetSession.clearAuthCache();
  },
});

export const getFenbiSession = fenbiSessionAuthority.getFenbiSession;
export const initializeFenbiSession = fenbiSessionAuthority.initializeFenbiSession;
export const clearFenbiSession = fenbiSessionAuthority.clearFenbiSession;
export const getFenbiSessionStatus = fenbiSessionAuthority.getFenbiSessionStatus;

/**
 * Main-process-only future transport seam. Raw Cookie 只在本次主进程调用栈中存在，
 * 不进入 preload、renderer、持久化、日志或错误；调用方仍需自行完成账户级权威验证。
 */
export async function readFenbiRequestCookieHeader(targetUrl: string): Promise<string> {
  if (!isAllowedFenbiRequestUrl(targetUrl)) throw new Error("FENBI_TARGET_NOT_ALLOWED");
  const cookies = await getFenbiSession().cookies.get({ url: targetUrl });
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export { FENBI_SESSION_PARTITION };
