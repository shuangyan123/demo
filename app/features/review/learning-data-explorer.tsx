"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BOARD_OPTIONS, type Attempt, type Mistake } from "../../types/domains/review.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { LearnerStateSnapshot } from "../../types/domains/learner-state.ts";
import type { ConversationLaunchContext } from "../conversation/conversation-launch-context";
import { AppIcon } from "../shared/app-icon";
import { Button, EmptyState, MasteryDots } from "../shared/ui-primitives";
import { LearningInsightView } from "./learning-insight-view";
import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";

type ExplorerTab = "mistakes" | "knowledge" | "weak";
type ExplorerRecord = { id: string; kind: "mistake" | "knowledge"; title: string; subtitle: string; board: string; mastery: number; tags: string[]; updatedAt: string; source: Mistake | KnowledgeEntry };

type LearningDataExplorerProps = {
  recommendations?: LearningActionRecommendation[];
  initialMistakeId?: string;
  attempts: Attempt[];
  knowledgeAttempts: KnowledgeAttempt[];
  knowledgeEntries: KnowledgeEntry[];
  learnerState: LearnerStateSnapshot;
  managementContent: ReactNode;
  mistakes: Mistake[];
  onOpenKnowledgeOperations: () => void;
  onOpenKnowledgeTraining: (id?: string) => void;
  onOpenReview: (id?: string) => void;
  onRefresh: () => Promise<void>;
  onStartConversation: (context: ConversationLaunchContext) => void;
};

function toMistakeRecord(item: Mistake): ExplorerRecord {
  return { id: item.id, kind: "mistake", title: item.stem, subtitle: item.source, board: item.board, mastery: item.mastery, tags: item.tags, updatedAt: item.updatedAt, source: item };
}

function toKnowledgeRecord(item: KnowledgeEntry): ExplorerRecord {
  return { id: item.id, kind: "knowledge", title: item.title, subtitle: item.summary, board: item.category, mastery: item.mastery, tags: item.tags, updatedAt: item.updatedAt, source: item };
}

