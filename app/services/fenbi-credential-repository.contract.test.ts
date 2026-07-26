import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("粉笔 Cookie 使用本机 AES-GCM 密文保存且可按需解密", async () => {
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  const { FENBI_CREDENTIAL_STORAGE_KEY, fenbiCredentialRepository } = await import("./fenbi-credential-repository.ts");
  const cookie = "session=fenbi-contract-secret";
  const saved = await fenbiCredentialRepository.save(cookie);
  const serialized = localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY) ?? "";

  assert.doesNotMatch(serialized, /fenbi-contract-secret/);
  assert.equal(saved.maskedCookie, "sess...cret");
  assert.equal(await fenbiCredentialRepository.reveal(), cookie);
  fenbiCredentialRepository.clear();
  assert.equal(localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY), null);
});

