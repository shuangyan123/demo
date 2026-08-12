import { extensionDb } from "../db/extension-db.ts";
import {
  currentDeclarativeExtensionRuntime,
  extensionPermissionByKind,
  resolveExtensionAuthorization,
  sameExtensionAuthorizationDeclaration,
  type ExtensionAuthorizationDecision,
} from "./declarative-extension-permissions.ts";
import type {
  DeclarativeExtensionPackage,
  ExtensionAsset,
  ExtensionKind,
  ExtensionManifestV1,
  InstalledExtensionRecord,
} from "../types/domains/declarative-extension.ts";

export const MAX_EXTENSION_PACKAGE_BYTES = 5 * 1024 * 1024;
const MAX_EXTENSION_ASSET_BYTES = 2 * 1024 * 1024;
const APP_VERSION = "0.1.0";
const FORBIDDEN_PATH = /(?:^|\/)(?:\.\.?)(?:\/|$)|\\|:|^\/|\.(?:c?js|mjs|html?|css|wasm|woff2?|ttf|otf)$/i;
const FORBIDDEN_MIME = /(?:javascript|ecmascript|text\/html|text\/css|application\/wasm|^font\/)/i;

type JsonRecord = Record<string, unknown>;

function objectValue(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as JsonRecord;
}

function assertKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} 包含未知字段：${unknown.join("、")}`);
}

function requiredText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 不能为空`);
  if (value.length > max) throw new Error(`${label} 超出长度限制`);
  return value.trim();
}

