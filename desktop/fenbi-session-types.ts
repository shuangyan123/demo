export type FenbiSessionAuthentication = "unknown" | "not-established";

/** Renderer 只接收这些不含 Cookie、Token 或其他会话材料的状态字段。 */
export type FenbiSessionStatus = {
  available: boolean;
  persistent: true;
  hasSessionData: boolean;
  authentication: FenbiSessionAuthentication;
};

export type FenbiSessionErrorCode = "untrusted_sender" | "session_unavailable" | "clear_failed";

export type FenbiSessionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: FenbiSessionErrorCode; message: string } };

export type FenbiSessionClearResult = {
  cleared: true;
};

/** 最小 preload 能力；Fenbi 页面本身不加载此桥。 */
export type FenbiSessionPreloadBridge = {
  getStatus(): Promise<FenbiSessionResult<FenbiSessionStatus>>;
  clear(): Promise<FenbiSessionResult<FenbiSessionClearResult>>;
};
