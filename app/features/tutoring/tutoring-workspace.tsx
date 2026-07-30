"use client";
import { useMemo, useState, type FormEvent } from "react";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import type { TutoringPlan, TutoringSession } from "../../types/domains/tutoring.ts";
import type { WorkspaceDataScope } from "../../services/workspace-data-scope";
import { Button, DataList, DataRow, EmptyState, FormGrid, Panel, SegmentedTabs, SelectField, TextAreaField, TextField, Toolbar } from "../shared/ui-primitives";
import { useTutoringFlow } from "./use-tutoring-flow.ts";

type TutoringHistoryTab = "records" | "plans" | "links";
function formatDateTime(value?: string) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}
function tomorrowISO() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

/** 辅导次级工作区只承载记录、计划与资料关联；实时媒体和发送能力统一留在新对话。 */
export function TutoringWorkspace({
  textConnection,
  visionConnection,
  knowledgeEntries,
  mistakes,
  personalizationSettings,
  onNotice,
  onOpenConversation,
  scope,
}: {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  personalizationSettings: PersonalizationSettings;
  onNotice: (message: string) => void;
  onOpenConversation: (conversationId: string) => void;
  scope: WorkspaceDataScope;
}) {
  const [tab, setTab] = useState<TutoringHistoryTab>("records");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const tutoring = useTutoringFlow({ textConnection, visionConnection, onNotice, personalizationSettings, scope });
  const selectedSession = tutoring.snapshot.sessions.find((session) => session.id === selectedSessionId)
    ?? tutoring.snapshot.sessions[0]
    ?? null;
  const activeLinks = useMemo(() => selectedSession
    ? tutoring.snapshot.links.filter((link) => link.sourceType === "session" && link.sourceId === selectedSession.id)
    : [], [selectedSession, tutoring.snapshot.links]);

  async function addPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await tutoring.addPlan({
      linkedKnowledgeIds: [],
      linkedMistakeIds: [],
      nextPracticeAt: tomorrowISO(),
      nextTask: formText(formData, "nextTask") || "完成一次 10 分钟辅导并提交随堂微测。",
      objective: formText(formData, "objective") || "围绕当前薄弱点完成讲解、微测和复练。",
      status: "active",
      title: formText(formData, "title") || "新的辅导计划",
    });
    event.currentTarget.reset();
  }

  return (
    <section className="grid gap-5" aria-label="辅导记录与计划">
      <Panel eyebrow="TUTORING" title="辅导记录">
        <p className="max-w-3xl text-sm leading-6 text-muted">
          实时辅导已整合到新对话。这里集中查看文字记录、下一步计划和用户确认的资料关联。
        </p>
        <Toolbar className="mt-4">
          <SegmentedTabs
            active={tab}
            items={[
              { key: "records", label: "记录", count: tutoring.snapshot.sessions.length },
              { key: "plans", label: "计划", count: tutoring.snapshot.plans.length },
              { key: "links", label: "资料关联", count: tutoring.snapshot.links.length },
            ]}
            onChange={setTab}
          />
        </Toolbar>
      </Panel>

      {tab === "records" ? (
        <TutoringRecords
          sessions={tutoring.snapshot.sessions}
          selectedSession={selectedSession}
          onDelete={(id) => void tutoring.deleteSession(id)}
          onOpenConversation={onOpenConversation}
          onSelect={setSelectedSessionId}
        />
      ) : null}
      {tab === "plans" ? <TutoringPlans plans={tutoring.snapshot.plans} onAdd={addPlan} onDelete={(id) => void tutoring.deletePlan(id)} /> : null}
      {tab === "links" ? (
        <TutoringLinks
          activeLinks={activeLinks}
          knowledgeEntries={knowledgeEntries}
          mistakes={mistakes}
          session={selectedSession}
          onAdd={tutoring.addLink}
          onDelete={(id) => void tutoring.deleteLink(id)}
        />
      ) : null}
    </section>
  );
}

