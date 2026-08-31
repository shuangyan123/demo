import type { FenbiViewBounds } from "./fenbi-web-contents-types.js";

export const MAX_FENBI_VIEW_DIMENSION = 10_000;

export type FenbiBoundsNormalization =
  | { ok: true; value: FenbiViewBounds }
  | { ok: false; reason: "invalid_bounds" };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 将 renderer 提供的 CSS 几何限制在 BrowserWindow content area 内。 */
export function normalizeFenbiViewBounds(input: unknown, contentSize: readonly number[]): FenbiBoundsNormalization {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, reason: "invalid_bounds" };
  const candidate = input as Record<string, unknown>;
  const x = candidate.x;
  const y = candidate.y;
  const width = candidate.width;
  const height = candidate.height;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height) || width < 0 || height < 0) {
    return { ok: false, reason: "invalid_bounds" };
  }

  const contentWidth = contentSize[0];
  const contentHeight = contentSize[1];
  if (!isFiniteNumber(contentWidth) || !isFiniteNumber(contentHeight) || contentWidth < 0 || contentHeight < 0) {
    return { ok: false, reason: "invalid_bounds" };
  }

  const safeX = Math.min(Math.max(x, 0), contentWidth);
  const safeY = Math.min(Math.max(y, 0), contentHeight);
  const safeWidth = Math.min(width, MAX_FENBI_VIEW_DIMENSION, Math.max(0, contentWidth - safeX));
  const safeHeight = Math.min(height, MAX_FENBI_VIEW_DIMENSION, Math.max(0, contentHeight - safeY));
  return {
    ok: true,
    value: { x: safeX, y: safeY, width: safeWidth, height: safeHeight },
  };
}
