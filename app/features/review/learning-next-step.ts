import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";

export type LearningNextStep = {
  label: string;
  summary: string;
  destination: LearningActionRecommendation["destination"]["module"] | "dashboard" | "automation";
  targetId?: string;
};

/** 保持 learner-state 原始顺序，只把有证据且可到达的推荐映射为按钮，不重新评分。 */
export function resolveLearningNextSteps(input: {
  recommendations: LearningActionRecommendation[];
  mistakeIds: string[];
  knowledgeIds: string[];
  hasScheduledWork: boolean;
}): LearningNextStep[] {
  const actions: LearningNextStep[] = [];
  const destinations = new Set<string>();
  for (const recommendation of input.recommendations) {
    if (recommendation.state !== "ready" || !recommendation.evidence.length) continue;
    const destination = recommendation.destination.module;
    if (destinations.has(destination)) continue;
    const ids = recommendation.destination.targetIds ?? [];
    const available = destination === "knowledgeTraining" ? input.knowledgeIds : input.mistakeIds;
    const targetId = ids.find((id) => available.includes(id));
    if (["review", "library", "knowledgeTraining"].includes(destination) && !targetId) continue;
    actions.push({ label: recommendation.title, summary: recommendation.summary, destination, targetId });
    destinations.add(destination);
    if (actions.length === 2) break;
  }
  if (!actions.length) actions.push({ label: "返回总览", summary: "本轮记录已保存，可回到总览查看学习进度。", destination: "dashboard" });
  if (input.hasScheduledWork) actions.push({ label: "查看已安排", summary: "", destination: "automation" });
  return actions;
}

/** 薄弱项按钮仅使用现有推荐明确提供的目标；无目标证据时保留分析，不猜测跳转。 */
export function canContinueWeakness(recommendations: LearningActionRecommendation[], kind: "mistake" | "knowledge", id: string): boolean {
  return recommendations.some((item) => item.state === "ready" && item.evidence.length > 0
    && (kind === "knowledge" ? item.destination.module === "knowledgeTraining" : ["review", "library"].includes(item.destination.module))
    && item.destination.targetIds?.includes(id));
}
