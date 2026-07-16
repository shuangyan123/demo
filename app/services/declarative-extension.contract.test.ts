import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { extensionDb } from "../db/extension-db.ts";
import { officialDeclarativeExtensionCatalog } from "./declarative-extension-catalog.ts";
import { declarativeExtensionRepository, validateExtensionPackage } from "./declarative-extension-service.ts";

async function resetExtensions(): Promise<void> {
  extensionDb.close();
  await extensionDb.delete();
  await extensionDb.open();
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
