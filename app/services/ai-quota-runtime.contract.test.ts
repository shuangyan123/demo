import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { aiQuotaRepository } from "./ai-quota-repository.ts";
import { QuotaRuntimeStore } from "./ai-quota-runtime.ts";

const values = new Map<string, string>();
const localStorageMock = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => values.delete(key),
  setItem: (key: string, value: string) => values.set(key, value),
};

const documentTarget = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
documentTarget.visibilityState = "visible";
const windowTarget = Object.assign(new EventTarget(), {
  localStorage: localStorageMock,
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
});
Object.defineProperty(globalThis, "window", { configurable: true, value: windowTarget });
Object.defineProperty(globalThis, "document", { configurable: true, value: documentTarget });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  values.clear();
  documentTarget.visibilityState = "visible";
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("额度启用立即落库，并在凭据完整时验证和刷新", async () => {
  const actions: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { action: string; provider: string };
    actions.push(body.action);
    if (body.action === "validate") return Response.json({ valid: true, provider: body.provider, message: "验证通过" });
    return Response.json({
      id: body.provider,
      provider: body.provider,
      label: "OpenAI",
      status: "ready",
      source: "official",
      metrics: [],
      officialRemainingAvailable: false,
      message: "刷新成功",
      refreshedAt: new Date().toISOString(),
    });
  };

  const runtime = new QuotaRuntimeStore();
  await runtime.saveAndActivate({ id: "openai", enabled: true, credentials: { adminKey: "admin-fixture" }, today: new Date() });
  assert.equal(aiQuotaRepository.loadSync().configs.find((config) => config.id === "openai")?.enabled, true);
  assert.deepEqual(actions, ["validate", "refresh"]);
  assert.equal(runtime.getSnapshot().entries.openai?.status, "ready");
  assert.equal(runtime.getSnapshot().snapshots[0]?.id, "openai");

  globalThis.fetch = async () => Response.json({ message: "临时不可用" }, { status: 503 });
  await assert.rejects(runtime.manualRefresh("openai"), /临时不可用/);
  assert.equal(runtime.getSnapshot().entries.openai?.status, "stale");
  assert.equal(runtime.getSnapshot().snapshots[0]?.stale, true);
});

test("额度运行时在页面隐藏或离线时暂停，到期恢复才刷新", async () => {
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const body = JSON.parse(String(init?.body)) as { action: string; provider: string };
    if (body.action === "validate") return Response.json({ valid: true, provider: body.provider, message: "验证通过" });
    return Response.json({ id: body.provider, provider: body.provider, label: "DeepSeek", status: "ready", source: "official", metrics: [], officialRemainingAvailable: true, message: "刷新成功", refreshedAt: new Date().toISOString() });
  };
  await aiQuotaRepository.saveConfig({ id: "deepseek", enabled: true, credentials: { apiKey: "deepseek-fixture" }, today: new Date() });
  documentTarget.visibilityState = "hidden";
  const runtime = new QuotaRuntimeStore();
  await runtime.initialize();
  assert.equal(requests, 0);
  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(requests, 2);
  (navigator as unknown as { onLine: boolean }).onLine = false;
  await assert.rejects(runtime.manualRefresh("deepseek"), /离线或页面不可见/);
  assert.equal(requests, 2);
  (navigator as unknown as { onLine: boolean }).onLine = true;
  runtime.dispose();
});

test.after(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "navigator");
  Reflect.deleteProperty(globalThis, "window");
});
