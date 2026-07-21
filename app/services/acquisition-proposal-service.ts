import type {
  AcquisitionDocument,
  AcquisitionEvidence,
  AcquisitionModelRef,
  AcquisitionReviewStatus,
  ApiConnectionProfile,
  AutomationCollectionConfig,
  KnowledgeCategory,
  KnowledgeEvolutionProposal,
} from "../types/review.ts";
import { generateWithConnection } from "./ai-connection-client.ts";
import { parseAiJsonObject } from "./ai-json.ts";
import { calculateAcquisitionTrust } from "./acquisition-trust.ts";

type ModelSelection = { connection: ApiConnectionProfile; ref: AcquisitionModelRef };
type CuratorParagraph = { text?: unknown; evidenceIds?: unknown };
type CuratorItem = { key?: unknown; title?: unknown; summary?: unknown; paragraphs?: unknown; tags?: unknown; proposedLinks?: unknown; reason?: unknown };
type ReviewerItem = { key?: unknown; status?: unknown; issues?: unknown };

const curatorSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["items"], properties: {
    items: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["key", "title", "summary", "paragraphs", "tags", "proposedLinks", "reason"], properties: {
      key: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
      paragraphs: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["text", "evidenceIds"], properties: {
        text: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
      } } },
      tags: { type: "array", items: { type: "string" } }, proposedLinks: { type: "array", items: { type: "string" } }, reason: { type: "string" },
    } } },
  },
};

const reviewerSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["items"], properties: {
    items: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["key", "status", "issues"], properties: {
      key: { type: "string" }, status: { type: "string", enum: ["agreed", "disputed"] }, issues: { type: "array", items: { type: "string" } },
    } } },
  },
};

