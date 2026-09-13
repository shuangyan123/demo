import type { TutoringMicroAssessment, TutoringMicroQuestion } from "../types/domains/learner-state.ts";
import { parseAiJsonValue } from "./ai-json.ts";

export const TUTORING_PROTOCOL_VERSION = "v1" as const;

export const TUTORING_PROTOCOL_KINDS = [
  "diagnosis",
  "explanation",
  "guided_practice",
  "micro_assessment",
  "summary",
] as const;

export type TutoringProtocolKind = (typeof TUTORING_PROTOCOL_KINDS)[number];

export type TutoringGeneratedMicroAssessment = Pick<TutoringMicroAssessment, "questions">;

export type TutoringProtocolDiagnosis = {
  summary: string;
  rationale: string;
  evidence: string[];
  confidence: number;
  source: "model_assisted";
};

export type TutoringProtocolNextStep = {
  action?: string;
  question?: string;
};

export type TutoringProtocolResponse = {
  version: typeof TUTORING_PROTOCOL_VERSION;
  kind: TutoringProtocolKind;
  content: string;
  diagnosis?: TutoringProtocolDiagnosis;
  nextStep?: TutoringProtocolNextStep;
  microAssessment?: TutoringGeneratedMicroAssessment;
};

export type TutoringProtocolFailureCode =
  | "malformed_json"
  | "invalid_shape"
  | "unknown_version"
  | "unknown_kind"
  | "disallowed_field"
  | "empty_content"
  | "content_too_long"
  | "invalid_diagnosis"
  | "incompatible_diagnosis"
  | "invalid_next_step"
  | "invalid_micro_assessment"
  | "incompatible_micro_assessment";

export type TutoringProtocolFailure = {
  status: "failure";
  code: TutoringProtocolFailureCode;
  message: string;
};

export type TutoringProtocolFallback = {
  status: "fallback";
  response: TutoringProtocolResponse;
  fallbackReason: TutoringProtocolFailureCode;
};

export type TutoringProtocolSuccess = {
  status: "valid";
  response: TutoringProtocolResponse;
};

export type TutoringProtocolResult = TutoringProtocolSuccess | TutoringProtocolFallback | TutoringProtocolFailure;

export class TutoringProtocolError extends Error {
  readonly code: TutoringProtocolFailureCode;

  constructor(result: TutoringProtocolFailure) {
    super(result.message);
    this.name = "TutoringProtocolError";
    this.code = result.code;
  }
}

export const TUTORING_PROTOCOL_LIMITS = {
  content: 4_000,
  diagnosisSummary: 320,
  diagnosisRationale: 1_000,
  diagnosisEvidenceItems: 6,
  diagnosisEvidence: 240,
  nextStep: 320,
  questionPrompt: 500,
  option: 180,
  questionExplanation: 1_000,
  questions: 3,
  options: 4,
} as const;

/**
 * 结构化输出能力不足的连接会把这段说明追加到 system message；因此协议约束
 * 不能只依赖厂商的 JSON Schema，而必须在本地再次校验。
 */
export const TUTORING_PROTOCOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", enum: [TUTORING_PROTOCOL_VERSION] },
    kind: { type: "string", enum: [...TUTORING_PROTOCOL_KINDS] },
    content: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.content },
    diagnosis: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.diagnosisSummary },
        rationale: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.diagnosisRationale },
        evidence: {
          type: "array",
          maxItems: TUTORING_PROTOCOL_LIMITS.diagnosisEvidenceItems,
          items: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.diagnosisEvidence },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        source: { type: "string", enum: ["model_assisted", "deterministic"] },
      },
      required: ["summary", "rationale", "evidence", "confidence"],
    },
    nextStep: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.nextStep },
        question: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.nextStep },
      },
    },
    microAssessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: TUTORING_PROTOCOL_LIMITS.questions,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              prompt: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.questionPrompt },
              options: {
                type: "array",
                minItems: 3,
                maxItems: TUTORING_PROTOCOL_LIMITS.options,
                items: { type: "string", minLength: 1, maxLength: TUTORING_PROTOCOL_LIMITS.option },
              },
              correctOptionIndex: { type: "integer", minimum: 0, maximum: TUTORING_PROTOCOL_LIMITS.options - 1 },
              explanation: { type: "string", maxLength: TUTORING_PROTOCOL_LIMITS.questionExplanation },
            },
            required: ["prompt", "options", "correctOptionIndex", "explanation"],
          },
        },
      },
      required: ["questions"],
    },
  },
  required: ["version", "kind", "content"],
} as const;

