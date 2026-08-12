import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { extensionDb } from "../db/extension-db.ts";
import { officialDeclarativeExtensionCatalog } from "./declarative-extension-catalog.ts";
import {
  canonicalExtensionJson,
  declarativeExtensionRepository,
  executeInstalledExtensionAction,
  ExtensionAuthorizationError,
  inspectInstalledExtensionAuthorization,
  validateExtensionPackage,
} from "./declarative-extension-service.ts";
import {
  currentDeclarativeExtensionRuntime,
  resolveExtensionAuthorization,
  sameExtensionAuthorizationDeclaration,
} from "./declarative-extension-permissions.ts";
import type { DeclarativeExtensionPackage } from "../types/domains/declarative-extension.ts";

async function resetExtensions(): Promise<void> {
  extensionDb.close();
  await extensionDb.delete();
  await extensionDb.open();
}

function blockedReason(decision: ReturnType<typeof resolveExtensionAuthorization>): string {
  if (decision.status !== "blocked") throw new Error(`expected blocked decision, got ${decision.status}`);
  return decision.reason;
}

async function createSignedPackage(
  base: DeclarativeExtensionPackage,
  manifestPatch: Partial<DeclarativeExtensionPackage["manifest"]>,
  data: DeclarativeExtensionPackage["data"] = base.data,
): Promise<DeclarativeExtensionPackage> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const manifest = { ...base.manifest, ...manifestPatch };
  const unsignedManifest = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "contentSha256" && key !== "signature"),
  );
  const unsignedPackage = { manifest: unsignedManifest, data, assets: structuredClone(base.assets) };
  const canonical = canonicalExtensionJson(unsignedPackage);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(canonical),
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    manifest: {
      ...manifest,
      contentSha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      signature: { algorithm: "ECDSA_P256_SHA256", publicKeyJwk, value: Buffer.from(signature).toString("base64") },
    },
    data,
    assets: structuredClone(base.assets),
  };
}

test("官方声明式扩展通过摘要和签名校验", async () => {
  for (const extensionPackage of officialDeclarativeExtensionCatalog) {
    const validated = await validateExtensionPackage(extensionPackage);
    assert.equal(validated.manifest.id, extensionPackage.manifest.id);
  }
});

test("声明式扩展完成安装、启用、导出和卸载生命周期", async () => {
  await resetExtensions();
  const extensionPackage = officialDeclarativeExtensionCatalog[0];
  const installed = await declarativeExtensionRepository.install(extensionPackage, "catalog");
  assert.equal(installed.enabled, false);
  assert.equal((await declarativeExtensionRepository.setEnabled(installed.id, true, { lightTheme: {}, darkTheme: {} })).enabled, true);
  assert.equal(JSON.parse(await declarativeExtensionRepository.exportPackage(installed.id)).manifest.id, installed.id);
  assert.equal((await declarativeExtensionRepository.enabledPackages()).length, 1);
  await declarativeExtensionRepository.uninstall(installed.id);
  assert.equal(await extensionDb.extensions.count(), 0);
});

test("声明不是授权，启用状态还必须通过当前能力和底层权限交集", async () => {
  const declaration = officialDeclarativeExtensionCatalog[0].manifest;
  assert.deepEqual(
    resolveExtensionAuthorization({
      declaration,
      enabled: true,
      availablePermissions: currentDeclarativeExtensionRuntime.availablePermissions,
      lowerLevelPermissions: currentDeclarativeExtensionRuntime.lowerLevelPermissions,
    }),
    { status: "ready", declaredPermissions: ["appearance.write"] },
  );
  assert.equal(blockedReason(resolveExtensionAuthorization({
    declaration,
    enabled: false,
    availablePermissions: ["appearance.write"],
    lowerLevelPermissions: ["appearance.write"],
  })), "extension_disabled");
  assert.equal(blockedReason(resolveExtensionAuthorization({
    declaration,
    enabled: true,
    availablePermissions: [],
    lowerLevelPermissions: ["appearance.write"],
  })), "capability_unavailable");
  assert.equal(blockedReason(resolveExtensionAuthorization({
    declaration,
    enabled: true,
    availablePermissions: ["appearance.write"],
    lowerLevelPermissions: [],
  })), "permission_missing");
  assert.equal(resolveExtensionAuthorization({
    declaration: { ...declaration, permissions: ["unknown.permission"] },
    enabled: true,
    availablePermissions: ["appearance.write"],
    lowerLevelPermissions: ["appearance.write"],
  }).status, "invalid");
  assert.equal(sameExtensionAuthorizationDeclaration(declaration, structuredClone(declaration)), true);
  assert.equal(sameExtensionAuthorizationDeclaration(declaration, { ...declaration, kind: "persona", permissions: ["persona.write"] }), false);
});