/** 统一浏览错题、知识和薄弱项；板块筛选只在此处维护一次。 */
export function LearningDataExplorer({ attempts, initialMistakeId, recommendations, knowledgeAttempts, knowledgeEntries, learnerState, managementContent, mistakes, onOpenKnowledgeOperations, onOpenKnowledgeTraining, onOpenReview, onRefresh, onStartConversation }: LearningDataExplorerProps) {
  const [tab, setTab] = useState<ExplorerTab>("mistakes");
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState("全部");
  const [mastery, setMastery] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(initialMistakeId ?? null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);

  const records = useMemo(() => {
    const mistakeRecords = mistakes.map(toMistakeRecord);
    const knowledgeRecords = knowledgeEntries.map(toKnowledgeRecord);
    const source = tab === "mistakes" ? mistakeRecords : tab === "knowledge" ? knowledgeRecords : [...mistakeRecords, ...knowledgeRecords].filter((item) => item.mastery <= 2);
    const query = search.trim().toLowerCase();
    return source.filter((item) => (board === "全部" || item.board === board) && (mastery === "全部" || (mastery === "薄弱" ? item.mastery <= 2 : item.mastery >= 4)) && (!query || `${item.title} ${item.subtitle} ${item.tags.join(" ")}`.toLowerCase().includes(query)));
  }, [board, knowledgeEntries, mastery, mistakes, search, tab]);
  const selected = records.find((item) => item.id === selectedId) ?? records[0] ?? null;

  function startConversation(item: ExplorerRecord) {
    const source = item.source;
    const summary = item.kind === "mistake"
      ? `板块：${item.board}\n题目：${item.title}\n解析：${(source as Mistake).explanation}\n错因：${(source as Mistake).reasons.join("、") || "待分析"}`
      : `分类：${item.board}\n知识：${item.title}\n摘要：${(source as KnowledgeEntry).summary}\n标签：${item.tags.join("、") || "无"}`;
    onStartConversation({
      id: crypto.randomUUID(), moduleId: "library", moduleLabel: item.kind === "mistake" ? "错题库" : "知识库",
      kind: item.kind === "mistake" ? "general" : "knowledge", sourceType: item.kind, sourceId: item.id,
      title: item.title.slice(0, 36), summary, suggestedPrompt: item.kind === "mistake" ? "请分析我的错误思路，并给出一步一步的正确解法。" : "请围绕这个知识点讲解，并结合公考题型帮助我巩固。",
    });
  }

  if (managementOpen) return <section className="space-y-3"><Button variant="soft" onClick={() => setManagementOpen(false)}><AppIcon name="back" size={16} />返回统一浏览</Button>{managementContent}</section>;

  return (
    <section className="learning-explorer" aria-label="学习数据浏览器">
      <header className="learning-explorer-header">
        <div><h1>学习数据</h1><p>在同一个视图中浏览错题、知识和薄弱项，并把当前上下文交给新对话。</p></div>
        <div><Button variant="soft" onClick={() => setManagementOpen(true)}>批量管理</Button><Button variant="soft" onClick={onOpenKnowledgeOperations}>知识演进与 Obsidian</Button></div>
      </header>
      <nav className="learning-explorer-tabs" aria-label="学习数据类型">
        <button className={tab === "mistakes" ? "is-active" : ""} type="button" onClick={() => { setTab("mistakes"); setSelectedId(null); }}>错题 <span>{mistakes.length}</span></button>
        <button className={tab === "knowledge" ? "is-active" : ""} type="button" onClick={() => { setTab("knowledge"); setSelectedId(null); }}>知识 <span>{knowledgeEntries.length}</span></button>
        <button className={tab === "weak" ? "is-active" : ""} type="button" onClick={() => { setTab("weak"); setSelectedId(null); }}>薄弱分析</button>
      </nav>
      {tab === "weak" ? (
        <div className="p-5 max-sm:p-3">
          <LearningInsightView
            recommendations={recommendations}
            attempts={attempts}
            knowledgeAttempts={knowledgeAttempts}
            knowledgeEntries={knowledgeEntries}
            learnerState={learnerState}
            mistakes={mistakes}
            onOpenKnowledgeTraining={onOpenKnowledgeTraining}
            onOpenReview={onOpenReview}
            onRefresh={onRefresh}
          />
        </div>
      ) : (
      <>
      <div className="learning-explorer-scope">
        <label><AppIcon name="search" size={16} /><input aria-label="搜索学习数据" placeholder="搜索题目、知识或标签" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
        <button className="learning-filter-trigger" type="button" onClick={() => setFiltersOpen((value) => !value)}><AppIcon name="configuration" size={16} />筛选</button>
        <div className={filtersOpen ? "learning-filters is-open" : "learning-filters"}>
          <label>板块<select aria-label="板块" value={board} onChange={(event) => setBoard(event.currentTarget.value)}><option>全部</option>{BOARD_OPTIONS.map((item) => <option key={item}>{item}</option>)}{["申论"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>掌握度<select aria-label="掌握度" value={mastery} onChange={(event) => setMastery(event.currentTarget.value)}><option>全部</option><option>薄弱</option><option>已掌握</option></select></label>
          <button type="button" onClick={() => { setBoard("全部"); setMastery("全部"); setSearch(""); }}>重置</button>
        </div>
      </div>
      <div className="learning-explorer-body">
        <div className="learning-record-list" role="list">
          <div className="learning-record-head"><span>题目 / 知识点</span><span>板块</span><span>掌握度</span><span>最后练习</span></div>
          {records.length ? records.map((item) => <button key={`${item.kind}:${item.id}`} className={selected?.id === item.id ? "learning-record-row is-selected" : "learning-record-row"} type="button" onClick={() => setSelectedId(item.id)}><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><span>{item.board}</span><MasteryDots value={item.mastery} /><time>{item.updatedAt.slice(0, 10)}</time></button>) : <EmptyState stateId="learning-explorer.results.empty"><strong>没有匹配的数据</strong><span>调整筛选条件或先导入学习资料。</span></EmptyState>}
        </div>
        {selected ? <aside className="learning-record-detail"><button className="learning-detail-close" type="button" aria-label="关闭详情" onClick={() => setSelectedId(null)}><AppIcon name="close" size={16} /></button><p>{selected.kind === "mistake" ? "错题" : "知识"} / {selected.board}</p><h2>{selected.title}</h2><div className="learning-detail-summary">{selected.kind === "mistake" ? (selected.source as Mistake).explanation : (selected.source as KnowledgeEntry).summary}</div><section><h3>关联与标签</h3><p>{selected.tags.join("、") || "暂无标签"}</p></section><section><h3>学习状态</h3><MasteryDots value={selected.mastery} /></section><div className="learning-detail-actions"><Button variant="primary" onClick={() => startConversation(selected)}><AppIcon name="newChat" size={16} />在新对话中继续</Button>{selected.kind === "mistake" ? <Button variant="soft" onClick={() => onOpenReview(selected.id)}>开始这道复盘</Button> : null}{selected.kind === "knowledge" ? <Button variant="soft" onClick={() => onOpenKnowledgeTraining(selected.id)}>加入知识训练</Button> : null}</div></aside> : <aside className="learning-record-detail grid place-items-center text-sm text-muted" data-review-state="learning-explorer.selection.empty">选择一条记录查看详情</aside>}
      </div>
      </>
      )}
    </section>
  );
}