/** 模型只负责可见教学内容和题目定义；完成状态与学习状态由应用写入。 */
export function buildTutoringProtocolInstructions(): string {
  return [
    `必须遵守 AI Tutor Protocol ${TUTORING_PROTOCOL_VERSION}。`,
    `kind 只能是：${TUTORING_PROTOCOL_KINDS.join("、")}。`,
    "只输出 JSON 对象，并且只能使用 version、kind、content、diagnosis、nextStep、microAssessment 及其约定的子字段；不要附加 Markdown、解释文本或未知字段。",
    "content 是学生可见的简洁讲解或练习指引；即使不提供结构化诊断，也必须让 content 独立有用。",
    "不要编造学生历史、未提供的资料或未观察到的画面。assessment questions 必须能根据提供的学习上下文回答。",
    "diagnosis 只表示辅导指导元数据，不是学习者掌握度、正确概率或 learner-state evidence；不要把 confidence 表达成 mastery 或 probability。",
    "不要输出 correctCount、completedAt、selections、mastery、masteryAfter、nextReviewAt、learnerState、recommendationScore 或任何评测完成/学习状态字段。",
    "microAssessment 只能包含 questions 定义；不要声称完成微测，不要替学生作答，也不要直接创建会话完成状态或复练计划。",
    "应用会把模型诊断标记为 model_assisted，并且只有用户提交后由确定性完成路径计算 correctCount。",
    "不要请求或输出 hidden chain-of-thought、私有思维过程或 thought signature；只给出可见、简洁、可核验的解释。",
  ].join("\n");
}

type UnknownRecord = Record<string, unknown>;

const PROTOCOL_KEYS = ["version", "kind", "content", "diagnosis", "nextStep", "microAssessment"] as const;
const DIAGNOSIS_KEYS = ["summary", "rationale", "evidence", "confidence", "source"] as const;
const NEXT_STEP_KEYS = ["action", "question"] as const;
const MICRO_ASSESSMENT_KEYS = ["questions"] as const;
const QUESTION_KEYS = ["id", "prompt", "options", "correctOptionIndex", "explanation"] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(record: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function isProtocolKind(value: unknown): value is TutoringProtocolKind {
  return typeof value === "string" && TUTORING_PROTOCOL_KINDS.some((kind) => kind === value);
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= limit ? text : null;
}

function boundedFallbackText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, TUTORING_PROTOCOL_LIMITS.content) : null;
}

function failure(code: TutoringProtocolFailureCode, message: string): TutoringProtocolFailure {
  return { status: "failure", code, message };
}

function isProtocolFailure(value: unknown): value is TutoringProtocolFailure {
  return isRecord(value) && value.status === "failure" && typeof value.code === "string" && typeof value.message === "string";
}

