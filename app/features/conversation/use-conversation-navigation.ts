"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ConversationTurnTimeline } from "../../services/conversation-turns";
import type { AiConversationAttachment } from "../../types/domains/conversation.ts";

export type ConversationTopic = {
  attachments: Array<Pick<AiConversationAttachment, "id" | "kind" | "label">>;
  id: string;
  label: string;
  ordinal: number;
  summary?: string;
};

const BOTTOM_TOLERANCE_PX = 12;

/** 目录只从现有用户消息派生，不增加持久化字段，也不调用 AI。 */
export function buildConversationTopics(timeline: ConversationTurnTimeline, attachments: AiConversationAttachment[] = []): ConversationTopic[] {
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  let ordinal = 0;
  return timeline.turns.flatMap((turn) => {
    if (!turn.user) return [];
    ordinal += 1;
    const firstLine = turn.user.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return [{
      attachments: turn.user.attachmentIds.flatMap((id) => {
        const attachment = attachmentById.get(id);
        return attachment ? [{ id: attachment.id, kind: attachment.kind, label: attachment.label }] : [];
      }),
      id: turn.id,
      label: firstLine?.slice(0, 48) || `第 ${ordinal} 轮`,
      ordinal,
      summary: turn.assistant?.content.replace(/\s+/g, " ").trim().slice(0, 220) || undefined,
    }];
  });
}

type UseConversationNavigationInput = {
  assistantDraft: string;
  attachments?: AiConversationAttachment[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  timeline: ConversationTurnTimeline;
};

/** 管理阅读位置、目录高亮和“跳到最新消息”可见性。 */
export function useConversationNavigation({
  assistantDraft,
  attachments = [],
  scrollContainerRef,
  timeline,
}: UseConversationNavigationInput) {
  const topics = useMemo(() => buildConversationTopics(timeline, attachments), [attachments, timeline]);
  const [activeTopicId, setActiveTopicId] = useState<string>();
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const followNextUpdateRef = useRef(false);
  const wasAtBottomRef = useRef(true);
  const animationFrameRef = useRef<number | undefined>(undefined);

  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const overflowing = container.scrollHeight > container.clientHeight + 1;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_TOLERANCE_PX;
    wasAtBottomRef.current = atBottom;
    setShowJumpToLatest(overflowing && !atBottom);

    const containerTop = container.getBoundingClientRect().top;
    const topicElements = Array.from(container.querySelectorAll<HTMLElement>("[data-turn-id]"));
    const current = topicElements.reduce<HTMLElement | undefined>((selected, element) => {
      const top = element.getBoundingClientRect().top - containerTop;
      if (top > container.clientHeight * 0.45) return selected;
      return !selected || top >= selected.getBoundingClientRect().top - containerTop ? element : selected;
    }, undefined) ?? topicElements[0];
    setActiveTopicId(current?.dataset.turnId);
  }, [scrollContainerRef]);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(measure);
  }, [measure]);

  const jumpToLatest = useCallback((behavior?: ScrollBehavior) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: behavior ?? (reducedMotion ? "auto" : "smooth"),
    });
    wasAtBottomRef.current = true;
    setShowJumpToLatest(false);
  }, [scrollContainerRef]);

  const markOwnSubmit = useCallback(() => {
    followNextUpdateRef.current = true;
  }, []);

  const scrollToTopic = useCallback((turnId: string) => {
    const container = scrollContainerRef.current;
    const target = container
      ? Array.from(container.querySelectorAll<HTMLElement>("[data-turn-id]")).find((element) => element.dataset.turnId === turnId)
      : undefined;
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    setActiveTopicId(turnId);
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    const content = container.firstElementChild;
    if (content) resizeObserver.observe(content);
    container.addEventListener("scroll", scheduleMeasure, { passive: true });
    scheduleMeasure();
    return () => {
      container.removeEventListener("scroll", scheduleMeasure);
      resizeObserver.disconnect();
      if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [scheduleMeasure, scrollContainerRef]);

  useEffect(() => {
    if (followNextUpdateRef.current || wasAtBottomRef.current) {
      followNextUpdateRef.current = false;
      jumpToLatest("auto");
      return;
    }
    scheduleMeasure();
  }, [assistantDraft, jumpToLatest, scheduleMeasure, timeline]);

  return {
    activeTopicId: activeTopicId ?? topics[0]?.id,
    jumpToLatest,
    markOwnSubmit,
    scrollToTopic,
    showJumpToLatest,
    topics,
  };
}
