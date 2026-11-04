/** 仅为本地模拟版本公告，不包含安装包、URL、签名或执行能力。 */
export type MockUpdateMetadata = Readonly<{
  schemaVersion: 1;
  product: "recall";
  channel: "local-mock";
  platform: "win32";
  arch: "x64";
  installer: "nsis";
  version: string;
  minimumCurrentVersion: string;
  releaseNotes: string;
}>;

export type UpdateCheckResult =
  | { kind: "available" | "current" | "ahead"; metadata: MockUpdateMetadata }
  | { kind: "incompatible" | "invalid" | "failed" | "disabled" };
