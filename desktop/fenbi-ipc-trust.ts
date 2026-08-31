import type { IpcMainInvokeEvent } from "electron";

/** Fenbi IPC 只信任 Recall renderer 的稳定协议 origin 或当前开发 origin。 */
export function isTrustedFenbiRendererSender(event: IpcMainInvokeEvent, developmentUrl?: string): boolean {
  const value = event.senderFrame?.url ?? event.sender.getURL();
  if (value.startsWith("review-app://workspace/")) return true;
  if (!developmentUrl) return false;
  try {
    return new URL(value).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}
