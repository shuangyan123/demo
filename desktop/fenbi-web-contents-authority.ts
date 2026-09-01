import type { FenbiViewBounds, FenbiViewResult, FenbiViewState } from "./fenbi-web-contents-types.js";

export const FENBI_HOME_URL = "https://www.fenbi.com/" as const;
const FENBI_VIEW_UNAVAILABLE_MESSAGE = "Fenbi view is unavailable";
const FENBI_BOUNDS_INVALID_MESSAGE = "Fenbi view bounds are invalid";
const FENBI_NAVIGATION_UNAVAILABLE_MESSAGE = "Fenbi navigation is unavailable";

type FenbiEventListener = (...args: unknown[]) => void;

export type FenbiWebContentsLike = {
  loadURL(url: string): Promise<unknown>;
  reload(): void;
  getURL(): string;
  isDestroyed(): boolean;
  close(options?: { waitForBeforeUnload: boolean }): void;
  navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): unknown;
    goForward(): unknown;
  };
  on(event: string, listener: FenbiEventListener): void;
  off(event: string, listener: FenbiEventListener): void;
};

export type FenbiNativeViewLike = {
  setBounds(bounds: FenbiViewBounds): void;
  setVisible(visible: boolean): void;
  webContents: FenbiWebContentsLike;
};

export type FenbiBrowserWindowLike = {
  isDestroyed(): boolean;
  getContentSize(): number[];
  contentView: {
    addChildView(view: FenbiNativeViewLike): void;
    removeChildView(view: FenbiNativeViewLike): void;
  };
  on(event: string, listener: FenbiEventListener): void;
  off(event: string, listener: FenbiEventListener): void;
};

export type FenbiWebContentsAuthority = {
  getState(): FenbiViewState;
  show(): Promise<FenbiViewResult<FenbiViewState>>;
  hide(): Promise<FenbiViewResult<FenbiViewState>>;
  setBounds(input: unknown): Promise<FenbiViewResult<FenbiViewState>>;
  openHome(): Promise<FenbiViewResult<FenbiViewState>>;
  reload(): Promise<FenbiViewResult<FenbiViewState>>;
  goBack(): Promise<FenbiViewResult<FenbiViewState>>;
  goForward(): Promise<FenbiViewResult<FenbiViewState>>;
  onStateChanged(listener: (state: FenbiViewState) => void): () => void;
  dispose(): void;
};

export type FenbiWebContentsAuthorityDependencies = {
  ownerWindow: FenbiBrowserWindowLike;
  createView(): FenbiNativeViewLike;
  isAllowedWebHostname(hostname: string): boolean;
  normalizeBounds(input: unknown, contentSize: readonly number[]): { ok: true; value: FenbiViewBounds } | { ok: false; reason: "invalid_bounds" };
};

function ok(value: FenbiViewState): FenbiViewResult<FenbiViewState> {
  return { ok: true, value };
}

function failure(code: Exclude<FenbiViewResult<FenbiViewState>, { ok: true }>['error']['code'], message: string): FenbiViewResult<FenbiViewState> {
  return { ok: false, error: { code, message } };
}

function safeHost(contents: FenbiWebContentsLike, isAllowedWebHostname: (hostname: string) => boolean): FenbiViewState["host"] {
  try {
    const url = new URL(contents.getURL());
    return isAllowedWebHostname(url.hostname) ? url.hostname as FenbiViewState["host"] : undefined;
  } catch {
    return undefined;
  }
}

