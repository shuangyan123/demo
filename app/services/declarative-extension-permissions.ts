import type { ExtensionKind, ExtensionPermission } from "../types/domains/declarative-extension.ts";

export const extensionPermissionByKind: Readonly<Record<ExtensionKind, ExtensionPermission>> = {
  theme: "appearance.write",
  persona: "persona.write",
  "study-pack": "study.read",
  "automation-pack": "automation.template",
  "rubric-pack": "rubric.read",
};

export const currentDeclarativeExtensionRuntime: Readonly<{
  availablePermissions: readonly ExtensionPermission[];
  lowerLevelPermissions: readonly ExtensionPermission[];
}> = {
  // 当前只有主题和人设存在真实的应用入口；其他包仍是受校验的数据声明，没有执行 runtime。
  availablePermissions: ["appearance.write", "persona.write"],
  // 这些是现有产品本地设置边界，不是由 manifest 或 enabled 状态自动授予的权限。
  lowerLevelPermissions: ["appearance.write", "persona.write"],
};

const MANIFEST_KEYS = ["schemaVersion", "id", "version", "minAppVersion", "kind", "name", "author", "description", "entry", "permissions", "assets", "contentSha256", "signature"] as const;
const AUTHOR_KEYS = ["name", "url"] as const;
const ASSET_KEYS = ["path", "mimeType", "size", "sha256"] as const;
const SIGNATURE_KEYS = ["algorithm", "publicKeyJwk", "value"] as const;
const JWK_KEYS = ["kty", "crv", "x", "y", "key_ops", "ext", "alg", "use", "kid"] as const;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_ASSET_PATH = /(?:^|\/)(?:\.\.?)(?:\/|$)|\\|:|^\/|\.(?:c?js|mjs|html?|css|wasm|woff2?|ttf|otf)$/i;
const FORBIDDEN_ASSET_MIME = /(?:javascript|ecmascript|text\/html|text\/css|application\/wasm|^font\/)/i;

export type ExtensionAuthorizationReason =
  | "extension_disabled"
  | "extension_invalid"
  | "capability_unavailable"
  | "permission_missing";

export type ExtensionAuthorizationDecision =
  | {
      status: "ready";
      declaredPermissions: ExtensionPermission[];
    }
  | {
      status: "blocked";
      reason: Exclude<ExtensionAuthorizationReason, "extension_invalid">;
      declaredPermissions: ExtensionPermission[];
      missingPermissions: ExtensionPermission[];
    }
  | {
      status: "invalid";
      reason: "extension_invalid";
      declaredPermissions: ExtensionPermission[];
    };

export type ExtensionAuthorizationInput = {
  declaration: unknown;
  enabled: unknown;
  expectedId?: string;
  expectedKind?: ExtensionKind;
  availablePermissions: readonly ExtensionPermission[];
  lowerLevelPermissions: readonly ExtensionPermission[];
};

