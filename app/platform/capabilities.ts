export type HostKind = "server" | "web" | "desktop";

export type HostVaultChange = {
  revision: number;
  occurredAt: string;
};

export type HostVaultState = {
  configured: boolean;
  vaultName: string;
};

export type HostVaultSelection = {
  cancelled: boolean;
  vaultName?: string;
};

export type HostMarkdownFile = {
  path: string;
  markdown: string;
};

export interface DesktopVaultCapability {
  readonly kind: "desktop";
  getState(): Promise<HostVaultState>;
  chooseVault(): Promise<HostVaultSelection>;
  ensureManagedTree(managedRoot: string): Promise<void>;
  listMarkdown(managedRoot: string): Promise<HostMarkdownFile[]>;
  readMarkdown(managedRoot: string, relativePath: string): Promise<string>;
  writeMarkdown(managedRoot: string, relativePath: string, markdown: string): Promise<void>;
  removeMarkdown(managedRoot: string, relativePath: string): Promise<void>;
  startWatching(managedRoot: string): Promise<void>;
  stopWatching(): Promise<void>;
  onVaultChanged(listener: (change: HostVaultChange) => void): () => void;
}

export type HostFileSystemObserver = {
  observe(handle: FileSystemDirectoryHandle, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
};

export interface WebVaultCapability {
  readonly kind: "web";
  chooseDirectory(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  createObserver?(listener: (records: Array<{ type?: string }>) => void): HostFileSystemObserver;
}

export type VaultCapability = DesktopVaultCapability | WebVaultCapability;

export interface NativeWindowCapability {
  setTitleBarTheme(mode: "light" | "dark"): Promise<void>;
}

export type HostCapabilities = {
  vault?: VaultCapability;
  nativeWindow?: NativeWindowCapability;
};

export type HostRuntime = {
  kind: HostKind;
  capabilities: HostCapabilities;
};

/** Electron preload 只实现这些中性端口，renderer 不接触 Node.js、IPC 或绝对路径。 */
export type DesktopVaultPreloadBridge = Omit<DesktopVaultCapability, "kind">;
export type DesktopWindowPreloadBridge = NativeWindowCapability;
