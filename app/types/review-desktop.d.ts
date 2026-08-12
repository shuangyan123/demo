import type {
  DesktopCredentialProtectionPreloadBridge,
  DesktopVaultPreloadBridge,
  DesktopWindowPreloadBridge,
} from "../platform/capabilities.ts";

declare global {
  interface Window {
    reviewDesktopVault?: DesktopVaultPreloadBridge;
    reviewDesktopWindow?: DesktopWindowPreloadBridge;
    reviewDesktopCredentialProtection?: DesktopCredentialProtectionPreloadBridge;
  }
}

export {};
