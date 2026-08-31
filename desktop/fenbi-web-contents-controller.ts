import { WebContentsView, type BrowserWindow } from "electron";
import { createFenbiWebPreferences, installFenbiWebContentsPolicy, isAllowedFenbiWebHostname } from "./fenbi-policy.js";
import { normalizeFenbiViewBounds } from "./fenbi-web-contents-bounds.js";
import {
  createFenbiWebContentsAuthority,
  type FenbiNativeViewLike,
  type FenbiWebContentsAuthority,
  type FenbiBrowserWindowLike,
} from "./fenbi-web-contents-authority.js";

/** 唯一允许创建 Fenbi WebContentsView 的 Electron 适配点。 */
export function createFenbiWebContentsController(ownerWindow: BrowserWindow): FenbiWebContentsAuthority {
  return createFenbiWebContentsAuthority({
    ownerWindow: ownerWindow as unknown as FenbiBrowserWindowLike,
    isAllowedWebHostname: isAllowedFenbiWebHostname,
    normalizeBounds: normalizeFenbiViewBounds,
    createView: () => {
      const view = new WebContentsView({ webPreferences: createFenbiWebPreferences() });
      installFenbiWebContentsPolicy(view.webContents);
      return view as unknown as FenbiNativeViewLike;
    },
  });
}
