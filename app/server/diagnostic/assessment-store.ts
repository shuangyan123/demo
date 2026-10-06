import { randomUUID } from "node:crypto";
import type { DiagnosticCaptureCapabilityV1, DiagnosticCaptureSessionV1, DiagnosticCapturedAttemptV1 } from "../../types/domains/first-party-diagnostic-capture.ts";
import { createControlledDiagnosticCapture } from "../../services/first-party-diagnostic/capture-authority.ts";

const LIFETIME_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 256;
type Entry = { mechanism: DiagnosticCaptureCapabilityV1; session: DiagnosticCaptureSessionV1;
  expiresAt: number; attempt?: DiagnosticCapturedAttemptV1 };
type Store = Map<string, Entry>;
const STORE_KEY = Symbol.for("recall.controlled-diagnostic.sessions.v1");
const serverGlobal = globalThis as typeof globalThis & { [STORE_KEY]?: Store };

// Next page/route bundles 在同一 server process 共享状态；不写浏览器存储或第二套数据库。
function store(): Store {
  const entries = serverGlobal[STORE_KEY] ??= new Map();
  const now = Date.now();
  for (const [id, entry] of entries) if (entry.expiresAt <= now) entries.delete(id);
  return entries;
}

/** 只能由固定 server-rendered 页面调用；session token 与其 exact canonical form 一同交付。 */
export function issueDiagnostic() {
  const entries = store();
  if (entries.size >= MAX_SESSIONS) return { kind: "unavailable" } as const;
  const mechanism = createControlledDiagnosticCapture();
  const started = mechanism.begin({ specId: "int-add-2-3", specRevision: "r1" });
  if (started.kind !== "started") return { kind: "unavailable" } as const;
  const sessionId = randomUUID();
  if (entries.has(sessionId)) return { kind: "unavailable" } as const;
  entries.set(sessionId, { mechanism, session: started.session, expiresAt: Date.now() + LIFETIME_MS });
  return { kind: "issued", sessionId, presentation: started.session.presentation } as const;
}

/** 输入仅是 opaque session locator 与 learner action，不接收 trusted capture facts。 */
export function submitDiagnostic(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { kind: "rejected", reason: "invalid_request" } as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== 2 || !["sessionId", "selectedOptionId"].every((key) => Object.hasOwn(descriptors, key)
    && "value" in descriptors[key] && typeof descriptors[key].value === "string"))
    return { kind: "rejected", reason: "invalid_request" } as const;
  const sessionId = descriptors.sessionId.value as string;
  const entry = store().get(sessionId);
  if (!entry) return { kind: "rejected", reason: "unknown_session" } as const;
  const result = entry.session.submit({ selectedOptionId: descriptors.selectedOptionId.value });
  if (result.kind === "captured") entry.attempt = result.attempt;
  return result;
}

export function readDiagnostic(sessionId: string) {
  const entry = store().get(sessionId);
  if (!entry) return { kind: "unavailable" } as const;
  if (!entry.attempt) return { kind: "issued", sessionId, presentation: entry.session.presentation } as const;
  const reveal = entry.session.reveal();
  if (reveal.kind !== "revealed") return { kind: "unavailable" } as const;
  return { kind: "revealed", presentation: entry.session.presentation,
    selectedOptionId: entry.attempt.selectedOptionId, correctOptionId: reveal.correctOptionId, explanation: reveal.explanation } as const;
}

/** 只返回实际 controlled capture 中封存的事实；expiry/restart/unknown 均无 fallback。 */
export function resolveDiagnosticAttempt(attemptId: string) {
  for (const entry of store().values()) {
    const attempt = entry.attempt;
    if (!attempt || attempt.id !== attemptId) continue;
    const result = entry.mechanism.lookup({ sourceOwnerId: "recall-diagnostic", specId: attempt.specId,
      specRevision: attempt.specRevision, attemptId });
    return result.kind === "resolved" ? result.attempt : undefined;
  }
  return undefined;
}
