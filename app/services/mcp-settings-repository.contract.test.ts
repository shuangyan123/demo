import assert from "node:assert/strict";
import test from "node:test";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";

const values = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => void values.delete(key),
  setItem: (key, value) => void values.set(key, value),
};

Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: localStorageMock } });

test("MCP settings persist local profiles and discovery summaries without Dexie", () => {
  values.clear();
  const profile = mcpSettingsRepository.saveProfile({ label: "Bridge", endpoint: "http://127.0.0.1:8765/mcp?token=secret", enabled: true });
  assert.equal(profile.endpoint, "http://127.0.0.1:8765/mcp");
  const result = mcpSettingsRepository.testProfile(profile);
  assert.equal(result.status, "ready");
  assert.equal(mcpSettingsRepository.load().profiles.length, 1);
  assert.equal(mcpSettingsRepository.load().discovery[profile.id]?.tools.length, 1);
  mcpSettingsRepository.removeProfile(profile.id);
  assert.equal(mcpSettingsRepository.load().profiles.length, 0);
});

test.after(() => {
  Reflect.deleteProperty(globalThis, "window");
});
