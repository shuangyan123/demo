"use client";

import { useRef, useState } from "react";
import {
  ConversationSlashCommandMenu,
  filterConversationSlashCommands,
  findConversationSlashMatch,
  type ConversationSlashCommand,
} from "./conversation-slash-commands";

type ConversationDraftInputProps = {
  activeConversation: boolean;
  draft: string;
  onChange: (draft: string) => void;
  onNotice: (message: string) => void;
  onOpenMcp: () => void;
  onOpenModel: () => void;
  onOpenReasoning: () => void;
  onSearchKnowledge: () => void;
};

/** 对话文本框独立管理光标附近的斜杠指令，不把瞬时菜单状态提升到工作区。 */
export function ConversationDraftInput({
  activeConversation,
  draft,
  onChange,
  onNotice,
  onOpenMcp,
  onOpenModel,
  onOpenReasoning,
  onSearchKnowledge,
}: ConversationDraftInputProps) {
  const [cursorPosition, setCursorPosition] = useState(draft.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const match = findConversationSlashMatch(draft, cursorPosition);
  const matchKey = match ? `${match.start}:${match.end}:${match.query}` : undefined;
  const commands = match && matchKey !== dismissedKey ? filterConversationSlashCommands(match.query) : [];
  const menuOpen = Boolean(match && matchKey !== dismissedKey);

  function selectCommand(command: ConversationSlashCommand) {
    if (!match) return;
    const inserted = command.kind === "insert" ? command.prompt : "";
    const nextDraft = `${draft.slice(0, match.start)}${inserted}${draft.slice(match.end)}`;
    const nextCaret = match.start + inserted.length;
    onChange(nextDraft);
    setCursorPosition(nextCaret);
    setDismissedKey(undefined);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
    if (command.kind !== "action") return;
    if (command.action === "model") onOpenModel();
    else if (command.action === "reasoning") onOpenReasoning();
    else if (command.action === "knowledge") onSearchKnowledge();
    else if (activeConversation) onOpenMcp();
    else onNotice("请先发送首条消息，再调用 MCP 工具");
  }

  return (
    <>
      {menuOpen ? (
        <ConversationSlashCommandMenu
          activeIndex={Math.min(activeIndex, Math.max(0, commands.length - 1))}
          commands={commands}
          onHover={setActiveIndex}
          onSelect={selectCommand}
        />
      ) : null}
      <textarea
        ref={textareaRef}
        aria-controls={menuOpen ? "conversation-slash-menu" : undefined}
        aria-haspopup="listbox"
        aria-label="对话输入"
        placeholder="问点什么…"
        rows={1}
        value={draft}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setCursorPosition(event.currentTarget.selectionStart);
          setActiveIndex(0);
          setDismissedKey(undefined);
        }}
        onClick={(event) => {
          setCursorPosition(event.currentTarget.selectionStart);
          setActiveIndex(0);
          setDismissedKey(undefined);
        }}
        onSelect={(event) => setCursorPosition(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (menuOpen) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(Math.max(0, commands.length - 1), index + 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissedKey(matchKey);
              return;
            }
            if ((event.key === "Enter" || event.key === "Tab") && commands[activeIndex]) {
              event.preventDefault();
              selectCommand(commands[activeIndex]);
              return;
            }
          }
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
    </>
  );
}
