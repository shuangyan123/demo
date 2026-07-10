export type AiActivityEventDetail = {
  phase: "started" | "waiting" | "delta" | "usage" | "done" | "error";
  label: string;
  runId?: string;
  conversationId?: string;
  threadTitle?: string;
  projectId?: string;
  studyDomainId?: string;
  module?: string;
  purpose?: string;
  stepId?: string;
  state?: "pending" | "running" | "done" | "error";
  connectionLabel?: string;
  model?: string;
  attachments?: Array<{ id: string; label: string; kind: "image" | "file" | "vault" | "context" }>;
  toolDisplayMode?: "inline" | "drawer";
  text?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export type AiActivityStep = {
  id: string;
  label: string;
  state: "pending" | "running" | "done" | "error";
  text?: string;
  updatedAt: string;
};

export type AiActivityRun = {
  id: string;
  label: string;
  conversationId?: string;
  threadTitle?: string;
  projectId?: string;
  studyDomainId?: string;
  module?: string;
  purpose?: string;
  connectionLabel?: string;
  model?: string;
  attachments: Array<{ id: string; label: string; kind: "image" | "file" | "vault" | "context" }>;
  toolDisplayMode: "inline" | "drawer";
  phase: AiActivityEventDetail["phase"];
  state: "running" | "done" | "error";
  streamText: string;
  steps: AiActivityStep[];
  usage?: AiActivityEventDetail["usage"];
  error?: string;
  startedAt: string;
  updatedAt: string;
};

const EVENT_NAME = "review-workspace-ai-activity";

const phaseStepLabels: Record<AiActivityEventDetail["phase"], string> = {
  started: "准备上下文",
  waiting: "调用模型",
  delta: "流式输出",
  usage: "记录用量",
  done: "完成",
  error: "错误",
};

const toolStepLabels: Record<string, string> = {
  context: "准备上下文",
  prepare: "准备上下文",
  connection: "选择连接",
  request: "调用模型",
  stream: "流式输出",
  parse: "解析结果",
  proposal: "解析结果",
  save: "保存记录",
  saved: "保存记录",
  usage: "记录用量",
  done: "完成",
  empty: "错误",
  error: "错误",
};

function defaultStepId(event: AiActivityEventDetail): string {
  if (event.stepId) return event.stepId;
  if (event.phase === "started") return "prepare";
  if (event.phase === "waiting") return "request";
  if (event.phase === "delta") return "stream";
  if (event.phase === "usage") return "usage";
  return event.phase;
}

function stepState(event: AiActivityEventDetail): AiActivityStep["state"] {
  if (event.state) return event.state;
  if (event.phase === "done") return "done";
  if (event.phase === "error") return "error";
  return "running";
}

export function reduceAiActivityRuns(
  runs: AiActivityRun[],
  event: AiActivityEventDetail,
  now = new Date().toISOString(),
): AiActivityRun[] {
  const id = event.runId ?? event.label;
  const existing = runs.find((run) => run.id === id);
  const stepId = defaultStepId(event);
  const nextStep: AiActivityStep = {
    id: stepId,
    label: toolStepLabels[stepId] ?? phaseStepLabels[event.phase],
    state: stepState(event),
    text: event.text,
    updatedAt: now,
  };
  const base: AiActivityRun = existing ?? {
    id,
    label: event.label,
    conversationId: event.conversationId,
    threadTitle: event.threadTitle,
    projectId: event.projectId,
    studyDomainId: event.studyDomainId,
    module: event.module,
    purpose: event.purpose,
    connectionLabel: event.connectionLabel,
    model: event.model,
    attachments: event.attachments ?? [],
    toolDisplayMode: event.toolDisplayMode ?? "drawer",
    phase: event.phase,
    state: "running",
    streamText: "",
    steps: [],
    startedAt: now,
    updatedAt: now,
  };
  const steps = [...base.steps.filter((step) => step.id !== stepId), nextStep];
  const streamText = event.phase === "delta" && event.text ? `${base.streamText}${event.text}` : base.streamText;
  const nextRun: AiActivityRun = {
    ...base,
    label: event.label || base.label,
    conversationId: event.conversationId ?? base.conversationId,
    threadTitle: event.threadTitle ?? base.threadTitle,
    projectId: event.projectId ?? base.projectId,
    studyDomainId: event.studyDomainId ?? base.studyDomainId,
    module: event.module ?? base.module,
    purpose: event.purpose ?? base.purpose,
    connectionLabel: event.connectionLabel ?? base.connectionLabel,
    model: event.model ?? base.model,
    attachments: event.attachments ?? base.attachments,
    toolDisplayMode: event.toolDisplayMode ?? base.toolDisplayMode,
    phase: event.phase,
    state: event.phase === "error" ? "error" : event.phase === "done" ? "done" : "running",
    streamText,
    steps,
    usage: event.usage ?? base.usage,
    error: event.phase === "error" ? event.text : base.error,
    updatedAt: now,
  };
  return [nextRun, ...runs.filter((run) => run.id !== id)].slice(0, 8);
}

export function emitAiActivity(detail: AiActivityEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AiActivityEventDetail>(EVENT_NAME, { detail }));
}

export function subscribeAiActivity(listener: (detail: AiActivityEventDetail) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<AiActivityEventDetail>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
