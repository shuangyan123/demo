import type { FenbiSessionStatus } from "./fenbi-session-types.js";

export const FENBI_SESSION_PARTITION = "persist:review-fenbi" as const;

export type FenbiSessionAuthorityDependencies<TSession> = {
  fromPartition(partition: typeof FENBI_SESSION_PARTITION): TSession;
  installPolicy(targetSession: TSession): void;
  hasSessionData(targetSession: TSession): Promise<boolean>;
  clearSession(targetSession: TSession): Promise<void>;
};

export type FenbiSessionAuthority<TSession> = {
  getFenbiSession(): TSession;
  initializeFenbiSession(): TSession;
  clearFenbiSession(): Promise<void>;
  getFenbiSessionStatus(): Promise<FenbiSessionStatus>;
};

const UNAVAILABLE_STATUS: FenbiSessionStatus = {
  available: false,
  persistent: true,
  hasSessionData: false,
  authentication: "not-established",
};

/**
 * Session authority 的可测试核心。Session 只创建一次，policy 只安装一次，
 * clear 永远只委托给这一个 dedicated session，不存在跨 partition 的清理入口。
 */
export function createFenbiSessionAuthority<TSession>(
  dependencies: FenbiSessionAuthorityDependencies<TSession>,
): FenbiSessionAuthority<TSession> {
  let activeSession: TSession | undefined;
  let policyInstalled = false;

  const initializeFenbiSession = (): TSession => {
    activeSession ??= dependencies.fromPartition(FENBI_SESSION_PARTITION);
    if (!policyInstalled) {
      dependencies.installPolicy(activeSession);
      policyInstalled = true;
    }
    return activeSession;
  };

  return {
    getFenbiSession: initializeFenbiSession,
    initializeFenbiSession,
    clearFenbiSession: async () => dependencies.clearSession(initializeFenbiSession()),
    getFenbiSessionStatus: async () => {
      try {
        const hasSessionData = await dependencies.hasSessionData(initializeFenbiSession());
        return {
          available: true,
          persistent: true,
          hasSessionData,
          authentication: hasSessionData ? "unknown" : "not-established",
        };
      } catch {
        return UNAVAILABLE_STATUS;
      }
    },
  };
}
