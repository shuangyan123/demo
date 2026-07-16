export type ExtensionKind = "theme" | "persona" | "study-pack" | "automation-pack" | "rubric-pack";
export type ExtensionPermission = "appearance.write" | "persona.write" | "study.read" | "automation.template" | "rubric.read";

export type ExtensionAuthor = {
  name: string;
  url?: string;
};

export type ExtensionAssetManifest = {
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
};

export type ExtensionSignature = {
  algorithm: "ECDSA_P256_SHA256";
  publicKeyJwk: JsonWebKey;
  value: string;
};

/** 声明式扩展清单；不允许声明脚本入口或远程运行时代码。 */
export type ExtensionManifestV1 = {
  schemaVersion: 1;
  id: string;
  version: string;
  minAppVersion: string;
  kind: ExtensionKind;
  name: string;
  author: ExtensionAuthor;
  description: string;
  entry: string;
  permissions: ExtensionPermission[];
  assets: ExtensionAssetManifest[];
  contentSha256: string;
  signature: ExtensionSignature;
};

export type ExtensionAsset = {
  path: string;
  mimeType: string;
  dataBase64: string;
};

export type ThemeExtensionData = {
  target: "light" | "dark" | "both";
  theme: {
    name: string;
    accent: string;
    background: string;
    foreground: string;
    uiFont: string;
    codeFont: string;
    diffuseGradient: boolean;
    contrast: number;
  };
};

export type PersonaExtensionData = {
  persona: {
    id: string;
    name: string;
    role: string;
    teachingStyle: string;
    questioningStyle: string;
    strictness: "gentle" | "balanced" | "strict";
    verbosity: "concise" | "balanced" | "detailed";
    customInstructions: string;
    builtIn: false;
  };
  voiceRef?: {
    model: string;
    voiceId: string;
    style?: string;
  };
};

export type StudyPackExtensionData = {
  title: string;
  moduleIds: string[];
  promptTemplate: string;
  steps: string[];
};

export type AutomationPackExtensionData = {
  templates: Array<{
    id: string;
    name: string;
    schedule: string;
    scopes: string[];
  }>;
};

export type RubricPackExtensionData = {
  title: string;
  dimensions: Array<{
    id: string;
    label: string;
    description: string;
    weight: number;
  }>;
};

export type ExtensionData = ThemeExtensionData | PersonaExtensionData | StudyPackExtensionData | AutomationPackExtensionData | RubricPackExtensionData;

export type DeclarativeExtensionPackage = {
  manifest: ExtensionManifestV1;
  data: ExtensionData;
  assets: ExtensionAsset[];
};

export type InstalledExtensionRecord = {
  id: string;
  kind: ExtensionKind;
  enabled: boolean;
  source: "catalog" | "local";
  package: DeclarativeExtensionPackage;
  previousPackage?: DeclarativeExtensionPackage;
  rollbackData?: unknown;
  installedAt: string;
  updatedAt: string;
};
