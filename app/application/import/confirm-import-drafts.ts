import { importDraftRepository, type ImportDraftConfirmation } from "../../services/import-draft-repository.ts";
import { reviewRepository } from "../../services/review-repository.ts";
import type { ImportJob } from "../../types/domains/import.ts";
import {
  type ConfirmImportDraftsResult,
  ImportApplicationError,
  type ImportConfirmationReceipt,
} from "./import-application.ts";

export type ConfirmImportDraftsDependencies = {
  confirmDrafts: (ids: string[], today: Date) => Promise<ImportDraftConfirmation>;
  createImportJob: (input: Omit<ImportJob, "id" | "createdAt">, today: Date) => Promise<ImportJob>;
};

export type ConfirmImportDraftsInput = {
  draftIds: string[];
  today: Date;
  dependencies?: ConfirmImportDraftsDependencies;
};

const defaultDependencies: ConfirmImportDraftsDependencies = {
  confirmDrafts: (ids, today) => importDraftRepository.confirmDrafts(ids, today),
  createImportJob: (input, today) => reviewRepository.createImportJob(input, today),
};

/**
 * 确认 transaction 是核心提交，ImportJob 是随后写入的审计记录。
 * 审计失败时不重跑确认，而是通过 partialResult 暴露可撤销的真实提交集合。
 */
export async function confirmImportDrafts(input: ConfirmImportDraftsInput): Promise<ConfirmImportDraftsResult> {
  const dependencies = input.dependencies ?? defaultDependencies;
  const requestedDraftIds = Array.from(new Set(input.draftIds));

  let confirmation: ImportDraftConfirmation;
  try {
    confirmation = await dependencies.confirmDrafts(requestedDraftIds, input.today);
  } catch (error) {
    throw new ImportApplicationError("confirm-drafts", error, {}, "safe");
  }

  const confirmedDraftIds = confirmation.confirmedDrafts.map((draft) => draft.id);
  const confirmedIdSet = new Set(confirmedDraftIds);
  const receipt: ImportConfirmationReceipt = {
    requestedDraftIds,
    confirmedDraftIds,
    skippedDraftIds: requestedDraftIds.filter((id) => !confirmedIdSet.has(id)),
    confirmedDrafts: confirmation.confirmedDrafts,
    createdMistakes: confirmation.createdMistakes,
  };

  let importJob: ImportJob;
  try {
    importJob = await dependencies.createImportJob(
      {
        type: "text",
        rawText: "",
        status: "saved",
        parsedCount: receipt.createdMistakes.length,
        message: `${receipt.createdMistakes.length} 条粉笔错题草稿已确认入库`,
      },
      input.today,
    );
  } catch (error) {
    throw new ImportApplicationError(
      "record-import-job",
      error,
      { confirmation: receipt },
      receipt.createdMistakes.length ? "manual-only" : "safe",
    );
  }

  return { ...receipt, importJob };
}
