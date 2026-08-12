import type {
  CredentialHostResult,
  DesktopCredentialProtectionCapability,
  DesktopVaultCapability,
  HostRuntime,
  NativeWindowCapability,
} from "../capabilities.ts";
import { DesktopCredentialProtectionError } from "../capabilities.ts";

function unwrapCredentialResult<T>(result: CredentialHostResult<T>): T {
  if (result.ok) return result.value;
  throw new DesktopCredentialProtectionError(result.error.code, result.error.message);
}

/** 将现有 preload global 包装为中性能力；这里是 renderer 唯一允许读取桥接全局的位置。 */
export function createDesktopHost(target: Window): HostRuntime | undefined {
  const vaultBridge = target.reviewDesktopVault;
  const windowBridge = target.reviewDesktopWindow;
  const credentialProtectionBridge = target.reviewDesktopCredentialProtection;
  if (!vaultBridge && !windowBridge && !credentialProtectionBridge) return undefined;

  const vault: DesktopVaultCapability | undefined = vaultBridge
    ? {
        kind: "desktop",
        getState: () => vaultBridge.getState(),
        chooseVault: () => vaultBridge.chooseVault(),
        ensureManagedTree: (managedRoot) => vaultBridge.ensureManagedTree(managedRoot),
        listMarkdown: (managedRoot) => vaultBridge.listMarkdown(managedRoot),
        readMarkdown: (managedRoot, relativePath) => vaultBridge.readMarkdown(managedRoot, relativePath),
        writeMarkdown: (managedRoot, relativePath, markdown) => vaultBridge.writeMarkdown(managedRoot, relativePath, markdown),
        removeMarkdown: (managedRoot, relativePath) => vaultBridge.removeMarkdown(managedRoot, relativePath),
        startWatching: (managedRoot) => vaultBridge.startWatching(managedRoot),
        stopWatching: () => vaultBridge.stopWatching(),
        onVaultChanged: (listener) => vaultBridge.onVaultChanged(listener),
      }
    : undefined;
  const nativeWindow: NativeWindowCapability | undefined = windowBridge
    ? { setTitleBarTheme: (mode) => windowBridge.setTitleBarTheme(mode) }
    : undefined;

  const credentialProtection: DesktopCredentialProtectionCapability | undefined = credentialProtectionBridge
    ? {
        kind: "desktop",
        getStatus: async () => unwrapCredentialResult(await credentialProtectionBridge.getStatus()),
        protectCredential: async (context, secret) => unwrapCredentialResult(await credentialProtectionBridge.protectCredential(context, secret)),
        unprotectCredential: async (context, envelope) => unwrapCredentialResult(await credentialProtectionBridge.unprotectCredential(context, envelope)),
      }
    : undefined;

  const capabilities = { vault, nativeWindow } as HostRuntime["capabilities"];
  if (credentialProtection) capabilities.credentialProtection = credentialProtection;

  return {
    kind: "desktop",
    capabilities,
  };
}
