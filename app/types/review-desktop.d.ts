import type { DesktopVaultPreloadBridge, DesktopWindowPreloadBridge } from "../platform/capabilities.ts";

declare global {
  interface Window {
    reviewDesktopVault?: DesktopVaultPreloadBridge;
    reviewDesktopWindow?: DesktopWindowPreloadBridge;
  }
}

export {};
