"use client";

import { Button, CardButton, Chip, DataList, EmptyState, Panel, SoftBlock } from "./ui-primitives";
import type { KnowledgeMatch, RelatedMistakeMatch } from "../../services/association-matcher";
import type { AssociationSuggestion, KnowledgeEntry, KnowledgeMistakeLink, Mistake } from "../../types/review";

type AssociationMode = "mistake" | "knowledge";

type AssociationPanelProps = {
  aiBusy: boolean;
  apiReady: boolean;
  knowledgeEntries: KnowledgeEntry[];
  links: KnowledgeMistakeLink[];
  localKnowledgeMatches?: KnowledgeMatch[];
  localMistakeMatches?: RelatedMistakeMatch[];
  mistakes: Mistake[];
  mode: AssociationMode;
  suggestions: AssociationSuggestion[];
  onAnalyze: () => void;
  onClearSuggestions?: () => void;
  onConfirmSuggestions: () => void;
  onDeleteSuggestion: (id: string) => void;
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onOpenMistake: (mistake: Mistake) => void;
  onOpenSettings: () => void;
  onRemoveLink: (id: string) => void;
  onToggleSuggestion: (id: string, selected: boolean) => void;
};

// 根据 ID 建立 Map，避免渲染每个关联条目时反复扫描列表。
function toMap<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

// 渲染 AI 证据标签，空证据时不输出额外容器，保持卡片高度紧凑。
function EvidenceChips({ evidence }: { evidence: string[] }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {evidence.map((item) => (
        <Chip key={item}>{item}</Chip>
      ))}
    </div>
  );
}