test("声明式扩展停用或底层能力缺失时，在副作用前阻断并保持持久化状态安全", async () => {
  await resetExtensions();
  const installed = await declarativeExtensionRepository.install(officialDeclarativeExtensionCatalog[0], "catalog");
  await declarativeExtensionRepository.setEnabled(installed.id, true);
  let sideEffects = 0;
  const capturedAction = () => executeInstalledExtensionAction(installed.id, () => {
    sideEffects += 1;
    return "applied";
  });
  assert.equal(await capturedAction(), "applied");
  assert.equal(sideEffects, 1);

  await declarativeExtensionRepository.setEnabled(installed.id, false);
  await assert.rejects(
    capturedAction,
    (error: unknown) => error instanceof ExtensionAuthorizationError
      && error.decision.status === "blocked"
      && error.decision.reason === "extension_disabled",
  );
  assert.equal(sideEffects, 1);
  assert.equal(blockedReason((await inspectInstalledExtensionAuthorization(installed.id)).decision), "extension_disabled");

  const unsupported = await declarativeExtensionRepository.install(officialDeclarativeExtensionCatalog[2], "catalog");
  await assert.rejects(
    () => declarativeExtensionRepository.setEnabled(unsupported.id, true),
    (error: unknown) => error instanceof ExtensionAuthorizationError
      && error.decision.status === "blocked"
      && error.decision.reason === "capability_unavailable",
  );
  assert.equal((await declarativeExtensionRepository.get(unsupported.id))?.enabled, false);

  await extensionDb.extensions.put({
    id: "org.example.malformed",
    kind: "theme",
    enabled: true,
    source: "local",
    installedAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  } as never);
  assert.equal((await inspectInstalledExtensionAuthorization("org.example.malformed")).decision.status, "invalid");
  await assert.rejects(() => executeInstalledExtensionAction("org.example.malformed", () => {
    sideEffects += 1;
  }), ExtensionAuthorizationError);
  assert.equal(sideEffects, 1);
});

test("扩展升级若改变授权声明则清除旧 enabled，而声明不变的合法升级保留 enabled", async () => {
  await resetExtensions();
  const v1 = officialDeclarativeExtensionCatalog[0];
  const installed = await declarativeExtensionRepository.install(v1, "catalog");
  await declarativeExtensionRepository.setEnabled(installed.id, true);

  const unchangedV2 = await createSignedPackage(v1, { version: "2.0.0", name: "专注纸张 2" });
  const preserved = await declarativeExtensionRepository.install(unchangedV2, "catalog");
  assert.equal(preserved.enabled, true);
  assert.equal(preserved.package.manifest.version, "2.0.0");

  const changedV3 = await createSignedPackage(
    officialDeclarativeExtensionCatalog[1],
    { id: v1.manifest.id, version: "3.0.0", name: "专注纸张教师版" },
  );
  const cleared = await declarativeExtensionRepository.install(changedV3, "catalog");
  assert.equal(cleared.enabled, false);
  assert.equal(cleared.previousPackage?.manifest.version, "2.0.0");
  const decision = (await inspectInstalledExtensionAuthorization(cleared.id)).decision;
  assert.equal(decision.status, "blocked");
  if (decision.status === "blocked") assert.equal(decision.reason, "extension_disabled");
});

test("未知字段、恶意路径、超大资产、错误签名和版本冲突包全部拒绝", async () => {
  const base = officialDeclarativeExtensionCatalog[0];
  const unknownField = structuredClone(base) as typeof base & { unexpected?: boolean };
  unknownField.unexpected = true;
  await assert.rejects(() => validateExtensionPackage(unknownField), /未知字段/);

  const maliciousPath = structuredClone(base);
  maliciousPath.manifest.assets = [{ path: "../evil.js", mimeType: "application/javascript", size: 1, sha256: "0".repeat(64) }];
  maliciousPath.assets = [{ path: "../evil.js", mimeType: "application/javascript", dataBase64: "AA==" }];
  await assert.rejects(() => validateExtensionPackage(maliciousPath), /类型被禁止/);

  const oversized = structuredClone(base);
  oversized.manifest.assets = [{ path: "preview.png", mimeType: "image/png", size: 2 * 1024 * 1024 + 1, sha256: "0".repeat(64) }];
  oversized.assets = [{ path: "preview.png", mimeType: "image/png", dataBase64: "AA==" }];
  await assert.rejects(() => validateExtensionPackage(oversized), /大小无效/);

  const invalidSignature = structuredClone(base);
  invalidSignature.manifest.signature.value = "AA==";
  await assert.rejects(() => validateExtensionPackage(invalidSignature), /签名验证失败/);

  const incompatibleVersion = structuredClone(base);
  incompatibleVersion.manifest.minAppVersion = "99.0.0";
  await assert.rejects(() => validateExtensionPackage(incompatibleVersion), /应用版本低于扩展要求/);
});

test.after(async () => {
  extensionDb.close();
  await extensionDb.delete();
});
