/**
 * 额度运行时借鉴桌面状态栏应用的 provider/snapshot/scheduler 边界，
 * 仅调用本项目已核验的官方只读 API，不使用 Cookie 或网页私有接口。
 */
import type { AiQuotaPluginConfig, AiQuotaSnapshot, ApiProvider } from "../types/review";
import { aiQuotaRepository, type SaveQuotaPluginInput } from "./ai-quota-repository.ts";
import { getAiQuotaPlugin } from "./ai-quota-plugins.ts";

export type AiQuotaRuntimeStatus = "disabled" | "needs-credentials" | "refreshing" | "ready" | "stale" | "error";

export type AiQuotaRuntimeEntry = {
  status: AiQuotaRuntimeStatus;
  message: string;
  lastAttemptAt?: string;
};

export type AiQuotaRuntimeSnapshot = {
  configs: AiQuotaPluginConfig[];
  snapshots: AiQuotaSnapshot[];
  entries: Partial<Record<ApiProvider | "manual", AiQuotaRuntimeEntry>>;
};

type QueueItem = {
  id: ApiProvider | "manual";
  validateFirst: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const emptySnapshot: AiQuotaRuntimeSnapshot = { configs: [], snapshots: [], entries: {} };

/** 只保留可向用户展示的错误消息，不序列化响应体或凭据。 */
function safeErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "额度刷新已取消";
  if (error instanceof Error && error.name === "TimeoutError") return "额度服务响应超时";
  return error instanceof Error ? error.message : "额度刷新失败";
}

/** 管理额度来源的持久化启用、可见性调度、并发和失败恢复。 */
export class QuotaRuntimeStore {
  private state: AiQuotaRuntimeSnapshot = emptySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly queue: QueueItem[] = [];
  private readonly inFlight = new Map<ApiProvider | "manual", AbortController>();
  private activeCount = 0;
  private initialized = false;
  private intervalId?: number;

  /** useSyncExternalStore 需要在状态未变化时返回同一对象引用。 */
  getSnapshot = (): AiQuotaRuntimeSnapshot => this.state;

  getServerSnapshot = (): AiQuotaRuntimeSnapshot => emptySnapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 首次进入额度设置时注册应用级生命周期，已启用旧配置会立即恢复。 */
  initialize = async (): Promise<void> => {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    this.syncFromRepository();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    this.intervalId = window.setInterval(() => void this.refreshDue(), 15_000);
    await this.refreshDue();
  };

  /** 测试可显式释放监听器；产品运行时保持单例直到页面关闭。 */
  dispose(): void {
    if (typeof window === "undefined" || !this.initialized) return;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    if (this.intervalId) window.clearInterval(this.intervalId);
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    this.initialized = false;
  }

  /** 启用状态立即保存；凭据完整时先验证再强制刷新一次。 */
  async saveAndActivate(input: SaveQuotaPluginInput): Promise<void> {
    await aiQuotaRepository.saveConfig(input);
    this.syncFromRepository();
    if (!input.enabled) {
      this.inFlight.get(input.id)?.abort();
      this.setEntry(input.id, { status: "disabled", message: "未启用" });
      return;
    }
    if (!aiQuotaRepository.isConfigured(input.id)) {
      this.setEntry(input.id, { status: "needs-credentials", message: "待配置额度查询凭据" });
      return;
    }
    await this.enqueue(input.id, true);
  }

  /** 手动刷新绕过过期判断，但仍受四路并发、超时和取消约束。 */
  async manualRefresh(id: ApiProvider | "manual"): Promise<void> {
    if (!this.isRunnable()) throw new Error("当前离线或页面不可见，无法刷新额度");
    if (!aiQuotaRepository.isConfigured(id)) throw new Error("请先配置额度查询凭据");
    const hasSnapshot = this.state.snapshots.some((snapshot) => snapshot.id === id);
    await this.enqueue(id, !hasSnapshot);
  }

  /** 仅验证账单凭据，不覆盖上次额度快照。 */
  async validate(id: ApiProvider | "manual"): Promise<string> {
    if (!aiQuotaRepository.isConfigured(id)) throw new Error("请先配置额度查询凭据");
    const controller = new AbortController();
    const result = await aiQuotaRepository.validate(id, controller.signal);
    return result.message;
  }

