"use client";

import { AppIcon, type AppIconName } from "../shared/app-icon";

export type ConversationSlashCommandAction = "model" | "reasoning" | "knowledge" | "mcp";

export type ConversationSlashCommand = {
  id: string;
  label: string;
  description: string;
  icon: AppIconName;
} & (
  | { kind: "insert"; prompt: string }
  | { kind: "action"; action: ConversationSlashCommandAction }
);

export type ConversationSlashMatch = {
  start: number;
  end: number;
  query: string;
};

export const conversationSlashCommands: ConversationSlashCommand[] = [
  { id: "explain", label: "/解释", description: "用通俗语言解释当前内容", icon: "knowledge", kind: "insert", prompt: "请用通俗语言解释：" },
  { id: "quiz", label: "/出题", description: "生成一道公考练习题，暂不公布答案", icon: "review", kind: "insert", prompt: "请围绕当前主题出一道公考练习题，暂不公布答案。" },
  { id: "review", label: "/复盘", description: "分析错误思路并给出纠正建议", icon: "scheduled", kind: "insert", prompt: "请分析我的错误思路，并给出分步纠正建议。" },
  { id: "summary", label: "/总结", description: "总结结论与下一步行动", icon: "stats", kind: "insert", prompt: "请总结当前对话的关键结论和下一步行动。" },
  { id: "model", label: "/模型", description: "选择本次对话使用的模型", icon: "sparkles", kind: "action", action: "model" },
  { id: "reasoning", label: "/推理", description: "调整当前模型的推理强度", icon: "configuration", kind: "action", action: "reasoning" },
  { id: "knowledge", label: "/知识", description: "检索本地知识摘要", icon: "knowledge", kind: "action", action: "knowledge" },
  { id: "mcp", label: "/mcp", description: "打开当前对话的 MCP 工具", icon: "mcp", kind: "action", action: "mcp" },
];

/** 只识别光标所在、由行首或空白引出的斜杠词。 */
export function findConversationSlashMatch(value: string, caret: number): ConversationSlashMatch | null {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  const query = match[1] ?? "";
  const start = caret - query.length - 1;
  let end = caret;
  while (end < value.length && !/\s/.test(value[end] ?? "")) end += 1;
  return { start, end, query };
}

export function filterConversationSlashCommands(query: string): ConversationSlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return conversationSlashCommands;
  return conversationSlashCommands.filter((command) => (
    `${command.label.slice(1)} ${command.description}`.toLowerCase().includes(normalized)
  ));
}

/** 菜单不接管焦点，键盘操作始终留在对话输入框。 */
export function ConversationSlashCommandMenu({
  activeIndex,
  commands,
  onHover,
  onSelect,
}: {
  activeIndex: number;
  commands: ConversationSlashCommand[];
  onHover: (index: number) => void;
  onSelect: (command: ConversationSlashCommand) => void;
}) {
  return (
    <div className="conversation-slash-menu" id="conversation-slash-menu" role="listbox" aria-label="快捷指令">
      {commands.length ? commands.map((command, index) => (
        <button
          aria-selected={index === activeIndex}
          className={index === activeIndex ? "is-active" : undefined}
          key={command.id}
          role="option"
          tabIndex={-1}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(command)}
        >
          <AppIcon name={command.icon} size={16} />
          <span><strong>{command.label}</strong><small>{command.description}</small></span>
        </button>
      )) : <p>没有匹配的指令</p>}
    </div>
  );
}
