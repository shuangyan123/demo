import type {
  ObsidianSyncReport,
  ObsidianSyncRuntimeSnapshot,
} from "../types/domains/obsidian.ts";
import { isUiReviewRuntimeActive } from "./ui-review-runtime-guard.ts";
import { settingsPluginPreferencesRepository } from "./settings-plugin-preferences-repository.ts";

type Listener = () => void;

const POLL_INTERVAL_MS = 30_000;
const CHANGE_DEBOUNCE_MS = 1_000;

let snapshot: ObsidianSyncRuntimeSnapshot = {
  status: "paused",
  mode: "none",
  revision: 0,
};
const listeners = new Set<Listener>();
let started = false;
let syncRunning = false;
let rerunRequested = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let stopWatching: (() => void | Promise<void>) | undefined;

async function loadRepository() {
  return (await import("./obsidian-knowledge-repository.ts")).obsidianKnowledgeRepository;
}

async function loadWatchRepository() {
  return (await import("./obsidian-watch-repository.ts")).obsidianWatchRepository;
}

function publish(patch: Partial<ObsidianSyncRuntimeSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function clearTimers(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (pollTimer) clearInterval(pollTimer);
  debounceTimer = undefined;
  pollTimer = undefined;
}

async function stopCurrentWatch(): Promise<void> {
  const stop = stopWatching;
  stopWatching = undefined;
  if (stop) await stop();
}

function isRuntimeActive(): boolean {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  return settingsPluginPreferencesRepository.isEnabled("obsidian-vault") && !isUiReviewRuntimeActive() && document.visibilityState === "visible" && navigator.onLine;
}

function scheduleSync(delay = CHANGE_DEBOUNCE_MS): void {
  if (!started) return;
  if (!isRuntimeActive()) {
    publish({ status: "paused" });
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void executeSync();
  }, delay);
}

function classifyError(error: unknown): Pick<ObsidianSyncRuntimeSnapshot, "status" | "errorMessage"> {
  const message = error instanceof Error ? error.message : "Obsidian 自动同步失败";
  return {
    status: /权限|授权|permission|VAULT_NOT_SELECTED/i.test(message) ? "needs-permission" : "error",
    errorMessage: message,
  };
}

async function executeSync(): Promise<ObsidianSyncReport | undefined> {
  if (syncRunning) {
    rerunRequested = true;
    return undefined;
  }
  if (!isRuntimeActive()) {
    publish({ status: "paused" });
    return undefined;
  }
  syncRunning = true;
  publish({ status: "syncing", errorMessage: undefined });
  try {
    const repository = await loadRepository();
    const report = await repository.sync();
    const next = await repository.loadSnapshot();
    publish({
      status: report.conflicts || next.conflictCount ? "conflict" : "watching",
      lastSyncedAt: next.lastSyncedAt,
      revision: snapshot.revision + 1,
      errorMessage: undefined,
    });
    return report;
  } catch (error) {
    publish(classifyError(error));
    return undefined;
  } finally {
    syncRunning = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleSync();
    }
  }
}

async function configureWatch(): Promise<void> {
  clearTimers();
  await stopCurrentWatch();
  if (!settingsPluginPreferencesRepository.isEnabled("obsidian-vault")) {
    publish({ status: "paused", mode: "none", errorMessage: undefined });
    return;
  }
  try {
    const repository = await loadRepository();
    const current = await repository.loadSnapshot();
    if (!current.connected || current.permission !== "granted") {
      publish({
        status: current.permission === "prompt" || current.permission === "denied" ? "needs-permission" : "paused",
        mode: "none",
        lastSyncedAt: current.lastSyncedAt,
      });
      return;
    }
    const watchRepository = await loadWatchRepository();
    const watchSession = await watchRepository.watchChanges((change) => {
      publish({ revision: Math.max(snapshot.revision + 1, change.revision) });
      scheduleSync();
    });
    stopWatching = watchSession.stop;
    publish({
      status: current.conflictCount ? "conflict" : isRuntimeActive() ? "watching" : "paused",
      mode: watchSession.mode,
      lastSyncedAt: current.lastSyncedAt,
      errorMessage: undefined,
    });
    if (watchSession.mode === "polling") {
      pollTimer = setInterval(() => {
        if (isRuntimeActive()) scheduleSync(0);
      }, POLL_INTERVAL_MS);
    }
  } catch (error) {
    publish({ ...classifyError(error), mode: "none" });
  }
}

function handleResume(): void {
  if (!started || !isRuntimeActive()) return;
  void configureWatch().then(() => scheduleSync());
}

function handleKnowledgeChanged(): void {
  scheduleSync();
}

function handlePluginPreferenceChanged(): void {
  if (!started) return;
  void configureWatch().then(() => scheduleSync());
}

/** 应用级单例：页面切换不会中断，应用卸载时才停止。 */
export const obsidianSyncRuntime = {
  getSnapshot(): ObsidianSyncRuntimeSnapshot {
    return snapshot;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async start(): Promise<void> {
    if (started || typeof window === "undefined") return;
    if (isUiReviewRuntimeActive()) {
      publish({ status: "paused", mode: "none" });
      return;
    }
    started = true;
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("online", handleResume);
    window.addEventListener("review:knowledge-changed", handleKnowledgeChanged);
    window.addEventListener("review:settings-plugin-changed", handlePluginPreferenceChanged);
    await configureWatch();
  },

  async stop(): Promise<void> {
    if (!started || typeof window === "undefined") return;
    started = false;
    clearTimers();
    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("online", handleResume);
    window.removeEventListener("review:knowledge-changed", handleKnowledgeChanged);
    window.removeEventListener("review:settings-plugin-changed", handlePluginPreferenceChanged);
    await stopCurrentWatch();
    publish({ status: "paused", mode: "none" });
  },

  async restart(): Promise<void> {
    if (!started) return;
    await configureWatch();
  },

  async syncNow(): Promise<ObsidianSyncReport | undefined> {
    const report = await executeSync();
    if (!report && snapshot.errorMessage) throw new Error(snapshot.errorMessage);
    return report;
  },
};

/** 知识 repository 成功变更后调用；事件仅表示数据已变化，不携带知识正文。 */
export function notifyObsidianSyncNeeded(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("review:knowledge-changed"));
}
