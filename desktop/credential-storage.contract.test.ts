import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CredentialHostError,
  createCredentialEnvelope,
  createProtectedPayload,
  decodeCredentialEnvelope,
  readProtectedPayload,
} from "./credential-storage-envelope.ts";

const ipc = readFileSync(new URL("./credential-storage.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

test("Desktop credential envelope round-trip binds context and rejects substitution", () => {
  const context = "ai-connection:profile:api-key";
  const payload = createProtectedPayload(context, "sentinel-secret");
  const envelope = createCredentialEnvelope(context, Buffer.from(payload, "utf8"));
  const decoded = decodeCredentialEnvelope(context, envelope);
  assert.equal(readProtectedPayload(context, decoded.toString("utf8")), "sentinel-secret");
  assert.throws(
    () => decodeCredentialEnvelope("mcp:server:bearer-token", envelope),
    (error: unknown) => error instanceof CredentialHostError && error.code === "host_context_mismatch",
  );
});

test("Desktop credential envelope rejects unknown versions, invalid shape and oversized payloads", () => {
  assert.throws(
    () => decodeCredentialEnvelope("ai-connection:profile:api-key", { version: "desktop-v2", context: "ai-connection:profile:api-key", payload: "AAAA" }),
    (error: unknown) => error instanceof CredentialHostError && error.code === "host_payload_invalid",
  );
  assert.throws(
    () => decodeCredentialEnvelope("ai-connection:profile:api-key", { version: "desktop-v1", context: "ai-connection:profile:api-key", payload: "not-base64" }),
    (error: unknown) => error instanceof CredentialHostError && error.code === "host_payload_invalid",
  );
  assert.throws(
    () => createCredentialEnvelope("ai-connection:profile:api-key", new Uint8Array(128 * 1024 + 1)),
    (error: unknown) => error instanceof CredentialHostError && error.code === "host_protection_failed",
  );
  assert.throws(
    () => readProtectedPayload("ai-connection:profile:api-key", JSON.stringify({ version: "desktop-v2", context: "ai-connection:profile:api-key", secret: "sentinel" })),
    (error: unknown) => error instanceof CredentialHostError && error.code === "host_payload_invalid",
  );
  assert.throws(
    () => readProtectedPayload("ai-connection:profile:api-key", JSON.stringify({ version: "desktop-v1", context: "mcp:server:bearer-token", secret: "sentinel" })),
    (error: unknown) => error instanceof CredentialHostError && error.code === "host_context_mismatch",
  );
});

test("Real Electron host integration is async, sender-checked and fail-closed", () => {
  assert.match(ipc, /safeStorage\.isAsyncEncryptionAvailable\(\)/);
  assert.match(ipc, /safeStorage\.encryptStringAsync\(payload\)/);
  assert.match(ipc, /safeStorage\.decryptStringAsync\(encrypted\)/);
  assert.match(ipc, /shouldReEncrypt/);
  assert.match(ipc, /app\.isReady\(\)/);
  assert.match(ipc, /assertTrustedSender/);
  assert.match(ipc, /decodeCredentialEnvelope/);
  assert.match(ipc, /host_unavailable/);
  assert.doesNotMatch(ipc, /setUsePlainTextEncryption/);
  assert.match(main, /installDesktopCredentialStorageIpc\(developmentUrl\)/);
});

test("Preload 只暴露版本化凭据 capability，不暴露通用 safeStorage 原语", () => {
  assert.match(preload, /reviewDesktopCredentialProtection/);
  assert.match(preload, /protectCredential/);
  assert.match(preload, /unprotectCredential/);
  assert.match(preload, /desktop-v1/);
  assert.doesNotMatch(preload, /contextBridge\.exposeInMainWorld\([^)]*(?:safeStorage|encryptString|decryptString|rootPath|userData)/i);
});
