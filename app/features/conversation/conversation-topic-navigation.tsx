"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../shared/app-icon";
import { computeUiOverlayPosition } from "../shared/ui-overlay-position";
import type { ConversationTopic } from "./use-conversation-navigation";

type ConversationTopicNavigationProps = {
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onSelect: (turnId: string) => void;
  topics: ConversationTopic[];
};

type TopicPreview = { anchor: HTMLButtonElement; topic: ConversationTopic };

function topicAccessibleName(topic: ConversationTopic, latest: boolean): string {
  return `${latest ? "最新主题，" : ""}主题 ${topic.ordinal}：${topic.label}${topic.summary ? `。摘要：${topic.summary}` : ""}${topic.attachments.length ? `。${topic.attachments.length} 个附件` : ""}`;
}

function TopicList({ drawer = false, onPreview, onSelect, topics }: {
  drawer?: boolean;
  onPreview?: (topic: ConversationTopic, target: HTMLButtonElement, immediate: boolean) => void;
  onSelect: (turnId: string) => void;
  topics: ConversationTopic[];
}) {
  const latestRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    latestRef.current?.scrollIntoView({ block: "nearest" });
  }, [topics.length]);
  return (
    <nav className="conversation-topic-list" aria-label="对话主题目录">
      {topics.map((topic, index) => {
        const latest = index === topics.length - 1;
        return (
          <button
            key={topic.id}
            ref={latest ? latestRef : undefined}
            className={latest ? "is-latest" : undefined}
            type="button"
            aria-label={topicAccessibleName(topic, latest)}
            onClick={() => onSelect(topic.id)}
            onFocus={(event: FocusEvent<HTMLButtonElement>) => onPreview?.(topic, event.currentTarget, true)}
            onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => onPreview?.(topic, event.currentTarget, false)}
          >
            <span className="topic-mark" aria-hidden="true" />
            {drawer ? (
              <span className="topic-mobile-copy">
                <strong>{topic.ordinal}. {topic.label}</strong>
                {topic.summary ? <small>{topic.summary}</small> : null}
                {topic.attachments.length ? <em><AppIcon name="paperclip" size={14} />{topic.attachments.length} 个附件</em> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function TopicPreviewCard({ preview }: { preview: TopicPreview }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false });
  const visibleAttachments = preview.topic.attachments.slice(0, 2);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const update = () => setPosition({
      ...computeUiOverlayPosition({
        anchor: preview.anchor.getBoundingClientRect(),
        overlay: card.getBoundingClientRect(),
        placement: "right",
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        gap: 10,
      }),
      visible: true,
    });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [preview]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <aside ref={cardRef} className="conversation-topic-preview" style={{ left: position.left, top: position.top, visibility: position.visible ? "visible" : "hidden" }} role="tooltip">
      <strong>{preview.topic.ordinal}. {preview.topic.label}</strong>
      {preview.topic.summary ? <p>{preview.topic.summary}</p> : null}
      {visibleAttachments.length ? (
        <div>
          {visibleAttachments.map((attachment) => <span key={attachment.id}><AppIcon name="paperclip" size={16} />{attachment.label}</span>)}
          {preview.topic.attachments.length > 2 ? <em>+{preview.topic.attachments.length - 2}</em> : null}
        </div>
      ) : null}
    </aside>,
    document.body,
  );
}

/** 桌面以居中短横线导航主题，窄屏继续使用可锁定焦点的底部抽屉。 */
export function ConversationTopicNavigation({ drawerOpen, onCloseDrawer, onSelect, topics }: ConversationTopicNavigationProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<number | undefined>(undefined);
  const [preview, setPreview] = useState<TopicPreview>();

  function showPreview(topic: ConversationTopic, target: HTMLButtonElement, delay = 180) {
    if (previewTimerRef.current !== undefined) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      setPreview({ anchor: target, topic });
    }, delay);
  }

  useEffect(() => {
    const close = () => setPreview(undefined);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      if (previewTimerRef.current !== undefined) window.clearTimeout(previewTimerRef.current);
    };
  }, []);

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
      <aside
        className="conversation-topic-rail"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(undefined);
        }}
        onMouseLeave={() => setPreview(undefined)}
      >
        <TopicList topics={topics} onSelect={onSelect} onPreview={(topic, target, immediate) => showPreview(topic, target, immediate ? 0 : 180)} />
      </aside>
      {preview ? <TopicPreviewCard preview={preview} /> : null}
      {drawerOpen ? (
        <div className="conversation-topic-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) onCloseDrawer();
        }}>
          <section ref={drawerRef} className="conversation-topic-drawer" role="dialog" aria-modal="true" aria-labelledby="conversation-topic-title">
            <header>
              <div><AppIcon name="topics" size={18} /><h2 id="conversation-topic-title">主题目录</h2><span>{topics.length}</span></div>
              <button type="button" aria-label="关闭主题目录" title="关闭" onClick={onCloseDrawer}><AppIcon name="close" size={18} /></button>
            </header>
            <TopicList drawer topics={topics} onSelect={(turnId) => {
              onSelect(turnId);
              onCloseDrawer();
            }} />
          </section>
        </div>
      ) : null}
    </>
  );
}
