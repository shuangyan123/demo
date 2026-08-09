import type { ImportJob, PersistedImportDraft } from "../../types/domains/import.ts";
import type { Mistake } from "../../types/domains/review.ts";

export type ImportApplicationStep = "confirm-drafts" | "record-import-job";
export type ImportRetrySafety = "safe" | "manual-only";

/** 只记录本次确认 transaction 实际提交的数据，可直接建立内存撤销凭据。 */
export type ImportConfirmationReceipt = {
  requestedDraftIds: string[];
  confirmedDraftIds: string[];
  skippedDraftIds: string[];
  confirmedDrafts: PersistedImportDraft[];
  createdMistakes: Mistake[];
};

export type ConfirmImportDraftsResult = ImportConfirmationReceipt & {
  importJob: ImportJob;
};

export type ImportConfirmationPartialResult = {
  confirmation?: ImportConfirmationReceipt;
};

/** 确认与审计记录不构成跨表事务；partialResult 明确已经提交的确认事实。 */
export class ImportApplicationError extends Error {
  readonly partialResult: ImportConfirmationPartialResult;
  readonly retrySafety: ImportRetrySafety;
  readonly step: ImportApplicationStep;

  constructor(
    step: ImportApplicationStep,
    cause: unknown,
    partialResult: ImportConfirmationPartialResult,
    retrySafety: ImportRetrySafety,
  ) {
    super(cause instanceof Error ? cause.message : "导入草稿确认失败", { cause });
    this.name = "ImportApplicationError";
    this.step = step;
    this.partialResult = { ...partialResult };
    this.retrySafety = retrySafety;
  }
}
