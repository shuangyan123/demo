import { resolvePublishedDiagnosticSpec } from "./spec-authority-core.ts";

// 内部 spec-only capability；没有 capture resolver，因此不加入 production admission owner 集合。
export const FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER = Object.freeze({
  id: "recall-diagnostic" as const,
  resolveSpec: resolvePublishedDiagnosticSpec,
});
