import type { AuthorizedVerificationSourceOwner } from "../../services/verification-source/verification-source-admission-core.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../../services/first-party-diagnostic/spec-authority.ts";
import { resolveDiagnosticAttempt } from "./assessment-store.ts";

// 固定内部 owner；没有公开 registry、caller resolver、fixture 或其他来源 fallback。
export const FIRST_PARTY_DIAGNOSTIC_SOURCE_OWNER: AuthorizedVerificationSourceOwner = Object.freeze({
  id: "recall-diagnostic",
  resolveSpec(specId: string, revision: string) {
    const result = FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(specId, revision);
    return result.kind === "resolved" ? result.spec : undefined;
  },
  resolveAttempt: resolveDiagnosticAttempt,
});
