import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createNativeSurfaceOcclusionStore,
  getNativeSurfaceOcclusionSnapshot,
  NATIVE_SURFACE_OCCLUSION_EVENT,
  setNativeSurfaceOcclusion,
} from "./ui-overlay-events.ts";

test("native surface occlusion uses balanced source-set semantics", () => {
  const store = createNativeSurfaceOcclusionStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });

  store.set("context-panel:test", true);
  assert.deepEqual(store.getSnapshot(), { occluded: true, sources: ["context-panel:test"] });
  store.set("context-panel:test", true);
  assert.equal(notifications, 1);
  store.set("context-panel:test", false);
  assert.deepEqual(store.getSnapshot(), { occluded: false, sources: [] });
  assert.equal(notifications, 2);
  unsubscribe();
});

test("multiple native-surface blockers do not reveal the surface prematurely", () => {
  const store = createNativeSurfaceOcclusionStore();
  store.set("summary:test", true);
  store.set("mobile-sidebar:test", true);
  store.set("summary:test", false);
  assert.deepEqual(store.getSnapshot(), { occluded: true, sources: ["mobile-sidebar:test"] });
  store.set("mobile-sidebar:test", false);
  assert.equal(store.getSnapshot().occluded, false);
});

test("Fenbi clear confirmation and command palette keep independent blockers", () => {
  const store = createNativeSurfaceOcclusionStore();
  store.set("popover:summary", true);
  store.set("command-palette:test", true);
  store.set("fenbi-clear-confirm:test", true);
  store.set("command-palette:test", false);
  assert.deepEqual(store.getSnapshot(), { occluded: true, sources: ["fenbi-clear-confirm:test", "popover:summary"] });
  store.set("fenbi-clear-confirm:test", false);
  assert.deepEqual(store.getSnapshot(), { occluded: true, sources: ["popover:summary"] });
  store.set("popover:summary", false);
  assert.equal(store.getSnapshot().occluded, false);
});

test("shared occlusion source ignores empty ids and exposes a stable event contract", () => {
  const source = readFileSync(new URL("./ui-overlay-events.ts", import.meta.url), "utf8");
  const before = getNativeSurfaceOcclusionSnapshot();
  setNativeSurfaceOcclusion("", true);
  assert.deepEqual(getNativeSurfaceOcclusionSnapshot(), before);
  assert.equal(NATIVE_SURFACE_OCCLUSION_EVENT, "workspace:native-surface-occlusion");
  assert.match(source, /CustomEvent<NativeSurfaceOcclusionSnapshot>/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("Fenbi slot follows real layout geometry without repair timers", () => {
  const source = readFileSync(new URL("../fenbi/fenbi-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /ResizeObserver/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /transitionend/);
  assert.match(source, /orientationchange/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("Fenbi confirmation and command search own balanced native-surface sources", () => {
  const fenbiContext = readFileSync(new URL("../fenbi/fenbi-context-panel.tsx", import.meta.url), "utf8");
  const commandSearch = readFileSync(new URL("../conversation/command-search-palette.tsx", import.meta.url), "utf8");
  assert.match(fenbiContext, /useNativeSurfaceOcclusion\("fenbi-clear-confirm", clearConfirmationOpen\)/);
  assert.match(commandSearch, /useNativeSurfaceOcclusion\("command-palette", open\)/);
  assert.doesNotMatch(commandSearch, /setInterval|setTimeout/);
});