function safeNavigationState(contents: FenbiWebContentsLike): Pick<FenbiViewState, "canGoBack" | "canGoForward"> {
  try {
    return {
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

/** 可测试的单一 view owner；Electron 适配层只负责创建真实 WebContentsView。 */
export function createFenbiWebContentsAuthority(
  dependencies: FenbiWebContentsAuthorityDependencies,
): FenbiWebContentsAuthority {
  let disposed = false;
  let view: FenbiNativeViewLike | undefined;
  let creationPromise: Promise<FenbiNativeViewLike | undefined> | undefined;
  let latestBounds: FenbiViewBounds = { x: 0, y: 0, width: 0, height: 0 };
  const listeners = new Set<(state: FenbiViewState) => void>();
  const bindings = new Map<FenbiNativeViewLike, Array<[string, FenbiEventListener]>>();
  let state: FenbiViewState = {
    available: true,
    visible: false,
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };

  const snapshot = (): FenbiViewState => ({
    ...state,
    available: !disposed && !dependencies.ownerWindow.isDestroyed(),
  });

  const publish = (patch: Partial<FenbiViewState>): void => {
    state = { ...state, ...patch };
    const next = snapshot();
    for (const listener of listeners) listener(next);
  };

  const syncNavigationState = (target: FenbiNativeViewLike): void => {
    publish({ host: safeHost(target.webContents, dependencies.isAllowedWebHostname), ...safeNavigationState(target.webContents) });
  };

  const removeBindings = (target: FenbiNativeViewLike): void => {
    for (const [event, listener] of bindings.get(target) ?? []) target.webContents.off(event, listener);
    bindings.delete(target);
  };

  const detachView = (target: FenbiNativeViewLike, closeContents: boolean): void => {
    removeBindings(target);
    try {
      target.setVisible(false);
    } catch {
      // The view may already be destroyed during BrowserWindow teardown.
    }
    try {
      dependencies.ownerWindow.contentView.removeChildView(target);
    } catch {
      // Removing a child from a destroyed contentView is already a cleanup no-op.
    }
    if (closeContents) {
      try {
        if (!target.webContents.isDestroyed()) target.webContents.close({ waitForBeforeUnload: false });
      } catch {
        // Cleanup must stay best-effort and must not leak a failed launch error.
      }
    }
  };

  const handleDestroyed = (target: FenbiNativeViewLike): void => {
    if (view !== target) return;
    removeBindings(target);
    try {
      dependencies.ownerWindow.contentView.removeChildView(target);
    } catch {
      // The child has already gone away.
    }
    view = undefined;
    publish({ visible: false, loading: false, host: undefined, canGoBack: false, canGoForward: false, lastError: "view_unavailable" });
  };

  const attachListeners = (target: FenbiNativeViewLike): void => {
    const onStartLoading = () => publish({ loading: true, lastError: undefined });
    const onStopLoading = () => {
      publish({ loading: false });
      syncNavigationState(target);
    };
    const onNavigation = () => {
      publish({ loading: false, lastError: undefined });
      syncNavigationState(target);
    };
    const onFailedLoad = () => publish({ loading: false, lastError: "load_failed" });
    const onDestroyed = () => handleDestroyed(target);
    const targetBindings: Array<[string, FenbiEventListener]> = [
      ["did-start-loading", onStartLoading],
      ["did-stop-loading", onStopLoading],
      ["did-navigate", onNavigation],
      ["did-navigate-in-page", onNavigation],
      ["did-fail-load", onFailedLoad],
      ["destroyed", onDestroyed],
    ];
    bindings.set(target, targetBindings);
    for (const [event, listener] of targetBindings) target.webContents.on(event, listener);
  };

  const loadHome = (target: FenbiNativeViewLike): void => {
    publish({ loading: true, lastError: undefined });
    try {
      void Promise.resolve(target.webContents.loadURL(FENBI_HOME_URL)).catch(() => {
        if (view === target) publish({ loading: false, lastError: "load_failed" });
      });
    } catch {
      publish({ loading: false, lastError: "load_failed" });
    }
  };

  const ensureView = async (): Promise<FenbiNativeViewLike | undefined> => {
    if (disposed || dependencies.ownerWindow.isDestroyed()) {
      publish({ available: false, visible: false });
      return undefined;
    }
    if (view && !view.webContents.isDestroyed()) return view;
    if (creationPromise) return creationPromise;

    creationPromise = (async () => {
      let created: FenbiNativeViewLike | undefined;
      try {
        created = dependencies.createView();
        dependencies.ownerWindow.contentView.addChildView(created);
        view = created;
        attachListeners(created);
        created.setBounds(latestBounds);
        created.setVisible(false);
        publish({ available: true, visible: false, loading: false, lastError: undefined });
        loadHome(created);
        return created;
      } catch {
        if (created) {
          if (view === created) view = undefined;
          detachView(created, true);
        }
        publish({ available: true, visible: false, loading: false, lastError: "view_unavailable" });
        return undefined;
      }
    })();
    try {
      return await creationPromise;
    } finally {
      creationPromise = undefined;
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    dependencies.ownerWindow.off("closed", onOwnerClosed);
    if (view) {
      const currentView = view;
      view = undefined;
      detachView(currentView, true);
    }
    state = { ...state, available: false, visible: false, loading: false };
    listeners.clear();
  };

  const onOwnerClosed = () => dispose();
  dependencies.ownerWindow.on("closed", onOwnerClosed);

  const authority: FenbiWebContentsAuthority = {
    getState: snapshot,
    show: async () => {
      const target = await ensureView();
      if (!target) return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      try {
        target.setBounds(latestBounds);
        target.setVisible(true);
        publish({ available: true, visible: true });
        syncNavigationState(target);
        return ok(snapshot());
      } catch {
        publish({ visible: false, lastError: "view_unavailable" });
        return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      }
    },
    hide: async () => {
      if (!view) {
        publish({ visible: false });
        return ok(snapshot());
      }
      try {
        view.setVisible(false);
        publish({ visible: false });
        return ok(snapshot());
      } catch {
        publish({ visible: false, lastError: "view_unavailable" });
        return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      }
    },
    setBounds: async (input) => {
      if (disposed || dependencies.ownerWindow.isDestroyed()) return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      const normalized = dependencies.normalizeBounds(input, dependencies.ownerWindow.getContentSize());
      if (!normalized.ok) return failure("invalid_bounds", FENBI_BOUNDS_INVALID_MESSAGE);
      latestBounds = normalized.value;
      if (view) {
        try {
          view.setBounds(latestBounds);
        } catch {
          publish({ lastError: "view_unavailable" });
          return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
        }
      }
      return ok(snapshot());
    },
    openHome: async () => {
      const target = await ensureView();
      if (!target) return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      loadHome(target);
      return ok(snapshot());
    },
    reload: async () => {
      const target = await ensureView();
      if (!target) return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      try {
        target.webContents.reload();
        publish({ loading: true, lastError: undefined });
        return ok(snapshot());
      } catch {
        publish({ loading: false, lastError: "navigation_unavailable" });
        return failure("navigation_unavailable", FENBI_NAVIGATION_UNAVAILABLE_MESSAGE);
      }
    },
    goBack: async () => {
      const target = await ensureView();
      if (!target) return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      try {
        const history = target.webContents.navigationHistory;
        if (history.canGoBack()) void Promise.resolve(history.goBack()).catch(() => publish({ lastError: "navigation_unavailable" }));
        return ok(snapshot());
      } catch {
        publish({ lastError: "navigation_unavailable" });
        return failure("navigation_unavailable", FENBI_NAVIGATION_UNAVAILABLE_MESSAGE);
      }
    },
    goForward: async () => {
      const target = await ensureView();
      if (!target) return failure("view_unavailable", FENBI_VIEW_UNAVAILABLE_MESSAGE);
      try {
        const history = target.webContents.navigationHistory;
        if (history.canGoForward()) void Promise.resolve(history.goForward()).catch(() => publish({ lastError: "navigation_unavailable" }));
        return ok(snapshot());
      } catch {
        publish({ lastError: "navigation_unavailable" });
        return failure("navigation_unavailable", FENBI_NAVIGATION_UNAVAILABLE_MESSAGE);
      }
    },
    onStateChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose,
  };

  return authority;
}
