import type {
  CredentialProtectionStatus,
  HostKind,
} from "../../platform/capabilities.ts";
import type { CredentialMigrationJournal } from "../../services/credential-migration-state.ts";
import type { CredentialMigrationResult } from "../../services/credential-migration-service.ts";

export type DesktopCredentialMigrationUiStatus =
  | "ready"
  | "in_progress"
  | "complete"
  | "requires_reentry"
  | "blocked"
  | "recovery_required"
  | "unavailable";

export type DesktopCredentialMigrationUiModel = {
  visible: boolean;
  status: DesktopCredentialMigrationUiStatus;
  message: string;
  busy: boolean;
  canStart: boolean;
};

type ProjectionInput = {
  hostKind: HostKind;
  protectionStatus: CredentialProtectionStatus["status"];
  journal: Pick<CredentialMigrationJournal, "state" | "reason" | "backendPolicy">;
  operationStatus?: CredentialMigrationResult["status"];
  busy?: boolean;
};

const SAFE_MESSAGES: Record<DesktopCredentialMigrationUiStatus, string> = {
  ready: "可以将现有本机凭据迁移到 Desktop 保护。Web 凭据会保留，且不会执行清理。",
  in_progress: "Desktop 凭据迁移正在进行。请保持应用打开，不要重复操作。",
  complete: "Desktop 凭据保护已完成。Web 凭据仍保留作恢复证据，未执行清理。",
  requires_reentry: "部分凭据需要重新输入。完成重新输入后，可以安全重试迁移。",
  blocked: "当前凭据迁移被安全规则阻止。处理对应配置后，可以安全重试。",
  recovery_required: "迁移需要恢复。可以安全重试；Web 凭据仍保留，未执行清理。",
  unavailable: "Desktop 凭据保护当前不可用。未执行迁移，也不会回退到明文或 Web 写入。",
};

const IN_PROGRESS_STATES = new Set<CredentialMigrationJournal["state"]>([
  "preflight",
  "staging",
  "verifying",
  "ready_to_commit",
  "committing",
]);

function hiddenModel(): DesktopCredentialMigrationUiModel {
  return {
    visible: false,
    status: "ready",
    message: "",
    busy: false,
    canStart: false,
  };
}

function statusForBlockedReason(reason: string | undefined): DesktopCredentialMigrationUiStatus {
  if (reason === "migration_host_unavailable" || reason === "desktop_host_unavailable") return "unavailable";
  if (reason === "requires_reentry" || reason === "masked_only_rejected" || reason === "credential_requires_reentry") return "requires_reentry";
  return "blocked";
}

function canStart(status: DesktopCredentialMigrationUiStatus): boolean {
  return status === "ready"
    || status === "requires_reentry"
    || status === "blocked"
    || status === "recovery_required";
}

function model(status: DesktopCredentialMigrationUiStatus, busy = false): DesktopCredentialMigrationUiModel {
  return {
    visible: true,
    status,
    message: SAFE_MESSAGES[status],
    busy,
    canStart: !busy && canStart(status),
  };
}

/** 只把安全的 Host/journal 事实投影给 UI，不把 journal IDs、原因原文或凭据材料带入 React 状态。 */
export function projectDesktopCredentialMigration(input: ProjectionInput): DesktopCredentialMigrationUiModel {
  if (input.hostKind !== "desktop") return hiddenModel();
  if (input.busy) return model("in_progress", true);
  if (input.protectionStatus !== "available") return model("unavailable");

  if (input.operationStatus === "requires_reentry") return model("requires_reentry");
  if (input.operationStatus === "recovery_required") return model("recovery_required");
  if (input.operationStatus === "blocked") return model(statusForBlockedReason(input.journal.reason));
  if (input.operationStatus === "complete") return model(input.journal.backendPolicy === "desktop_preferred" ? "complete" : "ready");

  if (input.journal.state === "complete") return model(input.journal.backendPolicy === "desktop_preferred" ? "complete" : "ready");
  if (input.journal.state === "recovery_required") return model("recovery_required");
  if (input.journal.state === "blocked") return model(statusForBlockedReason(input.journal.reason));
  if (IN_PROGRESS_STATES.has(input.journal.state)) return model("recovery_required");
  return model("ready");
}
