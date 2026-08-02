type ReviewDesktopVaultState = { configured: boolean; vaultName: string };
type ReviewDesktopVaultSelection = { cancelled: boolean; vaultName?: string };
type ReviewDesktopVaultChange = { revision: number; occurredAt: string };

interface ReviewDesktopVaultBridge {
  getState(): Promise<ReviewDesktopVaultState>;
  chooseVault(): Promise<ReviewDesktopVaultSelection>;
  ensureManagedTree(managedRoot: string): Promise<void>;
  listMarkdown(managedRoot: string): Promise<Array<{ path: string; markdown: string }>>;
  readMarkdown(managedRoot: string, relativePath: string): Promise<string>;
  writeMarkdown(managedRoot: string, relativePath: string, markdown: string): Promise<void>;
  removeMarkdown(managedRoot: string, relativePath: string): Promise<void>;
  startWatching(managedRoot: string): Promise<void>;
  stopWatching(): Promise<void>;
  onVaultChanged(listener: (change: ReviewDesktopVaultChange) => void): () => void;
}

interface ReviewDesktopWindowBridge {
  setTitleBarTheme(mode: "light" | "dark"): Promise<void>;
}

interface Window {
  reviewDesktopVault?: ReviewDesktopVaultBridge;
  reviewDesktopWindow?: ReviewDesktopWindowBridge;
}
