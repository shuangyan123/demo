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

export type CredentialProtectionStatus =
  | { status: "available"; backend: "os_protected" }
  | { status: "unavailable" | "unsupported" | "temporarily_unavailable" };

export type CredentialHostErrorCode =
  | "host_unavailable"
  | "host_protection_failed"
  | "host_unprotect_failed"
  | "host_context_mismatch"
  | "host_payload_invalid";

export type CredentialHostResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: CredentialHostErrorCode; message: string } };

export class DesktopCredentialProtectionError extends Error {
  readonly code: CredentialHostErrorCode;

  constructor(code: CredentialHostErrorCode, message: string) {
    super(message);
    this.name = "DesktopCredentialProtectionError";
    this.code = code;
  }
}

export type DesktopCredentialEnvelope = {
  version: "desktop-v1";
  context: string;
  payload: string;
};

export type DesktopCredentialUnprotectResult = {
  secret: string;
  shouldReProtect: boolean;
};

/** 只允许凭据语义的受保护包，不暴露通用 native crypto primitive。 */
export interface DesktopCredentialProtectionCapability {
  readonly kind: "desktop";
  getStatus(): Promise<CredentialProtectionStatus>;
  protectCredential(context: string, secret: string): Promise<DesktopCredentialEnvelope>;
  unprotectCredential(context: string, envelope: DesktopCredentialEnvelope): Promise<DesktopCredentialUnprotectResult>;
}

export type HostCapabilities = {
  vault?: VaultCapability;
  nativeWindow?: NativeWindowCapability;
  credentialProtection?: DesktopCredentialProtectionCapability;
};

export type HostRuntime = {
  kind: HostKind;
  capabilities: HostCapabilities;
};

/** Electron preload 只实现这些中性端口，renderer 不接触 Node.js、IPC 或绝对路径。 */
export type DesktopVaultPreloadBridge = Omit<DesktopVaultCapability, "kind">;
export type DesktopWindowPreloadBridge = NativeWindowCapability;
export type DesktopCredentialProtectionPreloadBridge = {
  getStatus(): Promise<CredentialHostResult<CredentialProtectionStatus>>;
  protectCredential(context: string, secret: string): Promise<CredentialHostResult<DesktopCredentialEnvelope>>;
  unprotectCredential(context: string, envelope: DesktopCredentialEnvelope): Promise<CredentialHostResult<DesktopCredentialUnprotectResult>>;
};
