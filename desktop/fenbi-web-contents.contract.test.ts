import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isTrustedFenbiRendererSender } from "./fenbi-ipc-trust.ts";
import {
  createFenbiWebContentsAuthority,
  FENBI_HOME_URL,
  type FenbiBrowserWindowLike,
  type FenbiNativeViewLike,
} from "./fenbi-web-contents-authority.ts";
import { normalizeFenbiViewBounds } from "./fenbi-web-contents-bounds.ts";
import type { FenbiViewBounds, FenbiViewState } from "./fenbi-web-contents-types.ts";
import { isAllowedFenbiWebHostname } from "./fenbi-policy.ts";

const controllerSource = readFileSync(new URL("./fenbi-web-contents-controller.ts", import.meta.url), "utf8");
const authoritySource = readFileSync(new URL("./fenbi-web-contents-authority.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("./fenbi-web-contents-ipc.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");

type Listener = (...args: unknown[]) => void;

function createHarness() {
  const contentListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();
  const loadedUrls: string[] = [];
  let currentUrl = "";
  let destroyed = false;
  let bounds: FenbiViewBounds = { x: 0, y: 0, width: 0, height: 0 };
  let visible = false;
  let createCount = 0;
  let removeCount = 0;
  let closed = false;
  const emit = (listeners: Map<string, Set<Listener>>, event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const contents = {
    loadURL: async (url: string) => {
      loadedUrls.push(url);
      currentUrl = url;
      emit(contentListeners, "did-navigate", url);
    },
    reload: () => emit(contentListeners, "did-start-loading"),
    getURL: () => currentUrl,
    isDestroyed: () => destroyed,
    close: () => { destroyed = true; closed = true; },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => undefined,
      goForward: () => undefined,
    },
    on: (event: string, listener: Listener) => {
      const listeners = contentListeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      contentListeners.set(event, listeners);
    },
    off: (event: string, listener: Listener) => contentListeners.get(event)?.delete(listener),
  };
  const owner: FenbiBrowserWindowLike = {
    isDestroyed: () => destroyed,
    getContentSize: () => [800, 600],
    contentView: {
      addChildView: () => { createCount += 1; },
      removeChildView: () => { removeCount += 1; },
    },
    on: (event: string, listener: Listener) => {
      const listeners = windowListeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      windowListeners.set(event, listeners);
    },
    off: (event: string, listener: Listener) => windowListeners.get(event)?.delete(listener),
  };
  const view: FenbiNativeViewLike = {
    setBounds: (next) => { bounds = next; },
    setVisible: (next) => { visible = next; },
    webContents: contents,
  };
  return {
    owner,
    view,
    loadedUrls,
    get bounds() { return bounds; },
    get visible() { return visible; },
    get createCount() { return createCount; },
    get removeCount() { return removeCount; },
    get closed() { return closed; },
    closeOwner: () => emit(windowListeners, "closed"),
  };
}

test("WebContentsView is lazy, single-owner, fixed-home and visibility controlled", async () => {
  const harness = createHarness();
  const authority = createFenbiWebContentsAuthority({ ownerWindow: harness.owner, createView: () => harness.view, isAllowedWebHostname: isAllowedFenbiWebHostname, normalizeBounds: normalizeFenbiViewBounds });
  assert.equal(harness.createCount, 0);
  await authority.show();
  await authority.show();
  assert.equal(harness.createCount, 1);
  assert.deepEqual(harness.loadedUrls, [FENBI_HOME_URL]);
  assert.equal(harness.visible, true);
  await authority.hide();
  assert.equal(harness.visible, false);
});

test("renderer geometry rejects malformed or negative dimensions and clamps oversize", async () => {
  const authority = createFenbiWebContentsAuthority({ ownerWindow: createHarness().owner, createView: () => createHarness().view, isAllowedWebHostname: isAllowedFenbiWebHostname, normalizeBounds: normalizeFenbiViewBounds });
  assert.deepEqual(normalizeFenbiViewBounds(null, [800, 600]), { ok: false, reason: "invalid_bounds" });
  assert.deepEqual(normalizeFenbiViewBounds({ x: 0, y: 0, width: -1, height: 2 }, [800, 600]), { ok: false, reason: "invalid_bounds" });
  assert.deepEqual(normalizeFenbiViewBounds({ x: 0, y: 0, width: Number.NaN, height: 2 }, [800, 600]), { ok: false, reason: "invalid_bounds" });
  assert.deepEqual(normalizeFenbiViewBounds({ x: -10, y: -10, width: 2_000_000, height: 2_000_000 }, [800, 600]), {
    ok: true,
    value: { x: 0, y: 0, width: 800, height: 600 },
  });
  const result = await authority.setBounds({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 });
  assert.equal(result.ok, false);
});

test("latest bounds are applied when the lazy native view becomes visible", async () => {
  const harness = createHarness();
  const authority = createFenbiWebContentsAuthority({ ownerWindow: harness.owner, createView: () => harness.view, isAllowedWebHostname: isAllowedFenbiWebHostname, normalizeBounds: normalizeFenbiViewBounds });
  await authority.setBounds({ x: 40, y: 30, width: 500, height: 400 });
  await authority.show();
  assert.deepEqual(harness.bounds, { x: 40, y: 30, width: 500, height: 400 });
});

test("failed native view attachment closes and detaches the created child", async () => {
  const harness = createHarness();
  const owner: FenbiBrowserWindowLike = {
    ...harness.owner,
    contentView: {
      ...harness.owner.contentView,
      addChildView: () => { throw new Error("attach failed"); },
    },
  };
  const authority = createFenbiWebContentsAuthority({ ownerWindow: owner, createView: () => harness.view, isAllowedWebHostname: isAllowedFenbiWebHostname, normalizeBounds: normalizeFenbiViewBounds });
  const result = await authority.show();
  assert.equal(result.ok, false);
  assert.equal(harness.removeCount, 1);
  assert.equal(harness.closed, true);
});

test("safe state exposes host and navigation facts but never the full remote URL", async () => {
  const harness = createHarness();
  const authority = createFenbiWebContentsAuthority({ ownerWindow: harness.owner, createView: () => harness.view, isAllowedWebHostname: isAllowedFenbiWebHostname, normalizeBounds: normalizeFenbiViewBounds });
  await authority.show();
  const safeState: FenbiViewState = authority.getState();
  assert.equal(safeState.host, "www.fenbi.com");
  assert.doesNotMatch(JSON.stringify(safeState), /Cookie|token|access_token|refresh_token|code=/i);
  assert.doesNotMatch(JSON.stringify(safeState), /https?:\/\//);
});

test("owner teardown disposes the child view and removes its listeners", async () => {
  const harness = createHarness();
  const authority = createFenbiWebContentsAuthority({ ownerWindow: harness.owner, createView: () => harness.view, isAllowedWebHostname: isAllowedFenbiWebHostname, normalizeBounds: normalizeFenbiViewBounds });
  await authority.show();
  harness.closeOwner();
  assert.equal(authority.getState().available, false);
  assert.equal(harness.removeCount, 1);
  assert.equal(harness.closed, true);
  authority.dispose();
  assert.equal(harness.removeCount, 1);
});

test("remote content uses the existing isolated preferences and policy without a Recall preload", () => {
  assert.equal((controllerSource.match(/new WebContentsView\s*\(/g) ?? []).length, 1);
  assert.match(controllerSource, /createFenbiWebPreferences\(\)/);
  assert.match(controllerSource, /installFenbiWebContentsPolicy\(view\.webContents\)/);
  assert.doesNotMatch(controllerSource, /preload\s*:/);
  assert.doesNotMatch(controllerSource, /persist:review-workspace/);
});

test("view IPC is bounded and has no arbitrary navigation or page execution seam", () => {
  assert.match(ipcSource, /open-home/);
  assert.match(ipcSource, /go-back/);
  assert.match(ipcSource, /go-forward/);
  assert.doesNotMatch(ipcSource, /loadURL|navigate\s*\(|openUrl|executeJavaScript|insertCSS|cookies|Session/);
  assert.match(authoritySource, /FENBI_HOME_URL/);
  assert.doesNotMatch(preloadSource.slice(preloadSource.indexOf("const reviewFenbiView")), /url\s*:/);
});

test("only Recall renderer origins can invoke Fenbi controls", () => {
  const remoteEvent = { senderFrame: { url: "https://www.fenbi.com/" }, sender: { getURL: () => "https://www.fenbi.com/" } };
  const appEvent = { senderFrame: { url: "review-app://workspace/" }, sender: { getURL: () => "review-app://workspace/" } };
  const devEvent = { senderFrame: { url: "http://127.0.0.1:3000/" }, sender: { getURL: () => "http://127.0.0.1:3000/" } };
  const evilEvent = { senderFrame: { url: "https://example.com/" }, sender: { getURL: () => "https://example.com/" } };
  assert.equal(isTrustedFenbiRendererSender(remoteEvent as never), false);
  assert.equal(isTrustedFenbiRendererSender(appEvent as never), true);
  assert.equal(isTrustedFenbiRendererSender(devEvent as never, "http://127.0.0.1:3000"), true);
  assert.equal(isTrustedFenbiRendererSender(evilEvent as never, "http://127.0.0.1:3000"), false);
});

test("main process owns creation and disposes Fenbi before failed launch window destruction", () => {
  assert.match(mainSource, /createFenbiWebContentsController\(mainWindow\)/);
  assert.match(mainSource, /fenbiViewIpcCleanup = installFenbiWebContentsIpc/);
  assert.match(mainSource, /disposeFenbiWebContents\(\);\s*if \(mainWindow && !mainWindow\.isDestroyed\(\)\) mainWindow\.destroy\(\)/);
  assert.equal((mainSource.match(/new WebContentsView\s*\(/g) ?? []).length, 0);
});
