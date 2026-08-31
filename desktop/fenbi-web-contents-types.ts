export type FenbiViewHost = "www.fenbi.com" | "tiku.fenbi.com";
export type FenbiViewErrorCode = "untrusted_sender" | "view_unavailable" | "invalid_bounds" | "load_failed" | "navigation_unavailable";

export type FenbiViewState = {
  available: boolean;
  visible: boolean;
  loading: boolean;
  host?: FenbiViewHost;
  canGoBack: boolean;
  canGoForward: boolean;
  lastError?: Exclude<FenbiViewErrorCode, "untrusted_sender" | "invalid_bounds">;
};

export type FenbiViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FenbiViewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: FenbiViewErrorCode; message: string } };

export type FenbiViewPreloadBridge = {
  getState(): Promise<FenbiViewResult<FenbiViewState>>;
  show(): Promise<FenbiViewResult<FenbiViewState>>;
  hide(): Promise<FenbiViewResult<FenbiViewState>>;
  setBounds(bounds: FenbiViewBounds): Promise<FenbiViewResult<FenbiViewState>>;
  openHome(): Promise<FenbiViewResult<FenbiViewState>>;
  reload(): Promise<FenbiViewResult<FenbiViewState>>;
  goBack(): Promise<FenbiViewResult<FenbiViewState>>;
  goForward(): Promise<FenbiViewResult<FenbiViewState>>;
  onStateChanged(listener: (state: FenbiViewState) => void): () => void;
};
