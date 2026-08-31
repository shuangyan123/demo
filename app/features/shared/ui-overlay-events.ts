/** 交互式浮层打开时通知短暂 hover/info 层收起。仅是 DOM 事件信号，不承载业务状态。 */
export const INTERACTIVE_OVERLAY_OPEN_EVENT = "workspace:interactive-overlay-open";

export const NATIVE_SURFACE_OCCLUSION_EVENT = "workspace:native-surface-occlusion";

export type NativeSurfaceOcclusionSnapshot = Readonly<{
  occluded: boolean;
  sources: readonly string[];
}>;

export type NativeSurfaceOcclusionStore = {
  getSnapshot(): NativeSurfaceOcclusionSnapshot;
  subscribe(listener: () => void): () => void;
  set(source: string, occluded: boolean): void;
};

const EMPTY_NATIVE_SURFACE_OCCLUSION: NativeSurfaceOcclusionSnapshot = Object.freeze({
  occluded: false,
  sources: Object.freeze([]),
});

/**
 * Native child surfaces 不能依赖 renderer z-index；用 source set 保持多个浮层的平衡遮挡语义。
 * 每个调用方必须提供稳定且唯一的 source，关闭其中一个不会释放其他 blocker。
 */
export function createNativeSurfaceOcclusionStore(): NativeSurfaceOcclusionStore {
  const sources = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: NativeSurfaceOcclusionSnapshot = EMPTY_NATIVE_SURFACE_OCCLUSION;

  const publish = (): void => {
    snapshot = sources.size
      ? Object.freeze({ occluded: true, sources: Object.freeze([...sources].sort()) })
      : EMPTY_NATIVE_SURFACE_OCCLUSION;
    for (const listener of listeners) listener();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<NativeSurfaceOcclusionSnapshot>(NATIVE_SURFACE_OCCLUSION_EVENT, { detail: snapshot }));
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (source, occluded) => {
      const normalizedSource = source.trim();
      if (!normalizedSource) return;
      const changed = occluded ? !sources.has(normalizedSource) : sources.delete(normalizedSource);
      if (changed) {
        if (occluded) sources.add(normalizedSource);
        publish();
      }
    },
  };
}

const nativeSurfaceOcclusionStore = createNativeSurfaceOcclusionStore();

export function getNativeSurfaceOcclusionSnapshot(): NativeSurfaceOcclusionSnapshot {
  return nativeSurfaceOcclusionStore.getSnapshot();
}

export function subscribeNativeSurfaceOcclusion(listener: () => void): () => void {
  return nativeSurfaceOcclusionStore.subscribe(listener);
}

export function setNativeSurfaceOcclusion(source: string, occluded: boolean): void {
  nativeSurfaceOcclusionStore.set(source, occluded);
}

export function announceInteractiveOverlayOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INTERACTIVE_OVERLAY_OPEN_EVENT));
}
