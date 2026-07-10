"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { generateWithConnection, generateWithConnectionStream } from "../../services/ai-connection-client.ts";
import { emitAiActivity } from "../../services/ai-activity-events.ts";
import { summarizeConversationRunSteps, type ConversationToolRunSummary } from "../../services/conversation-tool-summary.ts";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository.ts";
import type { AiConversation, AiConversationMessage, ApiConnectionProfile } from "../../types/review";
import { Button, Chip, cx } from "../shared/ui-primitives";

type ConversationWorkspaceProps = {
  activeConversationId?: string | null;
  snapshot: ConversationSnapshot;
  textConnection?: ApiConnectionProfile;
  onCreateConversation: () => Promise<AiConversation>;
  onConversationSelected: (id: string) => void;
  onOpenConnections: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
};

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function toChatHistory(messages: AiConversationMessage[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
}

function ToolStateDot({ state }: { state: "pending" | "running" | "done" | "error" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "mt-1 h-2.5 w-2.5 rounded-full",
        state === "done" && "bg-green",
        state === "running" && "bg-blue",
        state === "error" && "bg-red",
        state === "pending" && "bg-muted/40",
      )}
    />
  );
}

function ConversationToolSummary({ summary }: { summary: ConversationToolRunSummary }) {
  return (
    <details className={cx("conversation-tool-summary", summary.state === "error" && "is-error", summary.state === "running" && "is-running")}>
      <summary>
        <span aria-hidden="true" className="conversation-tool-summary-icon">⌘</span>
        <span>{summary.label}</span>
      </summary>
      <ol>
        {summary.steps.map((step) => (
          <li key={step.id}>
            <ToolStateDot state={step.state} />
            <span className="min-w-0">
              <strong>{step.label}</strong>
              {step.text ? <small>{step.text}</small> : null}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ConversationWorkspace({
  activeConversationId,
  snapshot,
  textConnection,
  onCreateConversation,
  onConversationSelected,
  onOpenConnections,
  onRefresh,
  onNotice,
}: ConversationWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const conversations = useMemo(
    () => snapshot.conversations.filter((conversation) => conversation.status === "active"),
    [snapshot.conversations],
  );
  const activeConversation = activeConversationId === null ? null : conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null;
  const messages = useMemo(
    () => snapshot.messages.filter((message) => message.conversationId === activeConversation?.id),
    [activeConversation?.id, snapshot.messages],
  );
  const runSteps = useMemo(
    () => snapshot.runSteps.filter((step) => step.conversationId === activeConversation?.id).slice(-16),
    [activeConversation?.id, snapshot.runSteps],
  );
  const runSummaries = useMemo(() => summarizeConversationRunSteps(runSteps), [runSteps]);
  const latestRunSummary = runSummaries.at(-1);

  useEffect(() => {
    if (activeConversationId === undefined && activeConversation?.id) onConversationSelected(activeConversation.id);
  }, [activeConversation?.id, activeConversationId, onConversationSelected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [assistantDraft, messages.length]);

  async function appendStep(conversationId: string, runId: string, label: string, state: "pending" | "running" | "done" | "error", text?: string) {
    await conversationRepository.appendRunStep({ conversationId, runId, label, state, text });
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setDraft("");
    setAssistantDraft("");
    setBusy(true);
    const conversation = activeConversation ?? await onCreateConversation();
    onConversationSelected(conversation.id);
    const runId = crypto.randomUUID();
    try {
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content });
      await appendStep(conversation.id, runId, "准备上下文", "done", "已读取当前会话和公考项目摘要");
      await appendStep(conversation.id, runId, "选择连接", textConnection ? "done" : "error", textConnection ? `${textConnection.label} / ${textConnection.model}` : "缺少默认文本连接");
      emitAiActivity({
        runId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        studyDomainId: conversation.studyDomainId,
        phase: "started",
        label: textConnection ? `${textConnection.provider} · ${textConnection.model}` : "缺少默认文本连接",
        module: "新对话",
        purpose: conversation.kind,
        stepId: "context",
        text: "准备公考项目会话上下文",
        toolDisplayMode: "inline",
      });
      await onRefresh();
      if (!textConnection) {
        const reply = "这条消息已保存。请先在设置的 AI 连接里配置默认文本连接，然后我就能继续回答。";
        await conversationRepository.appendMessage({ conversationId: conversation.id, role: "assistant", content: reply });
        await appendStep(conversation.id, runId, "完成/错误", "error", "缺少默认文本连接");
        emitAiActivity({ runId, conversationId: conversation.id, phase: "error", label: "缺少默认文本连接", stepId: "error", text: "请配置默认文本连接" });
        await onRefresh();
        onNotice("请先配置默认文本连接");
        return;
      }

      await appendStep(conversation.id, runId, "调用模型", "running", "请求已发送");
      const history = [...toChatHistory(messages), { role: "user" as const, content }];
      let finalContent = "";
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      if (textConnection.capabilities.includes("streaming")) {
        await appendStep(conversation.id, runId, "流式输出", "running", "正在接收片段");
        for await (const event of generateWithConnectionStream(textConnection, "text", {
          messages: history,
          maxOutputTokens: 1200,
          activity: {
            runId,
            module: "新对话",
            purpose: conversation.kind,
            connectionLabel: textConnection.label,
            conversationId: conversation.id,
            projectId: conversation.projectId,
            studyDomainId: conversation.studyDomainId,
          },
        })) {
          if (event.type === "delta") {
            finalContent += event.text;
            setAssistantDraft(finalContent);
          }
          if (event.type === "done") {
            finalContent = event.content || finalContent;
            usage = event.usage ?? usage;
          }
          if (event.type === "usage") usage = event.usage ?? usage;
          if (event.type === "error") throw new Error(event.message);
        }
      } else {
        const result = await generateWithConnection(textConnection, "text", {
          messages: history,
          maxOutputTokens: 1200,
          activity: {
            runId,
            module: "新对话",
            purpose: conversation.kind,
            connectionLabel: textConnection.label,
            conversationId: conversation.id,
            projectId: conversation.projectId,
            studyDomainId: conversation.studyDomainId,
          },
        });
        finalContent = result.content;
        usage = result.usage;
      }
      const contentToSave = finalContent.trim() || "模型没有返回文本。";
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "assistant", content: contentToSave });
      await appendStep(conversation.id, runId, "保存记录", "done", usage?.totalTokens ? `${usage.totalTokens} tokens` : "已保存回答");
      await appendStep(conversation.id, runId, "完成", "done", "会话已更新");
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 对话失败";
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "assistant", content: `请求失败：${message}` });
      await appendStep(conversation.id, runId, "完成/错误", "error", message);
      await onRefresh();
      onNotice(message);
    } finally {
      setBusy(false);
      setAssistantDraft("");
    }
  }

  return (
    <section className="conversation-workspace" aria-label="AI 对话工作台">
      <div className="conversation-main">
        <header className="conversation-thread-header">
          <div className="min-w-0">
            <p className="text-xs text-muted">公考 / 通用 AI 对话</p>
            <h1 className="truncate text-xl font-semibold">{activeConversation?.title ?? "新对话"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone={textConnection ? "green" : "yellow"}>{textConnection ? textConnection.model : "需配置"}</Chip>
            <Button size="sm" variant="outline" onClick={onOpenConnections}>AI 连接</Button>
          </div>
        </header>

        <div className="conversation-message-list">
          {!activeConversation || !messages.length ? (
            <div className="conversation-empty-prompt">
              <h2>今天想从哪里开始？</h2>
              <p>可以问一道错题、复盘一个面试回答，或者把一段知识点变成训练计划。</p>
            </div>
          ) : null}
          {messages.map((message) => (
            <article key={message.id} className={cx("conversation-message", message.role === "user" ? "is-user" : "is-assistant")}>
              <div className="conversation-message-bubble">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted">
                  <span>{message.role === "user" ? "你" : message.role === "assistant" ? "AI" : message.role}</span>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                <p>{message.content}</p>
              </div>
            </article>
          ))}
          {assistantDraft ? (
            <article className="conversation-message is-assistant">
              <div className="conversation-message-bubble">
                <div className="mb-1 text-xs text-muted">AI 正在输入</div>
                <p>{assistantDraft}</p>
              </div>
            </article>
          ) : null}
          {latestRunSummary ? <ConversationToolSummary summary={latestRunSummary} /> : null}
          <div ref={bottomRef} />
        </div>

        <form className="conversation-composer" onSubmit={submitMessage}>
          <button aria-label="添加附件" className="conversation-composer-icon" type="button" onClick={() => onNotice("附件会进入后续 MCP/多模态工具链，本轮先保存文本对话")}>+</button>
          <textarea
            aria-label="对话输入"
            placeholder="询问错题、知识点、面试回答或复盘计划..."
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="conversation-send" disabled={busy || !draft.trim()} type="submit" aria-label="发送">
            {busy ? <span className="ui-spinner" /> : "↑"}
          </button>
        </form>
      </div>

    </section>
  );
}
