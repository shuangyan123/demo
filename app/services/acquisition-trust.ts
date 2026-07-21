import type {
  AcquisitionAuthority,
  AcquisitionDocument,
  AcquisitionReviewStatus,
  AcquisitionTrustBreakdown,
} from "../types/review.ts";

export type AcquisitionTrustInput = {
  documents: AcquisitionDocument[];
  claimEvidence: Array<{ claimId: string; evidenceIds: string[] }>;
  evidenceIds: Set<string>;
  reviewStatus: AcquisitionReviewStatus;
  freshnessDays: number;
  now?: Date;
  urlVerified: boolean;
  hashChanged?: boolean;
  exactDuplicate?: boolean;
  contentPolicyViolation?: boolean;
  requiredFieldsComplete: number;
};

function authorityScore(authorities: AcquisitionAuthority[]): number {
  if (authorities.includes("official")) return 25;
  if (authorities.includes("recognized")) return 18;
  return authorities.length ? 8 : 0;
}

function evidenceCoverageScore(input: AcquisitionTrustInput): number {
  if (!input.claimEvidence.length) return 0;
  const covered = input.claimEvidence.filter((claim) => claim.evidenceIds.some((id) => input.evidenceIds.has(id))).length;
  return Math.round((covered / input.claimEvidence.length) * 25);
}

function corroborationScore(documents: AcquisitionDocument[]): number {
  if (documents.some((document) => document.authority === "official")) return 15;
  const independentPublishers = new Set(documents.map((document) => document.publisher?.trim().toLowerCase()).filter(Boolean));
  return independentPublishers.size >= 2 ? 15 : 0;
}

function recencyScore(documents: AcquisitionDocument[], freshnessDays: number, now: Date): number {
  const limit = Math.max(1, freshnessDays) * 86_400_000;
  const dates = documents.map((document) => Date.parse(document.publishedAt || document.fetchedAt)).filter(Number.isFinite);
  if (!dates.length) return 0;
  return dates.some((value) => now.getTime() - value <= limit) ? 10 : 4;
}

/** 使用固定权重计算可信度；模型不得直接决定分数。 */
export function calculateAcquisitionTrust(input: AcquisitionTrustInput): AcquisitionTrustBreakdown {
  const authority = authorityScore(input.documents.map((document) => document.authority));
  const evidenceCoverage = evidenceCoverageScore(input);
  const corroboration = corroborationScore(input.documents);
  const recency = recencyScore(input.documents, input.freshnessDays, input.now ?? new Date());
  const modelAgreement = input.reviewStatus === "agreed" ? 15 : 0;
  const completeness = Math.max(0, Math.min(10, Math.round(input.requiredFieldsComplete * 10)));
  const rawTotal = authority + evidenceCoverage + corroboration + recency + modelAgreement + completeness;
  const blockingIssues: string[] = [];
  if (!input.urlVerified) blockingIssues.push("来源 URL 无法验证");
  if (input.claimEvidence.some((claim) => !claim.evidenceIds.some((id) => input.evidenceIds.has(id)))) blockingIssues.push("存在没有证据的正文段落");
  if (input.hashChanged) blockingIssues.push("来源内容哈希已变化");
  if (input.exactDuplicate) blockingIssues.push("与现有提案或知识条目精确重复");
  if (input.contentPolicyViolation) blockingIssues.push("仅摘要来源包含疑似长段原文");
  if (input.reviewStatus === "disputed") blockingIssues.push("整理模型与复核模型存在事实冲突");

  let grade: AcquisitionTrustBreakdown["grade"] = rawTotal >= 85 ? "A" : rawTotal >= 70 ? "B" : "C";
  if (input.reviewStatus === "not_configured" && grade === "A") grade = "B";
  return {
    authority,
    evidenceCoverage,
    corroboration,
    recency,
    modelAgreement,
    completeness,
    total: rawTotal,
    grade,
    blockingIssues: [...new Set(blockingIssues)],
  };
}

/** 争议或证据完整性阻断的提案不得写入 Vault。 */
export function isAcquisitionProposalConfirmable(input: { status: string; provenance?: { trust: AcquisitionTrustBreakdown } }): boolean {
  return input.status === "pending" && (!input.provenance || input.provenance.trust.blockingIssues.length === 0);
}
