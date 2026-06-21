import { Button, Chip, DataList, DataRow, EmptyState, MasteryDots, Panel } from "../shared/ui-primitives";
import type { BoardStat } from "../../lib/review-selectors";
import { formatTimerSeconds } from "./use-review-timer";
import { findRelatedKnowledgeEntries } from "../../services/association-matcher";
import type { Attempt, KnowledgeEntry, Mistake } from "../../types/review";
import { formatShortDate } from "../../lib/review-utils";

const colors = ["#2f6fed", "#1a9b71", "#d79018", "#d45145", "#7a5bd4", "#1c8c9a"];

type StatsViewProps = {
  attempts: Attempt[];
  attemptsCount: number;
  boardStats: BoardStat[];
  knowledgeAttemptsCount: number;
  knowledgeCorrectRate: number;
  knowledgeEntries: KnowledgeEntry[];
  lowKnowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onOpenKnowledgeTraining: (entryId?: string) => void;
};

// 渲染薄弱分析页，展示板块分布、复盘记录和优先处理清单。
export function StatsView({
  attempts,
  attemptsCount,
  boardStats,
  knowledgeAttemptsCount,
  knowledgeCorrectRate,
  knowledgeEntries,
  lowKnowledgeEntries,
  mistakes,
  onOpenKnowledgeEntry,
  onOpenKnowledgeTraining,
}: StatsViewProps) {
  const priorities = [...mistakes].sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt)).slice(0, 6);
  const timedAttempts = attempts.filter((attempt) => typeof attempt.durationSec === "number");
  const averageDuration = timedAttempts.length
    ? Math.round(timedAttempts.reduce((sum, attempt) => sum + (attempt.durationSec ?? 0), 0) / timedAttempts.length)
    : null;
  const total = Math.max(1, mistakes.length);
  const gradient = boardStats
    .reduce<{ cursor: number; parts: string[] }>(
      (acc, item, index) => {
        const end = acc.cursor + (item.total / total) * 100;
        return {
          cursor: end,
          parts: [...acc.parts, `${colors[index % colors.length]} ${acc.cursor}% ${end}%`],
        };
      },
      { cursor: 0, parts: [] },
    )
    .parts.join(", ");

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)] gap-4 max-xl:grid-cols-1">
        <Panel title="板块分布" eyebrow="Board Load">
          <div className="grid grid-cols-[180px_1fr] items-center gap-5 max-sm:grid-cols-1">
            <div className="relative h-44 w-44 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
              <span className="absolute inset-9 rounded-full border border-line bg-surface" />
            </div>
            <DataList>
              {boardStats.map((item, index) => (
                <div key={item.board} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />
                  <span>{item.board}</span>
                  <strong>{item.total}</strong>
                </div>
              ))}
            </DataList>
          </div>
        </Panel>

        <Panel title="训练记录" eyebrow="Attempts">
          <div className="grid h-44 grid-cols-3 gap-3 max-lg:h-auto max-lg:grid-cols-1">
            <div className="grid place-items-center rounded-lg border border-dashed border-line text-center text-muted">
              <span>
                <strong className="block text-2xl text-foreground">{attemptsCount}</strong>
                错题复盘记录
              </span>
            </div>
            <div className="grid place-items-center rounded-lg border border-dashed border-line text-center text-muted">
              <span>
                <strong className="block text-2xl text-foreground">{knowledgeAttemptsCount}</strong>
                知识训练记录 · 会了率 {knowledgeCorrectRate}%
              </span>
            </div>
            <div className="grid place-items-center rounded-lg border border-dashed border-line text-center text-muted">
              <span>
                <strong className="block text-2xl text-foreground">{averageDuration === null ? "--" : formatTimerSeconds(averageDuration)}</strong>
                平均复盘用时
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="优先处理清单" eyebrow="Action List">
        <DataList>
          {priorities.length ? (
            priorities.map((item) => {
              const relatedKnowledge = findRelatedKnowledgeEntries(item, knowledgeEntries, 2);
              return (
                <DataRow key={item.id}>
                  <div className="min-w-0">
                    <strong className="block truncate">
                      {item.board} · {item.stem}
                    </strong>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip tone="yellow">{item.reasons[0] ?? "待归因"}</Chip>
                      <Chip tone="green">{formatShortDate(item.nextReviewAt)} 复盘</Chip>
                    </div>
                    {relatedKnowledge.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {relatedKnowledge.map((match) => (
                          <button
                            key={match.entry.id}
                            className="rounded-full border border-blue/20 bg-blue/10 px-2.5 py-1 text-xs font-bold text-blue hover:bg-blue/15"
                            type="button"
                            onClick={() => onOpenKnowledgeEntry(match.entry)}
                          >
                            {match.entry.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <MasteryDots value={item.mastery} />
                </DataRow>
              );
            })
          ) : (
            <EmptyState>暂无错题</EmptyState>
          )}
        </DataList>
      </Panel>

      <Panel title="薄弱知识资料" eyebrow="Knowledge Action">
        <DataList>
          {lowKnowledgeEntries.length ? (
            lowKnowledgeEntries.slice(0, 6).map((entry) => (
              <DataRow key={entry.id}>
                <div className="min-w-0">
                  <strong className="block truncate">
                    {entry.category} · {entry.title}
                  </strong>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Chip tone="yellow">掌握度 {entry.mastery}</Chip>
                    <Chip tone="green">{formatShortDate(entry.nextReviewAt)} 训练</Chip>
                    <MasteryDots value={entry.mastery} />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" type="button" variant="outline" onClick={() => onOpenKnowledgeEntry(entry)}>
                    查看
                  </Button>
                  <Button size="sm" type="button" variant="soft" onClick={() => onOpenKnowledgeTraining(entry.id)}>
                    训练
                  </Button>
                </div>
              </DataRow>
            ))
          ) : (
            <EmptyState>暂无薄弱知识资料</EmptyState>
          )}
        </DataList>
      </Panel>
    </section>
  );
}