  /** 页面恢复可见、网络恢复或定时器触发时，只刷新已经过期的来源。 */
  async refreshDue(): Promise<void> {
    if (!this.isRunnable()) return;
    this.syncFromRepository();
    const now = Date.now();
    const pending: Promise<void>[] = [];
    for (const config of this.state.configs) {
      if (!config.enabled) continue;
      if (!aiQuotaRepository.isConfigured(config.id)) {
        this.setEntry(config.id, { status: "needs-credentials", message: "待配置额度查询凭据" });
        continue;
      }
      const snapshot = this.state.snapshots.find((item) => item.id === config.id);
      const cadence = getAiQuotaPlugin(config.id).descriptor.refreshCadenceSeconds * 1000;
      const due = !snapshot || snapshot.stale || Date.parse(snapshot.refreshedAt) + cadence <= now;
      if (due) pending.push(this.enqueue(config.id, !snapshot));
      else this.setEntry(config.id, { status: "ready", message: snapshot.message });
    }
    await Promise.allSettled(pending);
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      for (const controller of this.inFlight.values()) controller.abort();
      return;
    }
    void this.refreshDue();
  };

  private readonly handleOnline = (): void => { void this.refreshDue(); };

  private readonly handleOffline = (): void => {
    for (const controller of this.inFlight.values()) controller.abort();
  };

  private isRunnable(): boolean {
    if (typeof window === "undefined") return false;
    return document.visibilityState !== "hidden" && navigator.onLine !== false;
  }

  private syncFromRepository(): void {
    const persisted = aiQuotaRepository.loadSync();
    const entries = { ...this.state.entries };
    for (const plugin of aiQuotaRepository.plugins) {
      const config = persisted.configs.find((item) => item.id === plugin.id);
      if (!config?.enabled) entries[plugin.id] = { status: "disabled", message: "未启用" };
      else if (!aiQuotaRepository.isConfigured(plugin.id)) entries[plugin.id] = { status: "needs-credentials", message: "待配置额度查询凭据" };
    }
    this.publish({ configs: persisted.configs, snapshots: persisted.snapshots, entries });
  }

  private setEntry(id: ApiProvider | "manual", entry: AiQuotaRuntimeEntry): void {
    this.publish({ ...this.state, entries: { ...this.state.entries, [id]: entry } });
  }

  private publish(next: AiQuotaRuntimeSnapshot): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private enqueue(id: ApiProvider | "manual", validateFirst: boolean): Promise<void> {
    if (this.inFlight.has(id) || this.queue.some((item) => item.id === id)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ id, validateFirst, resolve, reject });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.activeCount < 4 && this.queue.length) {
      const item = this.queue.shift()!;
      this.activeCount += 1;
      void this.execute(item).finally(() => {
        this.activeCount -= 1;
        this.drainQueue();
      });
    }
  }

  private async execute(item: QueueItem): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(item.id, controller);
    this.setEntry(item.id, { status: "refreshing", message: "正在刷新", lastAttemptAt: new Date().toISOString() });
    try {
      if (item.validateFirst && getAiQuotaPlugin(item.id).supportsOfficialRefresh) {
        await aiQuotaRepository.validate(item.id, controller.signal);
      }
      const snapshot = await aiQuotaRepository.refresh(item.id, new Date(), controller.signal);
      this.syncFromRepository();
      this.setEntry(item.id, { status: "ready", message: snapshot.message, lastAttemptAt: new Date().toISOString() });
      item.resolve();
    } catch (error) {
      const message = safeErrorMessage(error);
      const previous = this.state.snapshots.find((snapshot) => snapshot.id === item.id);
      if (previous) {
        this.publish({
          ...this.state,
          snapshots: this.state.snapshots.map((snapshot) => snapshot.id === item.id ? { ...snapshot, stale: true } : snapshot),
          entries: { ...this.state.entries, [item.id]: { status: "stale", message, lastAttemptAt: new Date().toISOString() } },
        });
      } else this.setEntry(item.id, { status: "error", message, lastAttemptAt: new Date().toISOString() });
      item.reject(error);
    } finally {
      this.inFlight.delete(item.id);
    }
  }
}

export const aiQuotaRuntime = new QuotaRuntimeStore();