function textList(value: unknown, limit = 12): string[] {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function knowledgeCategory(domain: AutomationCollectionConfig["domain"]): KnowledgeCategory {
  if (domain === "shenlun") return "申论";
  if (domain === "interview") return "政治理论";
  return "常识判断";
}

function domainInstruction(domain: AutomationCollectionConfig["domain"]): string {
  if (domain === "xingce") return "聚焦题型方法、答案依据和常见陷阱；不要把外部试题直接写入应用题库。";
  if (domain === "shenlun") return "聚焦政策原文、主题素材和论证结构，明确发布时间与政策主体。";
  return "严格区分可核验事实、观点材料和作答框架，不把观点写成事实。";
}

/** 从运行期正文构造有限证据片段，完整正文不会进入提案。 */
export function buildAcquisitionEvidence(documents: AcquisitionDocument[]): AcquisitionEvidence[] {
  return documents.flatMap((document) => {
    const chunks = document.text.match(/.{1,360}(?:\s|$)/g)?.slice(0, 4) ?? [document.excerpt.slice(0, 360)];
    return chunks.filter(Boolean).map((quote, index) => ({
      id: `${document.id}:e${index + 1}`,
      documentId: document.id,
      url: document.url,
      publisher: document.publisher,
      publishedAt: document.publishedAt,
      quote: quote.trim().slice(0, 360),
      contentHash: document.contentHash,
    }));
  });
}

function normalizeCuratorItems(content: string, evidenceIds: Set<string>): Array<{
  key: string; title: string; summary: string; paragraphs: Array<{ text: string; evidenceIds: string[] }>; tags: string[]; proposedLinks: string[]; reason: string;
}> {
  const object = parseAiJsonObject(content, "整理模型返回的采集提案不是有效 JSON 对象");
  const items = Array.isArray(object.items) ? object.items as CuratorItem[] : [];
  return items.slice(0, 5).flatMap((item, index) => {
    const paragraphs = (Array.isArray(item.paragraphs) ? item.paragraphs as CuratorParagraph[] : []).slice(0, 8).map((paragraph) => ({
      text: String(paragraph.text ?? "").trim().slice(0, 1200),
      evidenceIds: textList(paragraph.evidenceIds, 8).filter((id) => evidenceIds.has(id)),
    })).filter((paragraph) => paragraph.text);
    const title = String(item.title ?? "").trim().slice(0, 120);
    if (!title || !paragraphs.length) return [];
    return [{
      key: String(item.key ?? `proposal-${index + 1}`).trim().slice(0, 80) || `proposal-${index + 1}`,
      title,
      summary: String(item.summary ?? "").trim().slice(0, 500),
      paragraphs,
      tags: textList(item.tags, 10),
      proposedLinks: textList(item.proposedLinks, 10),
      reason: String(item.reason ?? "由外部资料整理为待确认知识演进提案").trim().slice(0, 500),
    }];
  });
}

async function reviewItems(input: { reviewer?: ModelSelection; items: ReturnType<typeof normalizeCuratorItems>; evidence: AcquisitionEvidence[] }): Promise<Map<string, { status: AcquisitionReviewStatus; issues: string[] }>> {
  if (!input.reviewer) return new Map(input.items.map((item) => [item.key, { status: "not_configured", issues: ["未交叉复核"] }]));
  const response = await generateWithConnection(input.reviewer.connection, "text", {
    modelId: input.reviewer.ref.modelId,
    selectedRuntimeValues: input.reviewer.ref.selectedRuntimeValues,
    temperature: 0,
    maxOutputTokens: 1800,
    structuredOutput: { name: "scheduled_collection_review", schema: reviewerSchema, strict: true },
    messages: [
      { role: "system", content: "你是独立事实复核模型。仅根据给定证据检查每项提案是否被支持；发现事实冲突、证据错配或观点冒充事实时标记 disputed。只返回 schema 指定 JSON，不输出思维过程。" },
      { role: "user", content: JSON.stringify({ proposals: input.items, evidence: input.evidence }) },
    ],
  });
  const parsed = parseAiJsonObject(response.content, "复核模型返回的结果不是有效 JSON 对象");
  const decisions = Array.isArray(parsed.items) ? parsed.items as ReviewerItem[] : [];
  return new Map(decisions.map((item) => [String(item.key ?? ""), {
    status: item.status === "agreed" ? "agreed" : "disputed",
    issues: textList(item.issues, 10),
  }]));
}

function markdownContent(item: ReturnType<typeof normalizeCuratorItems>[number], evidenceById: Map<string, AcquisitionEvidence>): string {
  const usedIds = [...new Set(item.paragraphs.flatMap((paragraph) => paragraph.evidenceIds))];
  const footnoteNumber = new Map(usedIds.map((id, index) => [id, index + 1]));
  const paragraphs = item.paragraphs.map((paragraph) => {
    const refs = paragraph.evidenceIds.map((id) => footnoteNumber.get(id)).filter(Boolean).map((number) => `[^e${number}]`).join("");
    return `${paragraph.text}${refs}`;
  }).join("\n\n");
  const sourceBlock = usedIds.map((id) => {
    const evidence = evidenceById.get(id)!;
    const number = footnoteNumber.get(id)!;
    const metadata = [evidence.publisher, evidence.publishedAt].filter(Boolean).join(" · ");
    return `[^e${number}]: ${evidence.quote} — [来源](${evidence.url})${metadata ? `（${metadata}）` : ""}`;
  }).join("\n");
  return `${paragraphs}\n\n## 来源与证据\n\n${sourceBlock}`;
}

/** 仅摘要来源不得在生成稿中出现 120 字以上连续原文。 */
function violatesSummaryPolicy(item: ReturnType<typeof normalizeCuratorItems>[number], documents: AcquisitionDocument[]): boolean {
  const generated = item.paragraphs.map((paragraph) => paragraph.text.replace(/\s+/g, "")).join("\n");
  return documents.filter((document) => document.contentPolicy === "summary_only").some((document) => {
    const source = document.text.replace(/\s+/g, "");
    if (source.length < 120) return false;
    for (let offset = 0; offset <= source.length - 120; offset += 60) {
      if (generated.includes(source.slice(offset, offset + 120))) return true;
    }
    return false;
  });
}

/** 双模型只整理和复核，最终始终生成 pending 提案。 */
export async function requestAcquisitionProposals(input: {
  config: AutomationCollectionConfig;
  documents: AcquisitionDocument[];
  curator: ModelSelection;
  reviewer?: ModelSelection;
  existingProposals?: KnowledgeEvolutionProposal[];
  timestamp?: string;
}): Promise<KnowledgeEvolutionProposal[]> {
  if (!input.documents.length) return [];
  const evidence = buildAcquisitionEvidence(input.documents);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const curatorResponse = await generateWithConnection(input.curator.connection, "text", {
    modelId: input.curator.ref.modelId,
    selectedRuntimeValues: input.curator.ref.selectedRuntimeValues,
    temperature: 0.1,
    maxOutputTokens: 3200,
    structuredOutput: { name: "scheduled_collection_proposals", schema: curatorSchema, strict: true },
    messages: [
      { role: "system", content: [
        "你把白名单外部资料整理为 Obsidian 知识演进候选。每个正文段落必须引用至少一个输入 evidenceId；不得创造 URL、发布日期或证据。",
        "summary_only 来源只能概括，不得复刻完整文章或完整试题；licensed_full_text 也只保留完成知识提案所必需的内容。",
        domainInstruction(input.config.domain),
        "只返回 schema 指定 JSON，不输出隐藏思维过程。",
      ].join("\n") },
      { role: "user", content: JSON.stringify({
        queries: input.config.queries,
        documents: input.documents.map((document) => ({ id: document.id, title: document.title, url: document.url, publisher: document.publisher, publishedAt: document.publishedAt, contentPolicy: document.contentPolicy })),
        evidence,
      }) },
    ],
  });
  const items = normalizeCuratorItems(curatorResponse.content, evidenceIds);
  const reviews = await reviewItems({ reviewer: input.reviewer, items, evidence });
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const timestamp = input.timestamp ?? new Date().toISOString();
  return items.map((item) => {
    const claimEvidence = item.paragraphs.map((paragraph, index) => ({ claimId: `${item.key}:p${index + 1}`, evidenceIds: paragraph.evidenceIds }));
    const usedEvidence = evidence.filter((candidate) => claimEvidence.some((claim) => claim.evidenceIds.includes(candidate.id)));
    const documentIds = new Set(usedEvidence.map((candidate) => candidate.documentId));
    const documents = input.documents.filter((document) => documentIds.has(document.id));
    const review = reviews.get(item.key) ?? { status: input.reviewer ? "disputed" as const : "not_configured" as const, issues: input.reviewer ? ["复核结果缺少对应提案"] : ["未交叉复核"] };
    const exactDuplicate = input.existingProposals?.some((proposal) => proposal.title.trim().toLowerCase() === item.title.toLowerCase() && proposal.sourceIds.some((id) => documents.some((document) => document.url === id))) ?? false;
    const completeness = [item.title, item.summary, item.paragraphs.length, item.tags.length, item.reason].filter(Boolean).length / 5;
    const trust = calculateAcquisitionTrust({ documents, claimEvidence, evidenceIds: new Set(usedEvidence.map((candidate) => candidate.id)), reviewStatus: review.status, freshnessDays: input.config.freshnessDays, urlVerified: true, exactDuplicate, contentPolicyViolation: violatesSummaryPolicy(item, documents), requiredFieldsComplete: completeness });
    const content = markdownContent(item, evidenceById);
    return {
      id: crypto.randomUUID(), mode: "create" as const, status: "pending" as const, category: knowledgeCategory(input.config.domain), sourceType: "external" as const,
      sourceIds: [...new Set(documents.map((document) => document.url))], title: item.title, summary: item.summary, content, tags: item.tags,
      proposedLinks: item.proposedLinks, reason: item.reason, confidence: trust.total / 100,
      provenance: {
        domain: input.config.domain,
        documents: documents.map((document) => ({ url: document.url, title: document.title, publisher: document.publisher, publishedAt: document.publishedAt, fetchedAt: document.fetchedAt, contentHash: document.contentHash, acquisitionMethod: document.sourceKind, licenseNote: document.licenseNote })),
        evidence: usedEvidence, claimEvidence, curator: input.curator.ref, reviewer: input.reviewer?.ref,
        schemaVersion: "acquisition-proposal-v1", promptVersion: "scheduled-collection-v1", reviewStatus: review.status, reviewIssues: review.issues, trust,
      },
      createdAt: timestamp, updatedAt: timestamp,
    };
  });
}
