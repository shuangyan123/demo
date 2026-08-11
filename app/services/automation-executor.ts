import type { AcquisitionModelRef, AcquisitionRunSummary } from "../types/domains/acquisition.ts";
import type { ApiConnectionProfile, AiConnectionSnapshot } from "../types/domains/ai-connection.ts";
import type { AutomationContextSummary, AutomationDefinition, AutomationExternalExecutionSummary, AutomationSourceScope, AutomationTemplateId } from "../types/domains/automation.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";
import { generateWithConnection } from "./ai-connection-client.ts";
import { buildAutomationContextPreview, buildAutomationContextResult, type AutomationContextPreview } from "./automation-context-service.ts";
import { requestKnowledgeEvolutionProposals } from "./knowledge-evolution-service.ts";
import { obsidianKnowledgeRepository, type KnowledgeEvolutionSource } from "./obsidian-knowledge-repository.ts";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository.ts";
import { buildPersonalMemoryContext } from "./personal-memory-context.ts";
import { reviewDb } from "../db/review-db.ts";
import { acquireCollectionDocuments, previewCollectionConfig } from "./acquisition-source-service.ts";
import { requestAcquisitionProposals } from "./acquisition-proposal-service.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { isUiReviewRecordId } from "./workspace-data-scope.ts";
import { isUiReviewRuntimeActive } from "./ui-review-runtime-guard.ts";
import { mergeAutomationExternalExecution, wrapAutomationExecutionProgress } from "./automation-errors.ts";

export const AUTOMATION_TEMPLATES: Array<{ id: AutomationTemplateId; name: string; description: string; prompt: string; scopes: AutomationSourceScope[]; collectionDomain?: "xingce" | "shenlun" | "interview" }> = [
  { id: "daily_review", name: "每日复盘简报", description: "汇总到期错题、薄弱知识和今天最值得处理的三件事。", prompt: "生成今天的复盘简报：先列优先级，再给出不超过三项可执行任务，最后提醒一个最容易重复犯错的模式。", scopes: ["mistakes", "knowledge"] },
  { id: "knowledge_evolution", name: "知识演进候选", description: "从长期训练记录生成待确认的新增、合并或建链提案。", prompt: "从新增训练记录中生成知识演进提案。", scopes: ["mistakes", "knowledge", "interview", "tutoring"] },
  { id: "weekly_progress", name: "每周训练总结", description: "归纳面试和辅导中的进步、反复问题与下周行动。", prompt: "生成本周面试与辅导总结：区分进步、反复问题、证据和下周三项行动，不要虚构没有出现的数据。", scopes: ["interview", "tutoring", "knowledge"] },
  { id: "custom", name: "自定义任务", description: "使用自定义提示词分析明确选择的本地数据。", prompt: "", scopes: [] },
  { id: "xingce_collection", name: "行测采集", description: "从白名单来源整理题型方法、答案依据和常见陷阱。", prompt: "整理行测方法与证据。", scopes: [], collectionDomain: "xingce" },
  { id: "shenlun_collection", name: "申论采集", description: "从官方资料整理政策原文、主题素材和论证结构。", prompt: "整理申论政策素材与论证结构。", scopes: [], collectionDomain: "shenlun" },
  { id: "interview_collection", name: "面试采集", description: "区分热点事实、观点材料和可复用作答框架。", prompt: "整理面试热点事实与作答框架。", scopes: [], collectionDomain: "interview" },
];

export type AutomationExecutionResult = {
  result: string;
  proposalIds: string[];
  contextSummary: AutomationContextSummary[];
  contextCharCount: number;
  collectionSummary?: AcquisitionRunSummary;
  externalExecution?: AutomationExternalExecutionSummary;
};

function aiExecutionSummary(callCount = 1): AutomationExternalExecutionSummary {
  return { sourceKinds: callCount ? ["ai"] : [], mcpTools: [], httpOrigins: [], externalCallCount: callCount, successfulCallCount: callCount, failedCallCount: 0 };
}

