import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { clearFenbiSession, getFenbiSessionStatus } from "./fenbi-session.js";
import type {
  FenbiSessionClearResult,
  FenbiSessionResult,
  FenbiSessionStatus,
} from "./fenbi-session-types.js";

const FENBI_SESSION_STATUS_CHANNEL = "review-fenbi-session:get-status";
const FENBI_SESSION_CLEAR_CHANNEL = "review-fenbi-session:clear";

function isTrustedSender(event: IpcMainInvokeEvent, developmentUrl?: string): boolean {
  const value = event.senderFrame?.url ?? event.sender.getURL();
  if (value.startsWith("review-app://workspace/")) return true;
  if (!developmentUrl) return false;
  try {
    return new URL(value).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

function failure<T>(code: "untrusted_sender" | "session_unavailable" | "clear_failed", message: string): FenbiSessionResult<T> {
  return { ok: false, error: { code, message } };
}

/** 只允许 Recall renderer 调用；Fenbi remote content 没有 preload，也不被 origin allowlist 信任。 */
export function installFenbiSessionIpc(developmentUrl?: string): void {
  for (const channel of [FENBI_SESSION_STATUS_CHANNEL, FENBI_SESSION_CLEAR_CHANNEL]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(FENBI_SESSION_STATUS_CHANNEL, async (event) => {
    if (!isTrustedSender(event, developmentUrl)) {
      return failure<FenbiSessionStatus>("untrusted_sender", "Fenbi session access denied");
    }
    try {
      return { ok: true, value: await getFenbiSessionStatus() } satisfies FenbiSessionResult<FenbiSessionStatus>;
    } catch {
      return failure<FenbiSessionStatus>("session_unavailable", "Fenbi session is unavailable");
    }
  });

  ipcMain.handle(FENBI_SESSION_CLEAR_CHANNEL, async (event) => {
    if (!isTrustedSender(event, developmentUrl)) {
      return failure<FenbiSessionClearResult>("untrusted_sender", "Fenbi session access denied");
    }
    try {
      await clearFenbiSession();
      return { ok: true, value: { cleared: true } } satisfies FenbiSessionResult<FenbiSessionClearResult>;
    } catch {
      return failure<FenbiSessionClearResult>("clear_failed", "Fenbi session could not be cleared");
    }
  });
}