/** 记录列表与详情保持主从关系，关联对话可直接返回原辅导现场。 */
function TutoringRecords({
  sessions,
  selectedSession,
  onDelete,
  onOpenConversation,
  onSelect,
}: {
  sessions: TutoringSession[];
  selectedSession: TutoringSession | null;
  onDelete: (id: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onSelect: (id: string) => void;
}) {
  if (!sessions.length) return <EmptyState reviewPack="tutoring" stateId="tutoring.sessions.empty">暂无辅导记录。请从公考首页进入“对话辅导”开始第一轮。</EmptyState>;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
      <Panel eyebrow="HISTORY" title="历史轮次">
        <DataList>
          {sessions.map((session) => (
            <DataRow key={session.id}>
              <button className="min-w-0 text-left" type="button" onClick={() => onSelect(session.id)}>
                <strong className="block truncate">{session.topic || "未命名辅导"}</strong>
                <span className="mt-1 block text-xs text-muted">{formatDateTime(session.updatedAt)} · {session.status === "completed" ? "已完成" : "进行中"}</span>
              </button>
              {session.conversationId ? <Button size="sm" variant="soft" onClick={() => onOpenConversation(session.conversationId!)}>返回对话</Button> : null}
            </DataRow>
          ))}
        </DataList>
      </Panel>
      <Panel eyebrow="DETAIL" title={selectedSession?.topic || "记录详情"}>
        {selectedSession ? (
          <div className="grid gap-4">
            <section><strong>本轮目标</strong><p className="mt-2 text-sm leading-6 text-muted">{selectedSession.goal}</p></section>
            <section><strong>辅导摘要</strong><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{selectedSession.summary || "结束本轮后生成摘要。"}</p></section>
            <section><strong>下一步</strong><p className="mt-2 text-sm leading-6 text-muted">{selectedSession.nextActions.join("；") || "完成随堂微测后安排复练。"}</p></section>
            <Button size="sm" variant="danger" onClick={() => onDelete(selectedSession.id)}>删除记录</Button>
          </div>
        ) : <EmptyState stateId="tutoring.record.selection.empty">请选择一条记录</EmptyState>}
      </Panel>
    </div>
  );
}

/** 计划页只保存目标和下一步任务，不在此处重新提供实时辅导入口。 */
function TutoringPlans({ plans, onAdd, onDelete }: { plans: TutoringPlan[]; onAdd: (event: FormEvent<HTMLFormElement>) => void; onDelete: (id: string) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
      <Panel eyebrow="PLAN" title="新建计划">
        <form className="grid gap-3" onSubmit={onAdd}>
          <TextField label="计划名称" name="title" />
          <TextAreaField label="辅导目标" name="objective" />
          <TextAreaField label="下一步任务" name="nextTask" />
          <Button type="submit" variant="primary">保存计划</Button>
        </form>
      </Panel>
      <Panel eyebrow="SCHEDULE" title="辅导计划">
        {plans.length ? <DataList>{plans.map((plan) => <DataRow key={plan.id}><div><strong>{plan.title}</strong><p className="mt-1 text-sm text-muted">{plan.nextTask}</p></div><Button size="sm" variant="ghost" onClick={() => onDelete(plan.id)}>删除</Button></DataRow>)}</DataList> : <EmptyState reviewPack="tutoring" stateId="tutoring.plans.empty">暂无辅导计划</EmptyState>}
      </Panel>
    </div>
  );
}

/** 资料关联必须由用户显式提交，目标只允许现有知识资料或错题。 */
function TutoringLinks({
  activeLinks,
  knowledgeEntries,
  mistakes,
  session,
  onAdd,
  onDelete,
}: {
  activeLinks: ReturnType<typeof useTutoringFlow>["snapshot"]["links"];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  session: TutoringSession | null;
  onAdd: ReturnType<typeof useTutoringFlow>["addLink"];
  onDelete: (id: string) => void;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const formData = new FormData(event.currentTarget);
    const [targetType, targetId] = formText(formData, "target").split(":") as ["knowledge" | "mistake", string];
    if (!targetId) return;
    await onAdd({ evidence: [], reason: formText(formData, "reason") || "本轮辅导需要继续参考", score: 1, sourceId: session.id, sourceType: "session", targetId, targetType });
    event.currentTarget.reset();
  }
  if (!session) return <EmptyState stateId="tutoring.session.selection.empty">请先选择一条辅导记录</EmptyState>;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
      <Panel eyebrow="LINK" title="添加关联">
        <form className="grid gap-3" onSubmit={submit}>
          <FormGrid>
            <SelectField
              label="资料"
              name="target"
              defaultValue=""
              options={[
                ["", "选择知识或错题"],
                ...knowledgeEntries.map((item) => [`knowledge:${item.id}`, `知识 · ${item.title}`] as [string, string]),
                ...mistakes.map((item) => [`mistake:${item.id}`, `错题 · ${item.stem.slice(0, 40)}`] as [string, string]),
              ]}
            />
          </FormGrid>
          <TextField label="关联原因" name="reason" />
          <Button type="submit" variant="primary">确认关联</Button>
        </form>
      </Panel>
      <Panel eyebrow="CURRENT" title="当前关联">
        {activeLinks.length ? <DataList>{activeLinks.map((link) => <DataRow key={link.id}><span>{link.reason}</span><Button size="sm" variant="ghost" onClick={() => onDelete(link.id)}>移除</Button></DataRow>)}</DataList> : <EmptyState reviewPack="tutoring" stateId="tutoring.links.empty">当前记录暂无资料关联</EmptyState>}
      </Panel>
    </div>
  );
}
