type ReviewDesktopVaultState = { configured: boolean; vaultName: string };
type ReviewDesktopVaultSelection = { cancelled: boolean; vaultName?: string };

interface ReviewDesktopVaultBridge {
  getState(): Promise<ReviewDesktopVaultState>;
  chooseVault(): Promise<ReviewDesktopVaultSelection>;
  ensureManagedTree(managedRoot: string): Promise<void>;
  listMarkdown(managedRoot: string): Promise<Array<{ path: string; markdown: string }>>;
  readMarkdown(managedRoot: string, relativePath: string): Promise<string>;
  writeMarkdown(managedRoot: string, relativePath: string, markdown: string): Promise<void>;
  removeMarkdown(managedRoot: string, relativePath: string): Promise<void>;
}

interface Window {
  reviewDesktopVault?: ReviewDesktopVaultBridge;
}
