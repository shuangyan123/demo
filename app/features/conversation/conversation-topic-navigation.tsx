"use client";

import { useEffect, useRef } from "react";
import { AppIcon } from "../shared/app-icon";
import type { ConversationTopic } from "./use-conversation-navigation";

type ConversationTopicNavigationProps = {
  activeTopicId?: string;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onSelect: (turnId: string) => void;
  topics: ConversationTopic[];
};

function TopicList({
  activeTopicId,
  onSelect,
  topics,
}: Pick<ConversationTopicNavigationProps, "activeTopicId" | "onSelect" | "topics">) {
  return (
    <nav className="conversation-topic-list" aria-label="对话主题目录">
      {topics.map((topic) => (
        <button
          key={topic.id}
          className={topic.id === activeTopicId ? "is-active" : undefined}
          type="button"
          aria-current={topic.id === activeTopicId ? "location" : undefined}
          onClick={() => onSelect(topic.id)}
        >
          <span className="topic-mark" aria-hidden="true" />
          <span className="sr-only">主题 {topic.ordinal}：</span>
          <strong className="topic-label">{topic.label}</strong>
        </button>
      ))}
    </nav>
  );
}

/** 宽屏常驻窄目录，空间不足时切换为可锁定焦点的底部抽屉。 */
export function ConversationTopicNavigation({
  activeTopicId,
  drawerOpen,
  onCloseDrawer,
  onSelect,
  topics,
}: ConversationTopicNavigationProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusable = drawer?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [];
    focusable[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseDrawer();
        return;
      }
      if (event.key !== "Tab" || !focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      previousFocus?.focus();
    };
  }, [drawerOpen, onCloseDrawer]);

  if (!topics.length) return null;
  return (
    <>
      <aside className="conversation-topic-rail">
        <TopicList activeTopicId={activeTopicId} topics={topics} onSelect={onSelect} />
      </aside>
      {drawerOpen ? (
        <div className="conversation-topic-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) onCloseDrawer();
        }}>
          <section ref={drawerRef} className="conversation-topic-drawer" role="dialog" aria-modal="true" aria-labelledby="conversation-topic-title">
            <header>
              <div><AppIcon name="topics" size={18} /><h2 id="conversation-topic-title">主题目录</h2><span>{topics.length}</span></div>
              <button type="button" aria-label="关闭主题目录" title="关闭" onClick={onCloseDrawer}><AppIcon name="close" size={18} /></button>
            </header>
            <TopicList activeTopicId={activeTopicId} topics={topics} onSelect={(turnId) => {
              onSelect(turnId);
              onCloseDrawer();
            }} />
          </section>
        </div>
      ) : null}
    </>
  );
}
