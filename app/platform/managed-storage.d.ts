/** 由 Host resolver 或受信 process composition 重建；不通过 preload/HTTP 接收路径。 */
declare const trustedStorageResolution: unique symbol;
export type ManagedStorageHostConfig = Readonly<{
  [trustedStorageResolution]: true;
  profileId: string;
  epochId: string;
  managedRoot: string;
  profileRoot: string;
  managedFilesRoot: string;
}>;

export type ManagedStorageResolution =
  | Readonly<{ kind: "legacy_existing_profile" | "ready"; config: ManagedStorageHostConfig }>
  | Readonly<{ kind: "uninitialized" }>
  | Readonly<{ kind: "unavailable"; code: "storage_unavailable"; reason: string }>
  | Readonly<{ kind: "corrupt"; reason: string }>
  | Readonly<{ kind: "unsupported_version"; version: number }>;
