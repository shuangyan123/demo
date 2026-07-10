import type {
  ApiConnectionProfile,
  AutomationContextSummary,
  AutomationDefinition,
  AutomationSourceScope,
  AutomationTemplateId,
  PersonalizationSettings,
} from "../types/review.ts";
import { generateWithConnection } from "./ai-connection-client.ts";
import { buildAutomationContextPreview, buildAutomationContextResult, type AutomationContextPreview } from "./automation-context-service.ts";
import { requestKnowledgeEvolutionProposals } from "./knowledge-evolution-service.ts";
import { obsidianKnowledgeRepository, type KnowledgeEvolutionSource } from "./obsidian-knowledge-repository.ts";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository.ts";
import { reviewDb } from "../db/review-db.ts";

export const AUTOMATION_TEMPLATES: Array<{ id: AutomationTemplateId; name: string; description: string; prompt: string; scopes: AutomationSourceScope[] }> = [
  { id: "daily_review", name: "每日复盘简报", description: "汇总到期错题、薄弱知识和今天最值得处理的三件事。", prompt: "生成今天的复盘简报：先列优先级，再给出不超过三项可执行任务，最后提醒一个最容易重复犯错的模式。", scopes: ["mistakes", "knowledge"] },
  { id: "knowledge_evolution", name: "知识演进候选", description: "从长期训练记录生成待确认的新增、合并或建链提案。", prompt: "从新增训练记录中生成知识演进提案。", scopes: ["mistakes", "knowledge", "interview", "tutoring"] },
  { id: "weekly_progress", name: "每周训练总结", description: "归纳面试和辅导中的进步、反复问题与下周行动。", prompt: "生成本周面试与辅导总结：区分进步、反复问题、证据和下周三项行动，不要虚构没有出现的数据。", scopes: ["interview", "tutoring", "knowledge"] },
  { id: "custom", name: "自定义任务", description: "使用自定义提示词分析明确选择的本地数据。", prompt: "", scopes: [] },
];

export type AutomationExecutionResult = {
  result: string;
  proposalIds: string[];
  contextSummary: AutomationContextSummary[];
  contextCharCount: number;
};

/** 预览只返回摘要和字符数，不把完整上下文交给 UI。 */
export async function previewAutomationDefinition(input: { sourceScopes: AutomationSourceScope[] }): Promise<AutomationContextPreview> {
  return buildAutomationContextPreview(input.sourceScopes);
}

/** 试运行允许调用模型，但禁止写入运行记录、调度状态或知识演进提案。 */
export async function trialAutomationDefinition(input: {
  definition: AutomationDefinition;
  connection?: ApiConnectionProfile;
  personalization: PersonalizationSettings;
}): Promise<AutomationExecutionResult> {
  return executeAutomation({ ...input, persistProposals: false });
}

/** 执行只读已安排任务；除保存待确认提案外，不更新任何业务数据。 */
export async function executeAutomation(input: {
  definition: AutomationDefinition;
  connection?: ApiConnectionProfile;
  personalization: PersonalizationSettings;
  persistProposals?: boolean;
}): Promise<AutomationExecutionResult> {
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
  };
}