function normalizeDiagnosis(value: unknown): TutoringProtocolDiagnosis | TutoringProtocolFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, DIAGNOSIS_KEYS)) {
    return failure("invalid_diagnosis", "AI 辅导诊断字段无效");
  }
  const summary = boundedText(value.summary, TUTORING_PROTOCOL_LIMITS.diagnosisSummary);
  const rationale = boundedText(value.rationale, TUTORING_PROTOCOL_LIMITS.diagnosisRationale);
  const rawEvidence = value.evidence;
  const rawConfidence = value.confidence;
  if (!summary || !rationale || !Array.isArray(rawEvidence) || rawEvidence.length > TUTORING_PROTOCOL_LIMITS.diagnosisEvidenceItems) {
    return failure("invalid_diagnosis", "AI 辅导诊断摘要或依据无效");
  }
  const evidence: string[] = [];
  for (const item of rawEvidence) {
    const normalized = boundedText(item, TUTORING_PROTOCOL_LIMITS.diagnosisEvidence);
    if (!normalized) return failure("invalid_diagnosis", "AI 辅导诊断依据无效");
    evidence.push(normalized);
  }
  if (typeof rawConfidence !== "number" || !Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 1) {
    return failure("invalid_diagnosis", "AI 辅导诊断置信度无效");
  }
  if (value.source !== undefined && value.source !== "model_assisted" && value.source !== "deterministic") {
    return failure("invalid_diagnosis", "AI 辅导诊断来源无效");
  }
  return {
    confidence: rawConfidence,
    evidence,
    rationale,
    source: "model_assisted",
    summary,
  };
}

function normalizeNextStep(value: unknown): TutoringProtocolNextStep | TutoringProtocolFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, NEXT_STEP_KEYS)) {
    return failure("invalid_next_step", "AI 辅导下一步字段无效");
  }
  const action = value.action === undefined ? undefined : boundedText(value.action, TUTORING_PROTOCOL_LIMITS.nextStep);
  const question = value.question === undefined ? undefined : boundedText(value.question, TUTORING_PROTOCOL_LIMITS.nextStep);
  if ((value.action !== undefined && !action) || (value.question !== undefined && !question) || (!action && !question)) {
    return failure("invalid_next_step", "AI 辅导下一步不能为空");
  }
  return { ...(action ? { action } : {}), ...(question ? { question } : {}) };
}

function normalizeQuestion(value: unknown, index: number): TutoringMicroQuestion | TutoringProtocolFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, QUESTION_KEYS)) {
    return failure("invalid_micro_assessment", "AI 辅导微测题目字段无效");
  }
  const prompt = boundedText(value.prompt, TUTORING_PROTOCOL_LIMITS.questionPrompt);
  const rawOptions = value.options;
  const rawCorrectOptionIndex = value.correctOptionIndex;
  const explanation = boundedText(value.explanation, TUTORING_PROTOCOL_LIMITS.questionExplanation);
  if (!prompt || !Array.isArray(rawOptions) || rawOptions.length < 3 || rawOptions.length > TUTORING_PROTOCOL_LIMITS.options || !explanation) {
    return failure("invalid_micro_assessment", "AI 辅导微测题目不完整");
  }
  const options: string[] = [];
  for (const option of rawOptions) {
    const normalized = boundedText(option, TUTORING_PROTOCOL_LIMITS.option);
    if (!normalized) return failure("invalid_micro_assessment", "AI 辅导微测选项无效");
    options.push(normalized);
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    return failure("invalid_micro_assessment", "AI 辅导微测选项不能重复");
  }
  if (typeof rawCorrectOptionIndex !== "number" || !Number.isInteger(rawCorrectOptionIndex) || rawCorrectOptionIndex < 0 || rawCorrectOptionIndex >= options.length) {
    return failure("invalid_micro_assessment", "AI 辅导微测正确选项无效");
  }
  return {
    correctOptionIndex: rawCorrectOptionIndex,
    explanation,
    id: `micro-${index + 1}`,
    options,
    prompt,
  };
}

function normalizeMicroAssessment(value: unknown): TutoringGeneratedMicroAssessment | TutoringProtocolFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, MICRO_ASSESSMENT_KEYS) || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > TUTORING_PROTOCOL_LIMITS.questions) {
    return failure("invalid_micro_assessment", "AI 辅导微测结构无效");
  }
  const questions: TutoringMicroQuestion[] = [];
  for (const [index, question] of value.questions.entries()) {
    const normalized = normalizeQuestion(question, index);
    if (isProtocolFailure(normalized)) return normalized;
    questions.push(normalized);
  }
  return { questions };
}

function recoverVisibleContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return boundedFallbackText(value.content) ?? boundedFallbackText(value.teacherMessage);
}

