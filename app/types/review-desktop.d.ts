import type {
  DesktopCredentialProtectionPreloadBridge,
  DesktopFenbiSessionPreloadBridge,
  DesktopFenbiViewPreloadBridge,
  DesktopVaultPreloadBridge,
  DesktopWindowPreloadBridge,
} from "../platform/capabilities.ts";

declare global {
  interface Window {
    reviewDesktopVault?: DesktopVaultPreloadBridge;
    reviewDesktopWindow?: DesktopWindowPreloadBridge;
    reviewDesktopCredentialProtection?: DesktopCredentialProtectionPreloadBridge;
    reviewFenbiSession?: DesktopFenbiSessionPreloadBridge;
    reviewFenbiView?: DesktopFenbiViewPreloadBridge;
  }
}

export {};