function stringList(value: unknown, label: string, max = 50): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} 必须是有效字符串列表`);
  }
  return value.map((item) => item.trim());
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string) => {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) throw new Error(`版本号无效：${value}`);
    return value.split("-")[0].split(".").map(Number);
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

/** 对对象键稳定排序，保证浏览器、测试和签名工具使用同一份字节。 */
export function canonicalExtensionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalExtensionJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalExtensionJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function unsignedPackage(value: DeclarativeExtensionPackage): unknown {
  const manifest = Object.fromEntries(Object.entries(value.manifest).filter(([key]) => key !== "contentSha256" && key !== "signature"));
  return { manifest, data: value.data, assets: value.assets };
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("扩展资产不是有效的 base64 数据");
  }
}

function assertNoRemoteRuntimeData(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/https?:\/\//i.test(serialized) || /@import\s|url\s*\(/i.test(serialized)) {
    throw new Error("扩展数据不得引用运行时 CDN、远程字体或远程资产");
  }
}

function validateThemeData(value: unknown): void {
  const root = objectValue(value, "主题数据");
  assertKeys(root, ["target", "theme"], "主题数据");
  if (!['light', 'dark', 'both'].includes(String(root.target))) throw new Error("主题目标无效");
  const theme = objectValue(root.theme, "主题配置");
  assertKeys(theme, ["name", "accent", "background", "foreground", "uiFont", "codeFont", "diffuseGradient", "contrast"], "主题配置");
  for (const key of ["name", "accent", "background", "foreground", "uiFont", "codeFont"]) requiredText(theme[key], `主题 ${key}`, 160);
  if (typeof theme.diffuseGradient !== "boolean") throw new Error("主题 diffuseGradient 必须是布尔值");
  if (!Number.isFinite(theme.contrast) || Number(theme.contrast) < -100 || Number(theme.contrast) > 100) throw new Error("主题 contrast 超出范围");
}

function validatePersonaData(value: unknown): void {
  const root = objectValue(value, "人设数据");
  assertKeys(root, ["persona", "voiceRef"], "人设数据");
  const persona = objectValue(root.persona, "教师人设");
  assertKeys(persona, ["id", "name", "role", "teachingStyle", "questioningStyle", "strictness", "verbosity", "customInstructions", "builtIn"], "教师人设");
  for (const key of ["id", "name", "role", "teachingStyle", "questioningStyle"]) requiredText(persona[key], `人设 ${key}`, 1000);
  if (!['gentle', 'balanced', 'strict'].includes(String(persona.strictness))) throw new Error("人设 strictness 无效");
  if (!['concise', 'balanced', 'detailed'].includes(String(persona.verbosity))) throw new Error("人设 verbosity 无效");
  if (typeof persona.customInstructions !== "string" || persona.builtIn !== false) throw new Error("扩展人设必须是可卸载的自定义人设");
  if (root.voiceRef !== undefined) {
    const voice = objectValue(root.voiceRef, "音色引用");
    assertKeys(voice, ["model", "voiceId", "style"], "音色引用");
    requiredText(voice.model, "音色模型", 160);
    requiredText(voice.voiceId, "Voice ID", 160);
    if (voice.style !== undefined && typeof voice.style !== "string") throw new Error("音色 style 无效");
  }
}

function validateStudyPackData(value: unknown): void {
  const root = objectValue(value, "学习包数据");
  assertKeys(root, ["title", "moduleIds", "promptTemplate", "steps"], "学习包数据");
  requiredText(root.title, "学习包标题", 120);
  stringList(root.moduleIds, "学习模块", 20);
  requiredText(root.promptTemplate, "学习提示词", 4000);
  stringList(root.steps, "学习步骤", 30);
}

function validateAutomationPackData(value: unknown): void {
  const root = objectValue(value, "已安排模板包");
  assertKeys(root, ["templates"], "已安排模板包");
  if (!Array.isArray(root.templates) || !root.templates.length || root.templates.length > 30) throw new Error("已安排模板数量无效");
  for (const templateValue of root.templates) {
    const template = objectValue(templateValue, "已安排模板");
    assertKeys(template, ["id", "name", "schedule", "scopes"], "已安排模板");
    requiredText(template.id, "模板 ID", 120);
    requiredText(template.name, "模板名称", 120);
    requiredText(template.schedule, "模板计划", 200);
    stringList(template.scopes, "模板数据范围", 10);
  }
}

function validateRubricPackData(value: unknown): void {
  const root = objectValue(value, "评分标准包");
  assertKeys(root, ["title", "dimensions"], "评分标准包");
  requiredText(root.title, "评分标准标题", 120);
  if (!Array.isArray(root.dimensions) || !root.dimensions.length || root.dimensions.length > 30) throw new Error("评分维度数量无效");
  for (const dimensionValue of root.dimensions) {
    const dimension = objectValue(dimensionValue, "评分维度");
    assertKeys(dimension, ["id", "label", "description", "weight"], "评分维度");
    requiredText(dimension.id, "评分维度 ID", 120);
    requiredText(dimension.label, "评分维度名称", 120);
    requiredText(dimension.description, "评分维度说明", 1000);
    if (!Number.isFinite(dimension.weight) || Number(dimension.weight) <= 0 || Number(dimension.weight) > 1) throw new Error("评分维度权重无效");
  }
}

const kindPermission = extensionPermissionByKind;

function validateData(kind: ExtensionKind, value: unknown): void {
  assertNoRemoteRuntimeData(value);
  if (kind === "theme") validateThemeData(value);
  else if (kind === "persona") validatePersonaData(value);
  else if (kind === "study-pack") validateStudyPackData(value);
  else if (kind === "automation-pack") validateAutomationPackData(value);
  else validateRubricPackData(value);
}

async function validateAssets(manifest: ExtensionManifestV1, assets: ExtensionAsset[]): Promise<void> {
  if (manifest.assets.length !== assets.length) throw new Error("资产清单与包内容不一致");
  let totalBytes = 0;
  for (const descriptor of manifest.assets) {
    const asset = assets.find((item) => item.path === descriptor.path);
    if (!asset) throw new Error(`缺少扩展资产：${descriptor.path}`);
    if (FORBIDDEN_PATH.test(descriptor.path) || FORBIDDEN_MIME.test(descriptor.mimeType)) throw new Error(`扩展资产类型被禁止：${descriptor.path}`);
    if (asset.mimeType !== descriptor.mimeType) throw new Error(`扩展资产 MIME 不一致：${descriptor.path}`);
    const bytes = decodeBase64(asset.dataBase64);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength !== descriptor.size || bytes.byteLength > MAX_EXTENSION_ASSET_BYTES) throw new Error(`扩展资产大小无效：${descriptor.path}`);
    if (await sha256Hex(bytes) !== descriptor.sha256) throw new Error(`扩展资产校验失败：${descriptor.path}`);
  }
  if (totalBytes > MAX_EXTENSION_PACKAGE_BYTES) throw new Error("扩展资产总量超过 5MB");
}

function validateManifest(value: unknown): ExtensionManifestV1 {
  const manifest = objectValue(value, "扩展清单");
  assertKeys(manifest, ["schemaVersion", "id", "version", "minAppVersion", "kind", "name", "author", "description", "entry", "permissions", "assets", "contentSha256", "signature"], "扩展清单");
  if (manifest.schemaVersion !== 1) throw new Error("只支持 ExtensionManifestV1");
  const id = requiredText(manifest.id, "扩展 ID", 120);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(id)) throw new Error("扩展 ID 必须使用反向域名或带分隔符的小写格式");
  const kind = manifest.kind as ExtensionKind;
  if (!Object.keys(kindPermission).includes(kind)) throw new Error("扩展类型无效");
  requiredText(manifest.name, "扩展名称", 120);
  requiredText(manifest.description, "扩展说明", 500);
  if (requiredText(manifest.entry, "数据入口", 120) !== "data.json") throw new Error("V1 数据入口固定为 data.json");
  if (compareSemver(APP_VERSION, requiredText(manifest.minAppVersion, "最低应用版本", 40)) < 0) throw new Error("当前应用版本低于扩展要求");
  compareSemver(requiredText(manifest.version, "扩展版本", 40), "0.0.0");
  const permissions = stringList(manifest.permissions, "扩展权限", 8);
  if (permissions.length !== 1 || permissions[0] !== kindPermission[kind]) throw new Error("扩展权限与类型不匹配");
  const author = objectValue(manifest.author, "扩展作者");
  assertKeys(author, ["name", "url"], "扩展作者");
  requiredText(author.name, "作者名称", 120);
  if (author.url !== undefined && (typeof author.url !== "string" || !/^https:\/\//.test(author.url))) throw new Error("作者网址必须使用 HTTPS");
  if (!Array.isArray(manifest.assets) || manifest.assets.length > 100) throw new Error("扩展资产清单无效");
  for (const assetValue of manifest.assets) {
    const asset = objectValue(assetValue, "资产清单项");
    assertKeys(asset, ["path", "mimeType", "size", "sha256"], "资产清单项");
    requiredText(asset.path, "资产路径", 240);
    requiredText(asset.mimeType, "资产 MIME", 120);
    if (!Number.isInteger(asset.size) || Number(asset.size) < 0) throw new Error("资产大小无效");
    if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("资产 SHA-256 无效");
  }
  if (typeof manifest.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.contentSha256)) throw new Error("扩展内容 SHA-256 无效");
  const signature = objectValue(manifest.signature, "扩展签名");
  assertKeys(signature, ["algorithm", "publicKeyJwk", "value"], "扩展签名");
  if (signature.algorithm !== "ECDSA_P256_SHA256") throw new Error("扩展签名算法无效");
  requiredText(signature.value, "扩展签名值", 512);
  const jwk = objectValue(signature.publicKeyJwk, "签名公钥");
  assertKeys(jwk, ["kty", "crv", "x", "y", "key_ops", "ext", "alg", "use", "kid"], "签名公钥");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("扩展签名公钥无效");
  return value as ExtensionManifestV1;
}

/** 严格校验包结构、资产摘要、内容摘要与 ECDSA 签名。 */
export async function validateExtensionPackage(value: unknown): Promise<DeclarativeExtensionPackage> {
  const root = objectValue(value, "扩展包");
  assertKeys(root, ["manifest", "data", "assets"], "扩展包");
  const manifest = validateManifest(root.manifest);
  if (!Array.isArray(root.assets)) throw new Error("扩展 assets 必须是列表");
  for (const assetValue of root.assets) {
    const asset = objectValue(assetValue, "扩展资产");
    assertKeys(asset, ["path", "mimeType", "dataBase64"], "扩展资产");
  }
  const extensionPackage = value as DeclarativeExtensionPackage;
  validateData(manifest.kind, extensionPackage.data);
  await validateAssets(manifest, extensionPackage.assets);
  const canonical = canonicalExtensionJson(unsignedPackage(extensionPackage));
  if (new TextEncoder().encode(canonical).byteLength > MAX_EXTENSION_PACKAGE_BYTES) throw new Error("扩展包超过 5MB");
  if (await sha256Hex(canonical) !== manifest.contentSha256) throw new Error("扩展内容 SHA-256 不匹配");
  const publicKey = await crypto.subtle.importKey("jwk", manifest.signature.publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    Uint8Array.from(decodeBase64(manifest.signature.value)).buffer,
    new TextEncoder().encode(canonical),
  );
  if (!validSignature) throw new Error("扩展签名验证失败");
  return extensionPackage;
}

/** 安装或升级声明式扩展；升级时保留一个可回滚版本。 */
export async function installExtension(value: unknown, source: InstalledExtensionRecord["source"]): Promise<InstalledExtensionRecord> {
  const extensionPackage = await validateExtensionPackage(value);
  const existing = await extensionDb.extensions.get(extensionPackage.manifest.id);
  const existingVersion = existing?.package?.manifest?.version;
  if (existingVersion && compareSemver(extensionPackage.manifest.version, existingVersion) < 0) throw new Error("扩展版本低于已安装版本，请使用回滚操作");
  const now = new Date().toISOString();
  const declarationChanged = existing ? !sameExtensionAuthorizationDeclaration(existing.package?.manifest, extensionPackage.manifest) : false;
  const record: InstalledExtensionRecord = {
    id: extensionPackage.manifest.id,
    kind: extensionPackage.manifest.kind,
    // 新版本若改变声明，旧 enabled 只代表旧包状态，不能默默授权新要求。
    enabled: declarationChanged ? false : existing?.enabled === true,
    source,
    package: extensionPackage,
    previousPackage: existing?.package && existing.package.manifest.version !== extensionPackage.manifest.version ? existing.package : existing?.previousPackage,
    rollbackData: existing?.rollbackData,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  await extensionDb.extensions.put(record);
  return record;
}

type ExtensionAuthorizationFailure = Exclude<ExtensionAuthorizationDecision, { status: "ready" }>;

export class ExtensionAuthorizationError extends Error {
  readonly decision: ExtensionAuthorizationFailure;

  constructor(decision: ExtensionAuthorizationFailure) {
    const message = decision.status === "invalid"
      ? "扩展声明无效，已阻止执行"
      : decision.reason === "extension_disabled"
        ? "扩展已停用，已阻止执行"
        : decision.reason === "capability_unavailable"
          ? "当前应用尚无该扩展的可执行入口"
          : "扩展所需的当前产品权限不可用";
    super(message);
    this.name = "ExtensionAuthorizationError";
    this.decision = decision;
  }
}

export async function inspectInstalledExtensionAuthorization(id: string): Promise<{
  record?: InstalledExtensionRecord;
  decision: ExtensionAuthorizationDecision;
}> {
  const record = await extensionDb.extensions.get(id);
  if (!record) return { decision: { status: "invalid", reason: "extension_invalid", declaredPermissions: [] } };
  return {
    record,
    decision: resolveExtensionAuthorization({
      declaration: record.package?.manifest,
      enabled: record.enabled,
      expectedId: record.id,
      expectedKind: record.kind,
      availablePermissions: currentDeclarativeExtensionRuntime.availablePermissions,
      lowerLevelPermissions: currentDeclarativeExtensionRuntime.lowerLevelPermissions,
    }),
  };
}

/** 显式启用的状态转换预检；它不执行扩展动作，也不把声明自动升级为授权。 */
export async function assertInstalledExtensionCanEnable(id: string): Promise<InstalledExtensionRecord> {
  const authorization = await inspectInstalledExtensionAuthorization(id); if (!authorization.record) throw new Error("扩展尚未安装");
  const decision = resolveExtensionAuthorization({ declaration: authorization.record.package?.manifest, enabled: true, expectedId: authorization.record.id, expectedKind: authorization.record.kind, availablePermissions: currentDeclarativeExtensionRuntime.availablePermissions, lowerLevelPermissions: currentDeclarativeExtensionRuntime.lowerLevelPermissions });
  if (decision.status !== "ready") throw new ExtensionAuthorizationError(decision); return authorization.record;
}

/** 所有声明式扩展真实应用入口的共同边界；回调执行前重新读取当前记录。 */
export async function executeInstalledExtensionAction<T>(
  id: string,
  action: (record: InstalledExtensionRecord) => T | Promise<T>,
): Promise<T> {
  const authorization = await inspectInstalledExtensionAuthorization(id);
  if (!authorization.record) throw new Error("扩展尚未安装");
  if (authorization.decision.status !== "ready") throw new ExtensionAuthorizationError(authorization.decision);
  return action(authorization.record);
}

export const declarativeExtensionRepository = {
  list: () => extensionDb.extensions.orderBy("updatedAt").reverse().toArray(),
  get: (id: string) => extensionDb.extensions.get(id),
  install: installExtension,

  async setEnabled(id: string, enabled: boolean, rollbackData?: unknown): Promise<InstalledExtensionRecord> {
    return extensionDb.transaction("rw", extensionDb.extensions, async () => {
      const existing = await extensionDb.extensions.get(id);
      if (!existing) throw new Error("扩展尚未安装");
      if (enabled) {
        const decision = resolveExtensionAuthorization({
          declaration: existing.package?.manifest,
          enabled: true,
          expectedId: existing.id,
          expectedKind: existing.kind,
          availablePermissions: currentDeclarativeExtensionRuntime.availablePermissions,
          lowerLevelPermissions: currentDeclarativeExtensionRuntime.lowerLevelPermissions,
        });
        if (decision.status !== "ready") throw new ExtensionAuthorizationError(decision);
      }
      const updated = { ...existing, enabled: enabled === true, rollbackData: enabled === true ? rollbackData : undefined, updatedAt: new Date().toISOString() };
      await extensionDb.extensions.put(updated);
      return updated;
    });
  },

  async rollback(id: string): Promise<InstalledExtensionRecord> {
    const existing = await extensionDb.extensions.get(id);
    if (!existing?.previousPackage) throw new Error("没有可回滚的扩展版本");
    const updated: InstalledExtensionRecord = {
      ...existing,
      enabled: false,
      package: existing.previousPackage,
      previousPackage: existing.package,
      rollbackData: undefined,
      updatedAt: new Date().toISOString(),
    };
    await extensionDb.extensions.put(updated);
    return updated;
  },

  async uninstall(id: string): Promise<InstalledExtensionRecord | undefined> {
    const existing = await extensionDb.extensions.get(id);
    await extensionDb.extensions.delete(id);
    return existing;
  },

  async exportPackage(id: string): Promise<string> {
    const existing = await extensionDb.extensions.get(id);
    if (!existing) throw new Error("扩展尚未安装");
    if (!existing.package?.manifest) throw new ExtensionAuthorizationError({ status: "invalid", reason: "extension_invalid", declaredPermissions: [] });
    return JSON.stringify(existing.package, null, 2);
  },

  async enabledPackages(): Promise<DeclarativeExtensionPackage[]> {
    return (await extensionDb.extensions.toArray()).filter((record) => record.enabled && record.package?.manifest).map((record) => record.package);
  },

  async reset(): Promise<void> {
    extensionDb.close();
    await extensionDb.delete();
  },
};
