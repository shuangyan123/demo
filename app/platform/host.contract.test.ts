import assert from "node:assert/strict";
import test from "node:test";
import { resolveHost } from "./host.ts";
import type {
  DesktopCredentialProtectionPreloadBridge,
  DesktopVaultPreloadBridge,
  DesktopWindowPreloadBridge,
} from "./capabilities.ts";

function windowStub(value: Record<string, unknown>): Window {
  return value as unknown as Window;
}

function desktopVaultStub(): DesktopVaultPreloadBridge {
  return {
    getState: async () => ({ configured: true, vaultName: "Contract Vault" }),
    chooseVault: async () => ({ cancelled: false, vaultName: "Contract Vault" }),
    ensureManagedTree: async () => undefined,
    listMarkdown: async () => [{ path: "note.md", markdown: "# note" }],
    readMarkdown: async () => "# note",
    writeMarkdown: async () => undefined,
    removeMarkdown: async () => undefined,
    startWatching: async () => undefined,
    stopWatching: async () => undefined,
    onVaultChanged: () => () => undefined,
  };
}

function desktopCredentialProtectionStub(): DesktopCredentialProtectionPreloadBridge {
  return {
    getStatus: async () => ({ ok: true, value: { status: "temporarily_unavailable" } }),
    protectCredential: async () => ({ ok: false, error: { code: "host_unavailable", message: "safe failure" } }),
    unprotectCredential: async () => ({ ok: false, error: { code: "host_unavailable", message: "safe failure" } }),
  };
}

test("服务端解析不读取 window 且不公布宿主能力", () => {
  assert.deepEqual(resolveHost(undefined), { kind: "server", capabilities: {} });
});

test("Web 宿主只公布浏览器真实提供的 Vault 能力", async () => {
  const directory = { name: "Browser Vault" } as FileSystemDirectoryHandle;
  const runtime = resolveHost(windowStub({
    showDirectoryPicker: async () => directory,
  }));

  assert.equal(runtime.kind, "web");
  assert.equal(runtime.capabilities.vault?.kind, "web");
  if (runtime.capabilities.vault?.kind !== "web") assert.fail("缺少 Web Vault capability");
  assert.equal(await runtime.capabilities.vault.chooseDirectory({ mode: "readwrite" }), directory);
  assert.equal(runtime.capabilities.nativeWindow, undefined);
});

test("Desktop 宿主优先包裹 preload 且不扩大桥接权限", async () => {
  const calls: string[] = [];
  const nativeWindow: DesktopWindowPreloadBridge = {
    setTitleBarTheme: async (mode) => { calls.push(mode); },
  };
  const runtime = resolveHost(windowStub({
    reviewDesktopVault: desktopVaultStub(),
    reviewDesktopWindow: nativeWindow,
    showDirectoryPicker: async () => ({ name: "Browser Vault" }),
  }));

  assert.equal(runtime.kind, "desktop");
  assert.equal(runtime.capabilities.vault?.kind, "desktop");
  if (runtime.capabilities.vault?.kind !== "desktop") assert.fail("缺少 Desktop Vault capability");
  assert.equal((await runtime.capabilities.vault.getState()).vaultName, "Contract Vault");
  await runtime.capabilities.nativeWindow?.setTitleBarTheme("dark");
  assert.deepEqual(calls, ["dark"]);
  assert.deepEqual(Object.keys(runtime.capabilities).sort(), ["nativeWindow", "vault"]);
});

test("Credential preload bridge alone keeps Host desktop and exposes only the typed capability", async () => {
  const runtime = resolveHost(windowStub({
    reviewDesktopCredentialProtection: desktopCredentialProtectionStub(),
  }));

  assert.equal(runtime.kind, "desktop");
  assert.equal(runtime.capabilities.credentialProtection?.kind, "desktop");
  assert.deepEqual(await runtime.capabilities.credentialProtection?.getStatus(), { status: "temporarily_unavailable" });
  assert.deepEqual(
    Object.keys(runtime.capabilities)
      .filter((key) => Boolean(runtime.capabilities[key as keyof typeof runtime.capabilities]))
      .sort(),
    ["credentialProtection"],
  );
});
