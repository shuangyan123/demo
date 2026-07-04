import type { InterviewScoreDimension, InterviewType } from "../types/review";

export type InterviewRubric = {
  type: InterviewType;
  label: string;
  description: string;
  dimensions: Array<{ name: string; maxScore: number; focus: string }>;
};

export const interviewTypeLabels: Record<InterviewType, string> = {
  structured: "结构化面试",
  structured_group: "结构化小组讨论",
  leaderless_group: "无领导小组讨论",
};

// 三类面试的内置评分表，供 UI 展示和 AI 评分提示词共用，避免两边标准漂移。
export const interviewRubrics: Record<InterviewType, InterviewRubric> = {
  structured: {
    type: "structured",
    label: interviewTypeLabels.structured,
    description: "围绕公务员录用结构化面试常见测评要素，按 5 项各 20 分计入总分。",
    dimensions: [
      { name: "综合分析能力", maxScore: 20, focus: "观点明确、逻辑清晰、分析全面辩证，能结合公共治理语境展开。" },
      { name: "工作适应综合能力", maxScore: 20, focus: "理解岗位职责、能提出可执行方案，体现规则意识和服务意识。" },
      { name: "岗位匹配性", maxScore: 20, focus: "动机稳定、价值观匹配、能结合自身经历说明胜任力。" },
      { name: "应变与自控能力", maxScore: 20, focus: "面对压力、突发矛盾或追问时能保持稳定并有效处理。" },
      { name: "语言表达与仪表举止", maxScore: 20, focus: "表达流畅、层次清楚、措辞得体，体现良好的面试呈现。" },
    ],
  },
  structured_group: {
    type: "structured_group",
    label: interviewTypeLabels.structured_group,
    description: "在结构化五维基础上，额外关注点评、回应和互动礼仪。",
    dimensions: [
      { name: "个人作答质量", maxScore: 25, focus: "个人观点、分析层次、对题干核心矛盾的把握。" },
      { name: "点评质量", maxScore: 20, focus: "能找准他人问题，点评具体、谦逊、有逻辑。" },
      { name: "回应质量", maxScore: 20, focus: "回应他人点评时有理有据，能补充修正而不失分寸。" },
      { name: "互动礼仪", maxScore: 15, focus: "尊重他人、表达克制、团队互动自然。" },
      { name: "表达与控场", maxScore: 20, focus: "语言清楚，时间控制得当，能体现稳定心态。" },
    ],
  },
  leaderless_group: {
    type: "leaderless_group",
    label: interviewTypeLabels.leaderless_group,
    description: "适配个人陈述、自由讨论和总结陈词三个阶段，关注团队推进能力。",
    dimensions: [
      { name: "内容质量", maxScore: 25, focus: "问题认知有高度，观点主流，能概括并吸收他人观点。" },
      { name: "人际交往意识与技巧", maxScore: 20, focus: "倾听尊重、协调分歧、推动共识形成。" },
      { name: "计划组织协调能力", maxScore: 20, focus: "能把控讨论目标、节奏和任务分工。" },
      { name: "团队推进贡献", maxScore: 20, focus: "能引导讨论、补充关键遗漏、推动形成结论。" },
      { name: "表达仪态", maxScore: 15, focus: "表达清楚、语气稳健、总结有条理。" },
    ],
  },
};

// 创建默认评分结果骨架，AI 失败或 UI 初始化时可用它保持结构稳定。
export function buildEmptyInterviewDimensions(type: InterviewType): InterviewScoreDimension[] {
  return interviewRubrics[type].dimensions.map((dimension) => ({
    name: dimension.name,
    score: 0,
    maxScore: dimension.maxScore,
    comment: "待评分",
  }));
}