/** 预览只返回摘要和字符数，不把完整上下文交给 UI。 */
export async function previewAutomationDefinition(input: { sourceScopes: AutomationSourceScope[]; collectionConfig?: AutomationDefinition["collectionConfig"] }): Promise<AutomationContextPreview> {
  if (input.collectionConfig) {
    previewCollectionConfig(input.collectionConfig);
    return { summary: [], contextCharCount: 0 };
  }
  return buildAutomationContextPreview(input.sourceScopes);
}

/** 试运行允许调用模型，但禁止写入运行记录、调度状态或知识演进提案。 */
export async function trialAutomationDefinition(input: {
  definition: AutomationDefinition;
  connection?: ApiConnectionProfile;
  aiSnapshot?: AiConnectionSnapshot;
  personalization: PersonalizationSettings;
}): Promise<AutomationExecutionResult> {
  return executeAutomation({ ...input, persistProposals: false });
}

/** 执行只读已安排任务；除保存待确认提案外，不更新任何业务数据。 */
export async function executeAutomation(input: {
  definition: AutomationDefinition;
  connection?: ApiConnectionProfile;
  aiSnapshot?: AiConnectionSnapshot;
  personalization: PersonalizationSettings;
  persistProposals?: boolean;
}): Promise<AutomationExecutionResult> {
  if (isUiReviewRuntimeActive() || isUiReviewRecordId(input.definition.id)) {
    throw new Error("UI 审查任务只用于检查界面，不会执行外部调用");
  }
  const [{ assertAutomationExternalAuthorization, collectMcpAuthorizationResources, resolveAutomationExternalAuthorization }, { mcpSettingsRepository }] = await Promise.all([
    import("./automation-external-authorization.ts"),
    import("./mcp-settings-repository.ts"),
  ]);
  assertAutomationExternalAuthorization(resolveAutomationExternalAuthorization(input.definition, {
    mcpResources: collectMcpAuthorizationResources(mcpSettingsRepository.load()),
  }));
  if (input.definition.collectionConfig) {
    const config = input.definition.collectionConfig;
    const snapshot = input.aiSnapshot;
    const findSelection = async (ref?: AcquisitionModelRef, fallback = false) => {
      const connection = ref
        ? snapshot?.profiles.find((profile) => profile.id === ref.connectionId)
        : fallback ? input.connection : undefined;
      if (!connection) return undefined;
      const requestedModel = ref?.modelId || snapshot?.defaults.textModelId;
      const modelId = await aiConnectionsRepository.resolveRuntimeModel(connection, "text", requestedModel);
      return { connection, ref: { connectionId: connection.id, modelId, selectedRuntimeValues: ref?.selectedRuntimeValues } };
    };
    const curator = await findSelection(config.curator, true);
    if (!curator) throw new Error("请为采集任务配置整理模型或默认文本连接");
    const reviewer = config.reviewer ? await findSelection(config.reviewer) : undefined;
    if (config.reviewer && !reviewer) throw new Error("复核模型连接不存在或已被删除");
    if (reviewer && reviewer.ref.connectionId === curator.ref.connectionId && reviewer.ref.modelId === curator.ref.modelId) throw new Error("复核模型必须与整理模型不同");
    let externalExecution: AutomationExternalExecutionSummary | undefined;
    try {
      const acquisition = await acquireCollectionDocuments(config);
      externalExecution = acquisition.externalExecution;
      const existingProposals = await obsidianKnowledgeRepository.listProposals();
      const proposals = await requestAcquisitionProposals({ config, documents: acquisition.documents, curator, reviewer, existingProposals });
      if (input.persistProposals !== false && proposals.length) await obsidianKnowledgeRepository.saveProposals(proposals);
      const collectionSummary: AcquisitionRunSummary = {
        discoveredCount: acquisition.discoveredCount,
        fetchedCount: acquisition.fetchedCount,
        duplicateCount: acquisition.duplicateCount,
        gradeA: proposals.filter((item) => item.provenance?.trust.grade === "A").length,
        gradeB: proposals.filter((item) => item.provenance?.trust.grade === "B").length,
        gradeC: proposals.filter((item) => item.provenance?.trust.grade === "C").length,
        disputedCount: proposals.filter((item) => item.provenance?.reviewStatus === "disputed").length,
        reviewStatus: reviewer ? proposals.some((item) => item.provenance?.reviewStatus === "disputed") ? "disputed" : "agreed" : "not_configured",
      };
      return {
        result: proposals.length
          ? `${input.persistProposals === false ? "试运行整理出" : "已生成"} ${proposals.length} 条外部知识提案，确认前不会写入知识库或 Vault。`
          : `本次发现 ${acquisition.discoveredCount} 个候选来源，未生成可用提案。${acquisition.diagnostics[0] ? ` ${acquisition.diagnostics[0]}` : ""}`,
        proposalIds: proposals.map((item) => item.id),
        contextSummary: [],
        contextCharCount: 0,
        collectionSummary,
        externalExecution: mergeAutomationExternalExecution(externalExecution, aiExecutionSummary(acquisition.documents.length ? reviewer ? 2 : 1 : 0)),
      };
    } catch (error) {
      throw wrapAutomationExecutionProgress(error, externalExecution);
    }
  }
  const contextResult = await buildAutomationContextResult(input.definition.sourceScopes);
  if (!input.connection) throw new Error("请先配置默认文本连接，再运行已安排任务");

  if (input.definition.templateId === "knowledge_evolution") {
    const allowed = new Set(input.definition.sourceScopes);
    const evolutionScopes: KnowledgeEvolutionSource["type"][] = [
      ...(allowed.has("mistakes") ? ["mistake" as const] : []),
      ...(allowed.has("knowledge") ? ["knowledge" as const] : []),
      ...(allowed.has("interview") ? ["interview" as const] : []),
      ...(allowed.has("tutoring") ? ["tutoring" as const] : []),
    ];
    const [sources, entries] = await Promise.all([
      obsidianKnowledgeRepository.loadEvolutionSources(12, evolutionScopes),
      allowed.has("knowledge") ? reviewDb.knowledgeEntries.toArray() : Promise.resolve([]),
    ]);
    const generation = await requestKnowledgeEvolutionProposals({ connection: input.connection, personalization: input.personalization, sources, entries });
    const proposals = generation.proposals;
    if (input.persistProposals !== false) await obsidianKnowledgeRepository.saveProposals(proposals);
    return {
      result: proposals.length
        ? `${input.persistProposals === false ? "试运行生成" : "已生成"} ${proposals.length} 条知识演进提案。确认前不会修改知识库或 Vault。`
        : "本次没有发现值得新增、合并或建链的知识候选。",
      proposalIds: proposals.map((item) => item.id),
      contextSummary: contextResult.summary,
      contextCharCount: contextResult.contextCharCount,
      externalExecution: aiExecutionSummary(),
    };
  }

  const persona = resolvePersona(input.personalization, "knowledge_internalization");
  const prompt = input.definition.prompt.trim() || AUTOMATION_TEMPLATES.find((item) => item.id === input.definition.templateId)?.prompt || "总结当前训练状态并给出下一步建议。";
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 2200,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "你正在执行一个本地已安排学习任务。只分析提供的只读上下文，不得声称已经修改知识库、训练计划、文件或 Obsidian。",
          "输出简洁的 Markdown。证据不足时明确说明，不得编造数据。涉及新增、合并、建链或删除时，只能写成待用户确认的建议。",
          buildPersonaPrompt(persona),
          buildPersonalMemoryContext(input.personalization, { moduleId: "automation" }),
        ].join("\n\n"),
      },
      { role: "user", content: JSON.stringify({ task: prompt, context: contextResult.context }) },
    ],
  });
  return {
    result: response.content.trim(),
    proposalIds: [],
    contextSummary: contextResult.summary,
    contextCharCount: contextResult.contextCharCount,
    externalExecution: aiExecutionSummary(),
  };
}
