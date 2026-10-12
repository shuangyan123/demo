import type { LearningTargetV1 } from "./learning-kernel.ts";
import type { VerificationSourceSpecV1 } from "./verification-source.ts";

/** 仅扩展 canonical spec；不包含作答、辅助、时间或 capture authority。 */
export type FirstPartyDiagnosticSpecV1 = Readonly<VerificationSourceSpecV1> & {
  readonly learningTarget: Readonly<LearningTargetV1>;
  readonly content: {
    readonly prompt: string;
    readonly options: readonly Readonly<{ id: string; text: string }>[];
  };
  readonly responseFormat: Readonly<{ kind: "single_option_id"; schemaVersion: 1 }>;
  readonly authority: {
    readonly sourceOwnerId: "recall-diagnostic";
    readonly scope: "spec_only";
    readonly keyRule: "bounded-integer-addition/v1";
    readonly operands: readonly [number, number];
    readonly rationale: string;
  };
};

export type FirstPartyDiagnosticSpecResolutionV1 =
  | { kind: "resolved"; spec: FirstPartyDiagnosticSpecV1 }
  | { kind: "rejected"; reason: "invalid_request" | "unknown_spec" | "spec_revision_mismatch" | "invalid_spec" };