// 渲染一条已确认关联，支持从错题侧打开知识资料，也支持从知识侧打开错题。
function ConfirmedAssociationRow({
  entry,
  link,
  mistake,
  mode,
  onOpenKnowledgeEntry,
  onOpenMistake,
  onRemoveLink,
}: {
  entry?: KnowledgeEntry;
  link: KnowledgeMistakeLink;
  mistake?: Mistake;
  mode: AssociationMode;
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onOpenMistake: (mistake: Mistake) => void;
  onRemoveLink: (id: string) => void;
}) {
  const title = mode === "mistake" ? entry?.title : mistake?.stem;
  const tag = mode === "mistake" ? entry?.category : mistake?.board;
  const description = mode === "mistake" ? entry?.summary || entry?.content : mistake?.explanation || mistake?.answer;
  const canOpen = mode === "mistake" ? Boolean(entry) : Boolean(mistake);

  return (
    <article className="ui-card ui-card-muted p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          className="min-w-0 text-left disabled:cursor-default"
          type="button"
          disabled={!canOpen}
          onClick={() => {
            if (mode === "mistake" && entry) onOpenKnowledgeEntry(entry);
            if (mode === "knowledge" && mistake) onOpenMistake(mistake);
          }}
        >
          <strong className="line-clamp-2">{title ?? "关联对象已缺失"}</strong>
          {description && <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{description}</p>}
        </button>
        {tag && <Chip tone="blue">{tag}</Chip>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          关联度 {link.score} · {link.reason}
        </span>
        <Button size="sm" type="button" variant="danger" onClick={() => onRemoveLink(link.id)}>
          取消关联
        </Button>
      </div>
      <EvidenceChips evidence={link.evidence} />
    </article>
  );
}

// 渲染 AI 尚未确认的关联建议，只有勾选并确认后才会写入 IndexedDB。
function SuggestionRow({
  entry,
  mode,
  mistake,
  suggestion,
  onDeleteSuggestion,
  onToggleSuggestion,
}: {
  entry?: KnowledgeEntry;
  mode: AssociationMode;
  mistake?: Mistake;
  suggestion: AssociationSuggestion;
  onDeleteSuggestion: (id: string) => void;
  onToggleSuggestion: (id: string, selected: boolean) => void;
}) {
  const title = mode === "mistake" ? entry?.title : mistake?.stem;
  const tag = mode === "mistake" ? entry?.category : mistake?.board;

  return (
    <article className="ui-card border-blue/20 bg-blue/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="inline-flex min-w-0 flex-1 items-start gap-2 text-sm font-bold">
          <input
            checked={suggestion.selected}
            className="mt-1 h-4 w-4 accent-blue"
            type="checkbox"
            onChange={(event) => onToggleSuggestion(suggestion.id, event.target.checked)}
          />
          <span className="min-w-0">
            <span className="line-clamp-2">{title ?? "候选对象已缺失"}</span>
            <span className="mt-1 block text-muted">
              AI 关联度 {suggestion.score} · {suggestion.reason}
            </span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          {tag && <Chip tone="blue">{tag}</Chip>}
          <Button size="sm" type="button" variant="outline" onClick={() => onDeleteSuggestion(suggestion.id)}>
            忽略
          </Button>
        </div>
      </div>
      <EvidenceChips evidence={suggestion.evidence} />
    </article>
  );
}

// 渲染本地推荐资料，作为 AI 关联前的候选兜底，点击只负责打开详情。
function LocalKnowledgeMatches({ matches, onOpenKnowledgeEntry }: { matches: KnowledgeMatch[]; onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void }) {
  if (!matches.length) return <EmptyState>暂无本地推荐</EmptyState>;
  return (
    <DataList>
      {matches.map((match) => (
        <CardButton key={match.entry.id} className="p-3" onClick={() => onOpenKnowledgeEntry(match.entry)}>
          <div className="flex items-start justify-between gap-3">
            <strong className="line-clamp-2">{match.entry.title}</strong>
            <Chip tone="blue">{match.entry.category}</Chip>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{match.entry.summary || match.entry.content}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {match.reasons.slice(0, 2).map((reason) => (
              <Chip key={reason}>{reason}</Chip>
            ))}
          </div>
        </CardButton>
      ))}
    </DataList>
  );
}

// 渲染本地推荐错题，作为知识资料侧 AI 分析前的候选兜底。
function LocalMistakeMatches({ matches, onOpenMistake }: { matches: RelatedMistakeMatch[]; onOpenMistake: (mistake: Mistake) => void }) {
  if (!matches.length) return <EmptyState>暂无本地推荐</EmptyState>;
  return (
    <DataList>
      {matches.map((match) => (
        <CardButton key={match.mistake.id} className="p-3" onClick={() => onOpenMistake(match.mistake)}>
          <div className="flex items-start justify-between gap-3">
            <strong className="line-clamp-2">{match.mistake.stem}</strong>
            <Chip tone="blue">{match.mistake.board}</Chip>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {match.reasons.slice(0, 2).map((reason) => (
              <Chip key={reason}>{reason}</Chip>
            ))}
            <Chip tone="yellow">掌握度 {match.mistake.mastery}</Chip>
          </div>
        </CardButton>
      ))}
    </DataList>
  );
}

// 关联面板统一承载已确认关联、本地推荐和 AI 预览，避免两个详情页各自实现一套逻辑。
export function AssociationPanel({
  aiBusy,
  apiReady,
  knowledgeEntries,
  links,
  localKnowledgeMatches = [],
  localMistakeMatches = [],
  mistakes,
  mode,
  suggestions,
  onAnalyze,
  onClearSuggestions,
  onConfirmSuggestions,
  onDeleteSuggestion,
  onOpenKnowledgeEntry,
  onOpenMistake,
  onOpenSettings,
  onRemoveLink,
  onToggleSuggestion,
}: AssociationPanelProps) {
  const knowledgeById = toMap(knowledgeEntries);
  const mistakeById = toMap(mistakes);
  const linkedKnowledgeIds = new Set(links.map((link) => link.knowledgeId));
  const linkedMistakeIds = new Set(links.map((link) => link.mistakeId));
  const visibleLocalKnowledgeMatches = localKnowledgeMatches.filter((match) => !linkedKnowledgeIds.has(match.entry.id));
  const visibleLocalMistakeMatches = localMistakeMatches.filter((match) => !linkedMistakeIds.has(match.mistake.id));
  const selectedCount = suggestions.filter((suggestion) => suggestion.selected).length;
  const localTitle = mode === "mistake" ? "本地推荐资料" : "本地推荐错题";
  const actionText = mode === "mistake" ? "AI 分析关联资料" : "AI 分析关联错题";
  const rerunText = mode === "mistake" ? "重新分析资料" : "重新分析错题";

  return (
    <Panel title="关联" eyebrow="Association">
      <div className="flex flex-wrap gap-2">
        {apiReady ? (
          <Button type="button" variant="soft" disabled={aiBusy} onClick={onAnalyze}>
            {aiBusy ? "AI 分析中..." : suggestions.length ? rerunText : actionText}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onOpenSettings}>
            配置默认文本连接后启用 AI 分析
          </Button>
        )}
        {suggestions.length > 0 && (
          <>
            <Button type="button" variant="primary" disabled={!selectedCount || aiBusy} onClick={onConfirmSuggestions}>
              确认关联 {selectedCount || ""} 条
            </Button>
            {onClearSuggestions && (
              <Button type="button" variant="ghost" disabled={aiBusy} onClick={onClearSuggestions}>
                清空预览
              </Button>
            )}
          </>
        )}
      </div>

      {!apiReady && (
        <SoftBlock className="mt-4 text-sm leading-6 text-muted">
          AI 关联只会在手动点击后调用当前应用内 API 配置；未确认的建议不会写入本地数据库。
        </SoftBlock>
      )}

      <div className="mt-4 grid gap-3">
        <strong>已确认关联</strong>
        {links.length ? (
          <DataList>
            {links.map((link) => (
              <ConfirmedAssociationRow
                key={link.id}
                entry={knowledgeById.get(link.knowledgeId)}
                link={link}
                mistake={mistakeById.get(link.mistakeId)}
                mode={mode}
                onOpenKnowledgeEntry={onOpenKnowledgeEntry}
                onOpenMistake={onOpenMistake}
                onRemoveLink={onRemoveLink}
              />
            ))}
          </DataList>
        ) : (
          <EmptyState>暂无已确认关联</EmptyState>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4 grid gap-3">
          <strong>AI 建议预览</strong>
          <DataList>
            {suggestions.map((suggestion) => (
              <SuggestionRow
                key={suggestion.id}
                entry={knowledgeById.get(suggestion.knowledgeId)}
                mode={mode}
                mistake={mistakeById.get(suggestion.mistakeId)}
                suggestion={suggestion}
                onDeleteSuggestion={onDeleteSuggestion}
                onToggleSuggestion={onToggleSuggestion}
              />
            ))}
          </DataList>
        </div>
      )}

      <div className="mt-4 grid gap-3">
        <strong>{localTitle}</strong>
        {mode === "mistake" ? (
          <LocalKnowledgeMatches matches={visibleLocalKnowledgeMatches} onOpenKnowledgeEntry={onOpenKnowledgeEntry} />
        ) : (
          <LocalMistakeMatches matches={visibleLocalMistakeMatches} onOpenMistake={onOpenMistake} />
        )}
      </div>
    </Panel>
  );
}
