import type { AiSelectedRuntimeValues } from "./ai-model.ts";

/** 外部知识采集支持的公考领域。 */
export type AcquisitionDomain = "xingce" | "shenlun" | "interview";

/** 来源内容的持久化策略，默认只能保留摘要与必要证据。 */
export type AcquisitionContentPolicy = "summary_only" | "licensed_full_text";

/** 来源权威性由用户配置，不由模型猜测。 */
export type AcquisitionAuthority = "official" | "recognized" | "other";

/** 模型引用只保存连接、模型和运行参数，不复制密钥。 */
export type AcquisitionModelRef = {
  connectionId: string;
  modelId: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
};

type AcquisitionSourceBase = {
  id: string;
  label: string;
  enabled: boolean;
  allowedOrigins: string[];
  authority: AcquisitionAuthority;
  contentPolicy: AcquisitionContentPolicy;
  licenseNote?: string;
};

/** 用户明确启用的页面来源。 */
export type AcquisitionUrlSource = AcquisitionSourceBase & {
  kind: "url";
  urls: string[];
};

/** 用户明确启用的 RSS 或 Atom 来源。 */
export type AcquisitionFeedSource = AcquisitionSourceBase & {
  kind: "feed";
  url: string;
};

/** MCP 搜索只负责发现候选 URL，正文仍由安全抓取层读取。 */
export type AcquisitionMcpSource = AcquisitionSourceBase & {
  kind: "mcp_search";
  serverId: string;
  toolName: string;
  argumentTemplate: string;
};

export type AcquisitionSourceConfig = AcquisitionUrlSource | AcquisitionFeedSource | AcquisitionMcpSource;

/** 已安排定义中的采集配置，不包含任何连接密钥。 */
export type AutomationCollectionConfig = {
  domain: AcquisitionDomain;
  queries: string[];
  sources: AcquisitionSourceConfig[];
  allowedOrigins: string[];
  freshnessDays: number;
  maxDocuments: number;
  curator?: AcquisitionModelRef;
  reviewer?: AcquisitionModelRef;
};

/** 运行期标准化文档；text 不得持久化到运行记录或提案。 */
export type AcquisitionDocument = {
  id: string;
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: string;
  fetchedAt: string;
  contentHash: string;
  text: string;
  excerpt: string;
  sourceKind: AcquisitionSourceConfig["kind"];
  authority: AcquisitionAuthority;
  contentPolicy: AcquisitionContentPolicy;
  licenseNote?: string;
};

/** 可持久化的必要证据摘录。 */
export type AcquisitionEvidence = {
  id: string;
  documentId: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
  quote: string;
  contentHash: string;
};

export type AcquisitionReviewStatus = "agreed" | "disputed" | "not_configured";
export type AcquisitionTrustGrade = "A" | "B" | "C";

/** 确定性 100 分可信度明细。 */
export type AcquisitionTrustBreakdown = {
  authority: number;
  evidenceCoverage: number;
  corroboration: number;
  recency: number;
  modelAgreement: number;
  completeness: number;
  total: number;
  grade: AcquisitionTrustGrade;
  blockingIssues: string[];
};

/** 提案保存的溯源信息，不包含完整网页、完整提示词或模型原始响应。 */
export type AcquisitionProposalProvenance = {
  domain: AcquisitionDomain;
  documents: Array<{
    url: string;
    title: string;
    publisher?: string;
    publishedAt?: string;
    fetchedAt: string;
    contentHash: string;
    acquisitionMethod: AcquisitionSourceConfig["kind"];
    licenseNote?: string;
  }>;
  evidence: AcquisitionEvidence[];
  claimEvidence: Array<{ claimId: string; evidenceIds: string[] }>;
  curator?: AcquisitionModelRef;
  reviewer?: AcquisitionModelRef;
  schemaVersion: "acquisition-proposal-v1";
  promptVersion: "scheduled-collection-v1";
  reviewStatus: AcquisitionReviewStatus;
  reviewIssues: string[];
  trust: AcquisitionTrustBreakdown;
};

/** 运行收件箱只保存数量摘要。 */
export type AcquisitionRunSummary = {
  discoveredCount: number;
  fetchedCount: number;
  duplicateCount: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  disputedCount: number;
  reviewStatus: AcquisitionReviewStatus;
};
