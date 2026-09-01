import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { isTrustedFenbiRendererSender } from "./fenbi-ipc-trust.js";
import type { FenbiWebContentsAuthority } from "./fenbi-web-contents-authority.js";
import type { FenbiViewResult, FenbiViewState } from "./fenbi-web-contents-types.js";

export const FENBI_VIEW_GET_STATE_CHANNEL = "review-fenbi-view:get-state";
export const FENBI_VIEW_SHOW_CHANNEL = "review-fenbi-view:show";
export const FENBI_VIEW_HIDE_CHANNEL = "review-fenbi-view:hide";
export const FENBI_VIEW_SET_BOUNDS_CHANNEL = "review-fenbi-view:set-bounds";
export const FENBI_VIEW_OPEN_HOME_CHANNEL = "review-fenbi-view:open-home";
export const FENBI_VIEW_RELOAD_CHANNEL = "review-fenbi-view:reload";
export const FENBI_VIEW_GO_BACK_CHANNEL = "review-fenbi-view:go-back";
export const FENBI_VIEW_GO_FORWARD_CHANNEL = "review-fenbi-view:go-forward";
export const FENBI_VIEW_STATE_CHANGED_CHANNEL = "review-fenbi-view:state-changed";

const COMMAND_CHANNELS = [
  FENBI_VIEW_GET_STATE_CHANNEL,
  FENBI_VIEW_SHOW_CHANNEL,
  FENBI_VIEW_HIDE_CHANNEL,
  FENBI_VIEW_SET_BOUNDS_CHANNEL,
  FENBI_VIEW_OPEN_HOME_CHANNEL,
  FENBI_VIEW_RELOAD_CHANNEL,
  FENBI_VIEW_GO_BACK_CHANNEL,
  FENBI_VIEW_GO_FORWARD_CHANNEL,
] as const;

function denied(): FenbiViewResult<FenbiViewState> {
  return { ok: false, error: { code: "untrusted_sender", message: "Fenbi view access denied" } };
}

function trusted(
  event: IpcMainInvokeEvent,
  developmentUrl: string | undefined,
  operation: () => FenbiViewResult<FenbiViewState> | Promise<FenbiViewResult<FenbiViewState>>,
): FenbiViewResult<FenbiViewState> | Promise<FenbiViewResult<FenbiViewState>> {
  return isTrustedFenbiRendererSender(event, developmentUrl) ? operation() : denied();
}

/** 只为 Recall renderer 安装固定命令；Fenbi remote WebContents 没有此 preload。 */
export function installFenbiWebContentsIpc(
  developmentUrl: string | undefined,
  controller: FenbiWebContentsAuthority,
  targetWindow: BrowserWindow,
): () => void {
  for (const channel of COMMAND_CHANNELS) ipcMain.removeHandler(channel);

  ipcMain.handle(FENBI_VIEW_GET_STATE_CHANNEL, (event) => trusted(event, developmentUrl, () => ({ ok: true, value: controller.getState() })));
  ipcMain.handle(FENBI_VIEW_SHOW_CHANNEL, (event) => trusted(event, developmentUrl, controller.show));
  ipcMain.handle(FENBI_VIEW_HIDE_CHANNEL, (event) => trusted(event, developmentUrl, controller.hide));
  ipcMain.handle(FENBI_VIEW_SET_BOUNDS_CHANNEL, (event, bounds: unknown) => trusted(event, developmentUrl, () => controller.setBounds(bounds)));
  ipcMain.handle(FENBI_VIEW_OPEN_HOME_CHANNEL, (event) => trusted(event, developmentUrl, controller.openHome));
  ipcMain.handle(FENBI_VIEW_RELOAD_CHANNEL, (event) => trusted(event, developmentUrl, controller.reload));
  ipcMain.handle(FENBI_VIEW_GO_BACK_CHANNEL, (event) => trusted(event, developmentUrl, controller.goBack));
  ipcMain.handle(FENBI_VIEW_GO_FORWARD_CHANNEL, (event) => trusted(event, developmentUrl, controller.goForward));

  const unsubscribe = controller.onStateChanged((state) => {
    if (targetWindow.isDestroyed()) return;
    try {
      targetWindow.webContents.send(FENBI_VIEW_STATE_CHANGED_CHANNEL, state);
    } catch {
      // BrowserWindow teardown can race with a final state event.
    }
  });
  return () => {
    unsubscribe();
    for (const channel of COMMAND_CHANNELS) ipcMain.removeHandler(channel);
  };
}
