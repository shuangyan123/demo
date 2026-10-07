/** Canonical payload issued by the service; issuance does not prove that a renderer displayed it. */
export type DiagnosticPresentationV1 = {
  readonly sourceOwnerId: "recall-diagnostic";
  readonly specId: string;
  readonly specRevision: string;
  readonly contentRevision: string;
  readonly content: {
    readonly prompt: string;
    readonly options: readonly Readonly<{ id: string; text: string }>[];
  };
  readonly responseFormat: Readonly<{ kind: "single_option_id"; schemaVersion: 1 }>;
};

/** 辅助事实只描述 owner 控制的 surface，不证明现实世界不存在外部帮助。 */
export type DiagnosticCapturedAttemptV1 = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sourceOwnerId: "recall-diagnostic";
  readonly specId: string;
  readonly specRevision: string;
  readonly contentRevision: string;
  readonly optionIds: readonly string[];
  readonly responseFormat: DiagnosticPresentationV1["responseFormat"];
  readonly selectedOptionId: string;
  readonly assistance: "unknown" | "none";
  readonly occurredAt: string;
  readonly provenance: {
    readonly mechanism: "first-party-diagnostic-capture/v1";
    readonly presentation: "canonical_snapshot_issued" | "controlled_surface_delivered";
    readonly assistanceBasis: "uncontrolled_surface" | "controlled_surface_no_builtin_assistance";
    readonly ordering: "submitted_before_reveal";
  };
};

declare const diagnosticCaptureIssuer: unique symbol;
/** 内存写入 capability；brand 不序列化，磁盘记录必须由 repository 重新校验。 */
export type IssuedDiagnosticCapturedAttemptV1 = DiagnosticCapturedAttemptV1 & {
  readonly [diagnosticCaptureIssuer]: true;
};

export type DiagnosticCaptureRejectionV1 = {
  readonly kind: "rejected";
  readonly reason: "invalid_request" | "unknown_spec" | "spec_revision_mismatch" | "invalid_spec"
    | "invalid_response" | "already_submitted" | "lifecycle_invalidated" | "reveal_before_submit"
    | "invalid_capture_facts" | "unknown_attempt" | "wrong_owner" | "spec_binding_mismatch";
};

export type DiagnosticCaptureSessionV1 = {
  readonly presentation: DiagnosticPresentationV1;
  readonly submit: (response: unknown) =>
    | { readonly kind: "captured"; readonly attempt: IssuedDiagnosticCapturedAttemptV1 }
    | DiagnosticCaptureRejectionV1;
  readonly reveal: () =>
    | { readonly kind: "revealed"; readonly correctOptionId: string; readonly explanation: string }
    | DiagnosticCaptureRejectionV1;
};

export type DiagnosticCaptureCapabilityV1 = {
  readonly begin: (request: unknown) =>
    | { readonly kind: "started"; readonly session: DiagnosticCaptureSessionV1 }
    | DiagnosticCaptureRejectionV1;
  readonly lookup: (request: unknown) =>
    | { readonly kind: "resolved"; readonly attempt: DiagnosticCapturedAttemptV1 }
    | DiagnosticCaptureRejectionV1;
};