function fallback(content: string, fallbackReason: TutoringProtocolFailureCode): TutoringProtocolFallback {
  return {
    fallbackReason,
    response: {
      content,
      kind: "explanation",
      version: TUTORING_PROTOCOL_VERSION,
    },
    status: "fallback",
  };
}

/** 对已解析的 unknown 做严格校验；不提供可见文本 fallback。 */
export function normalizeTutoringProtocolResponse(value: unknown): TutoringProtocolResult {
  if (!isRecord(value)) return failure("invalid_shape", "AI 辅导协议响应不是对象");
  if (!hasOnlyKeys(value, PROTOCOL_KEYS)) return failure("disallowed_field", "AI 辅导协议包含未允许字段");
  if (value.version !== TUTORING_PROTOCOL_VERSION) return failure("unknown_version", "AI 辅导协议版本不受支持");
  if (!isProtocolKind(value.kind)) return failure("unknown_kind", "AI 辅导协议 kind 不受支持");
  const content = boundedText(value.content, TUTORING_PROTOCOL_LIMITS.content);
  if (!content) return failure(typeof value.content === "string" && value.content.trim() ? "content_too_long" : "empty_content", "AI 辅导可见内容为空或超出长度限制");

  let diagnosis: TutoringProtocolDiagnosis | undefined;
  if (value.diagnosis !== undefined) {
    const normalized = normalizeDiagnosis(value.diagnosis);
    if (isProtocolFailure(normalized)) return normalized;
    diagnosis = normalized;
  }
  if (value.kind === "diagnosis" && !diagnosis) return failure("invalid_diagnosis", "diagnosis kind 必须提供诊断字段");
  if (value.kind !== "diagnosis" && diagnosis) return failure("incompatible_diagnosis", "当前 kind 不允许 diagnosis 字段");

  let nextStep: TutoringProtocolNextStep | undefined;
  if (value.nextStep !== undefined) {
    const normalized = normalizeNextStep(value.nextStep);
    if (isProtocolFailure(normalized)) return normalized;
    nextStep = normalized;
  }
  if (value.kind === "summary" && nextStep) return failure("invalid_next_step", "summary kind 不允许 nextStep 字段");

  let microAssessment: TutoringGeneratedMicroAssessment | undefined;
  if (value.microAssessment !== undefined) {
    const normalized = normalizeMicroAssessment(value.microAssessment);
    if (isProtocolFailure(normalized)) return normalized;
    microAssessment = normalized;
  }
  if (value.kind === "micro_assessment" && !microAssessment) return failure("invalid_micro_assessment", "micro_assessment kind 必须提供题目");
  if (value.kind !== "micro_assessment" && microAssessment) return failure("incompatible_micro_assessment", "当前 kind 不允许 microAssessment 字段");

  return {
    response: {
      ...(diagnosis ? { diagnosis } : {}),
      ...(microAssessment ? { microAssessment } : {}),
      ...(nextStep ? { nextStep } : {}),
      content,
      kind: value.kind,
      version: TUTORING_PROTOCOL_VERSION,
    },
    status: "valid",
  };
}

/** 解析模型原文；结构化字段失败时只保留明确可见文本，不保留任何证据状态。 */
export function parseTutoringProtocolResponse(content: string): TutoringProtocolResult {
  let parsed: unknown;
  try {
    parsed = parseAiJsonValue<unknown>(content, "object", "AI Tutor Protocol 响应不是有效 JSON 对象");
  } catch {
    const visibleContent = boundedFallbackText(content);
    return visibleContent && !/^[\[{]/.test(visibleContent) ? fallback(visibleContent, "malformed_json") : failure("malformed_json", "AI Tutor Protocol 响应不是有效 JSON 对象");
  }
  const normalized = normalizeTutoringProtocolResponse(parsed);
  if (normalized.status === "valid" || normalized.status === "fallback") return normalized;
  const visibleContent = recoverVisibleContent(parsed);
  return visibleContent ? fallback(visibleContent, normalized.code) : normalized;
}