function invalidDecision(): ExtensionAuthorizationDecision {
  return { status: "invalid", reason: "extension_invalid", declaredPermissions: [] };
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function readDeclaration(value: unknown): { id: string; kind: ExtensionKind; permission: ExtensionPermission } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const declaration = value as {
    schemaVersion?: unknown;
    id?: unknown;
    version?: unknown;
    minAppVersion?: unknown;
    kind?: unknown;
    name?: unknown;
    author?: unknown;
    description?: unknown;
    entry?: unknown;
    permissions?: unknown;
    assets?: unknown;
    contentSha256?: unknown;
    signature?: unknown;
  };
  if (!hasOnlyKeys(declaration, MANIFEST_KEYS)) return undefined;
  if (
    declaration.schemaVersion !== 1
    || typeof declaration.version !== "string" || !SEMVER_PATTERN.test(declaration.version)
    || typeof declaration.minAppVersion !== "string" || !SEMVER_PATTERN.test(declaration.minAppVersion)
    || typeof declaration.name !== "string" || !declaration.name.trim()
    || !declaration.author
    || typeof declaration.author !== "object"
    || Array.isArray(declaration.author)
    || typeof (declaration.author as { name?: unknown }).name !== "string"
    || !hasOnlyKeys(declaration.author, AUTHOR_KEYS)
    || (declaration.author as { url?: unknown }).url !== undefined && (typeof (declaration.author as { url?: unknown }).url !== "string" || !/^https:\/\//.test((declaration.author as { url?: string }).url!))
    || typeof declaration.description !== "string" || !declaration.description.trim()
    || declaration.entry !== "data.json"
    || !Array.isArray(declaration.assets)
    || typeof declaration.contentSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(declaration.contentSha256)
    || !declaration.signature
    || typeof declaration.signature !== "object"
    || Array.isArray(declaration.signature)
  ) return undefined;
  if ((declaration.assets as unknown[]).some((assetValue) => {
    if (!assetValue || typeof assetValue !== "object" || Array.isArray(assetValue) || !hasOnlyKeys(assetValue, ASSET_KEYS)) return true;
    const asset = assetValue as { path?: unknown; mimeType?: unknown; size?: unknown; sha256?: unknown };
    return typeof asset.path !== "string" || !asset.path.trim() || FORBIDDEN_ASSET_PATH.test(asset.path)
      || typeof asset.mimeType !== "string" || !asset.mimeType.trim() || FORBIDDEN_ASSET_MIME.test(asset.mimeType)
      || !Number.isInteger(asset.size) || Number(asset.size) < 0
      || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256);
  })) return undefined;
  const signature = declaration.signature as { algorithm?: unknown; publicKeyJwk?: unknown; value?: unknown };
  if (
    signature.algorithm !== "ECDSA_P256_SHA256"
    || typeof signature.value !== "string"
    || !signature.publicKeyJwk
    || typeof signature.publicKeyJwk !== "object"
    || Array.isArray(signature.publicKeyJwk)
  ) return undefined;
  if (!hasOnlyKeys(signature, SIGNATURE_KEYS) || !hasOnlyKeys(signature.publicKeyJwk, JWK_KEYS)) return undefined;
  const jwk = signature.publicKeyJwk as { kty?: unknown; crv?: unknown; x?: unknown; y?: unknown };
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") return undefined;
  if (typeof declaration.id !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(declaration.id)) return undefined;
  if (
    typeof declaration.kind !== "string"
    || !Object.prototype.hasOwnProperty.call(extensionPermissionByKind, declaration.kind)
  ) return undefined;
  if (!Array.isArray(declaration.permissions) || declaration.permissions.length !== 1 || typeof declaration.permissions[0] !== "string") return undefined;
  const kind = declaration.kind as ExtensionKind;
  const permission = declaration.permissions[0] as ExtensionPermission;
  if (permission !== extensionPermissionByKind[kind]) return undefined;
  return { id: declaration.id, kind, permission };
}

/**
 * 纯决策核：只解释声明、当前启用状态和当前产品/底层能力快照，不访问存储或执行任何副作用。
 * declaration 只描述要求；只有显式传入的当前边界也满足时才返回 ready。
 */
export function resolveExtensionAuthorization(input: ExtensionAuthorizationInput): ExtensionAuthorizationDecision {
  const parsed = readDeclaration(input.declaration);
  if (!parsed) return invalidDecision();
  if (input.expectedId !== undefined && parsed.id !== input.expectedId) return invalidDecision();
  if (input.expectedKind !== undefined && parsed.kind !== input.expectedKind) return invalidDecision();

  const declaredPermissions = [parsed.permission];
  if (input.enabled !== true) {
    return { status: "blocked", reason: "extension_disabled", declaredPermissions, missingPermissions: [] };
  }

  const missingAvailability = declaredPermissions.filter((permission) => !input.availablePermissions.includes(permission));
  if (missingAvailability.length) {
    return { status: "blocked", reason: "capability_unavailable", declaredPermissions, missingPermissions: missingAvailability };
  }

  const missingLowerLevelPermission = declaredPermissions.filter((permission) => !input.lowerLevelPermissions.includes(permission));
  if (missingLowerLevelPermission.length) {
    return { status: "blocked", reason: "permission_missing", declaredPermissions, missingPermissions: missingLowerLevelPermission };
  }

  return { status: "ready", declaredPermissions };
}

/** 只比较会影响授权的声明字段；升级引入新要求时不得继承旧 enabled 状态。 */
export function sameExtensionAuthorizationDeclaration(left: unknown, right: unknown): boolean {
  const leftParsed = readDeclaration(left);
  const rightParsed = readDeclaration(right);
  return Boolean(leftParsed && rightParsed && leftParsed.kind === rightParsed.kind && leftParsed.permission === rightParsed.permission);
}

export function extensionAuthorizationMessage(decision: ExtensionAuthorizationDecision): string {
  if (decision.status === "invalid") return "扩展声明无效，无法执行；请重新安装经过校验的扩展包。";
  if (decision.status === "ready") return "扩展当前已启用并满足可执行条件。";
  if (decision.reason === "extension_disabled") return "扩展已停用；重新启用后才能使用。";
  if (decision.reason === "capability_unavailable") return "当前应用暂不提供该扩展的可执行能力。";
  return "扩展所需的当前产品权限不可用，请先完成对应配置。";
}
