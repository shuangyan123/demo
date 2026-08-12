import assert from "node:assert/strict";
import test from "node:test";
import { inspectCredentialProtection, selectCredentialProtectionBackend } from "./credential-protection.ts";
import { resolveHost } from "./host.ts";
import type { DesktopCredentialProtectionPreloadBridge } from "./capabilities.ts";

function windowStub(value: Record<string, unknown>): Window {
  return value as unknown as Window;
}

function fakeCredentialProtectionBridge(): DesktopCredentialProtectionPreloadBridge {
  return {
    getStatus: async () => ({ ok: true, value: { status: "available", backend: "os_protected" } }),
    protectCredential: async (context, secret) => ({ ok: true, value: { version: "desktop-v1", context, payload: `c2VudGluZWw6${btoa(secret)}` } }),
    unprotectCredential: async (context, envelope) => {
      if (envelope.context !== context) return { ok: false, error: { code: "host_context_mismatch", message: "context mismatch" } };
      return { ok: true, value: { secret: "sentinel-secret", shouldReProtect: false } };
    },
  };
}

test("Web backend selection never fabricates a Desktop secure-storage capability", async () => {
  const target = windowStub({ showDirectoryPicker: async () => ({}) });
  assert.equal(selectCredentialProtectionBackend({ hostKind: "web", hasDesktopCredentialProtection: false }), "web_crypto");
  assert.deepEqual(await inspectCredentialProtection(target), { backend: "web_crypto", status: "available" });
  assert.equal(resolveHost(target).capabilities.credentialProtection, undefined);
});

test("Desktop capability exposes only the narrow credential contract", async () => {
  const target = windowStub({ reviewDesktopCredentialProtection: fakeCredentialProtectionBridge() });
  const runtime = resolveHost(target);
  const capability = runtime.capabilities.credentialProtection;
  assert.equal(runtime.kind, "desktop");
  assert.ok(capability);
  assert.deepEqual(await capability.getStatus(), { status: "available", backend: "os_protected" });
  const envelope = await capability.protectCredential("ai-connection:profile:api-key", "sentinel-secret");
  assert.deepEqual(await capability.unprotectCredential("ai-connection:profile:api-key", envelope), {
    secret: "sentinel-secret",
    shouldReProtect: false,
  });
  assert.deepEqual(await inspectCredentialProtection(target), { backend: "desktop_host", status: "available" });
  assert.equal(selectCredentialProtectionBackend({ hostKind: "desktop", hasDesktopCredentialProtection: true }), "desktop_host");
});

test("Desktop host without secure credential bridge is explicitly unavailable", () => {
  assert.equal(selectCredentialProtectionBackend({ hostKind: "desktop", hasDesktopCredentialProtection: false }), "desktop_host_unavailable");
  assert.deepEqual(resolveHost(windowStub({ reviewDesktopWindow: { setTitleBarTheme: async () => undefined } })).capabilities.credentialProtection, undefined);
});
