"use client";

import { useMemo, useState, type RefObject, type SyntheticEvent } from "react";
import {
  Button,
  CardButton,
  Chip,
  DataList,
  DataRow,
  DetailBlock,
  EmptyState,
  FormGrid,
  MetricCard,
  Panel,
  SegmentedTabs,
  SelectField,
  SoftBlock,
  StatGrid,
  TextAreaField,
  TextField,
  Timeline,
  Toolbar,
} from "../shared/ui-primitives";
import { useTutoringFlow } from "./use-tutoring-flow";
import { useTutoringSessionController, type TutoringMediaController, type TutoringSamplerController, type TutoringSpeechController } from "./use-tutoring-session-controller";
import type { ApiConnectionProfile, KnowledgeEntry, Mistake, PersonalizationSettings, TutoringLink, TutoringMode, TutoringPlan, TutoringSession, TutoringTurn } from "../../types/review";

type TutoringTab = "live" | "records" | "plans" | "links" | "devices";
type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const modeLabels: Record<TutoringMode, string> = {
  camera: "摄像头",
  screen: "屏幕共享",
  upload: "截图上传",
};

const statusLabels: Record<TutoringSession["status"], string> = {
  active: "辅导中",
  completed: "已完成",
  paused: "已暂停",
  setup: "准备中",
  summarizing: "总结中",
};

// 格式化日期时间，列表和详情统一使用这个短格式。
function formatDateTime(value?: string) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" }).format(new Date(value));
}

// 生成明天同一时间的 ISO 字符串，用于新建辅导计划的默认下次任务时间。
function tomorrowISO() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

// 提取 formData 字符串，避免每个表单重复类型判断。
function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

// AI 辅导工作台聚合实时辅导、记录、计划、关联和设备设置；业务读写全部委托给 hooks。
export function TutoringWorkspace({
  textConnection,
  visionConnection,
  knowledgeEntries,
  mistakes,
  personalizationSettings,
  speechConnection,
  onNotice,
  onOpenSettings,
}: {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  personalizationSettings: PersonalizationSettings;
  speechConnection?: ApiConnectionProfile;
  onNotice: (message: string) => void;
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<TutoringTab>("live");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const tutoring = useTutoringFlow({ textConnection, visionConnection, knowledgeEntries, mistakes, onNotice, personalizationSettings });
  const {
    captureCurrentFrame,
    createSession,
    draftText,
    frameDescription,
    media,
    sampler,
    sessionGoal,
    sessionTopic,
    setDraftText,
    setFrameDescription,
    setSessionGoal,
    setSessionTopic,
    speech,
    submitTutorTurn,
  } = useTutoringSessionController({ onNotice, personalizationSettings, speechConnection, tutoring });

  const activeLinks = useMemo(
    () => (tutoring.activeSession ? tutoring.snapshot.links.filter((link) => link.sourceType === "session" && link.sourceId === tutoring.activeSession?.id) : []),
    [tutoring.activeSession, tutoring.snapshot.links],
  );
  const selectedPlan = tutoring.snapshot.plans.find((plan) => plan.id === selectedPlanId) ?? tutoring.snapshot.plans[0] ?? null;
  const tabs = [
    { key: "live" as const, label: "实时辅导" },
    { key: "records" as const, label: "辅导记录", count: tutoring.snapshot.sessions.length },
    { key: "plans" as const, label: "辅导计划", count: tutoring.snapshot.plans.length },
    { key: "links" as const, label: "资料关联", count: tutoring.snapshot.links.length },
    { key: "devices" as const, label: "设备设置" },
  ];

  // 新建辅导计划，计划只保存文字目标和本地资料 ID 引用。
  async function addPlan(event: SubmitReactEvent) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = formText(formData, "title") || "新的辅导计划";
    const objective = formText(formData, "objective");
    const nextTask = formText(formData, "nextTask");
    const knowledgeId = formText(formData, "knowledgeId");
    const mistakeId = formText(formData, "mistakeId");
    await tutoring.addPlan({
      linkedKnowledgeIds: knowledgeId ? [knowledgeId] : [],
      linkedMistakeIds: mistakeId ? [mistakeId] : [],
      nextPracticeAt: tomorrowISO(),
      nextTask: nextTask || "完成一次 10 分钟实时辅导，并整理一个薄弱点。",
      objective: objective || "围绕当前薄弱点进行一对一讲解。",
      status: "active",
      title,
    });
    event.currentTarget.reset();
  }

  return (
    <div className="grid gap-5">
      <Panel eyebrow="AI TUTOR" title="AI 辅导">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm leading-6 text-muted">
            浏览器 MVP 用摄像头、屏幕共享或截图模拟眼镜视角。默认不保存原始音视频和连续画面，只保存文字稿、摘要、建议和用户确认的关联。
          </p>
          {(!textConnection || !visionConnection) && (
            <Button variant="primary" onClick={onOpenSettings}>
              配置 AI 连接
            </Button>
          )}
        </div>
        <StatGrid>
          <MetricCard label="辅导记录" value={tutoring.snapshot.sessions.length} hint="本地文字稿与摘要" tone="text-blue" />
          <MetricCard label="辅导计划" value={tutoring.snapshot.plans.length} hint="下次任务与目标" tone="text-green" />
          <MetricCard label="资料关联" value={tutoring.snapshot.links.length} hint="知识库 / 错题" tone="text-yellow" />
          <MetricCard label="采样策略" value={sampler.enabled ? `${sampler.intervalMs / 1000}s` : "手动"} hint="低频关键帧" tone="text-blue" />
          <MetricCard label="隐私模式" value="摘要" hint="不存原始音视频" tone="text-red" />
        </StatGrid>
        <Toolbar className="mt-5">
          <SegmentedTabs active={tab} items={tabs} onChange={setTab} />
        </Toolbar>
      </Panel>

      {tab === "live" && (
        <LiveTutoringView
          busy={tutoring.busy}
          draftText={draftText || speech.transcript}
          frameDescription={frameDescription}
          media={media}
          sampler={sampler}
          session={tutoring.activeSession}
          sessionGoal={sessionGoal}
          sessionTopic={sessionTopic}
          speech={speech}
          textReady={Boolean(textConnection)}
          turns={tutoring.activeTurns}
          visionReady={Boolean(visionConnection)}
          onCaptureFrame={captureCurrentFrame}
          onCreateSession={createSession}
          onFinishSession={() => tutoring.activeSession && void tutoring.finishSession(tutoring.activeSession)}
          onOpenSettings={onOpenSettings}
          onSetDraftText={setDraftText}
          onSetFrameDescription={setFrameDescription}
          onSetSessionGoal={setSessionGoal}
          onSetSessionTopic={setSessionTopic}
          onSubmitTurn={() => void submitTutorTurn()}
          onUpdateSessionStatus={tutoring.updateSessionStatus}
        />
      )}

      {tab === "records" && (
        <TutoringRecordsView
          sessions={tutoring.snapshot.sessions}
          turnsBySessionId={tutoring.turnsBySessionId}
          onDeleteSession={tutoring.deleteSession}
          onOpenSession={(id) => {
            tutoring.setActiveSessionId(id);
            setTab("live");
          }}
        />
      )}

      {tab === "plans" && (
        <TutoringPlansView
          knowledgeEntries={knowledgeEntries}
          mistakes={mistakes}
          plans={tutoring.snapshot.plans}
          selectedPlan={selectedPlan}
          onAddPlan={addPlan}
          onDeletePlan={tutoring.deletePlan}
          onSelectPlan={setSelectedPlanId}
          onUpdatePlan={tutoring.updatePlan}
        />
      )}

      {tab === "links" && (
        <TutoringLinksView
          knowledgeEntries={knowledgeEntries}
          links={activeLinks}
          mistakes={mistakes}
          session={tutoring.activeSession}
          onAddLink={tutoring.addLink}
          onDeleteLink={tutoring.deleteLink}
          onOpenRecords={() => setTab("records")}
        />
      )}

      {tab === "devices" && (
        <TutoringDeviceView
          mediaMode={media.mode}
          samplerEnabled={sampler.enabled}
          samplerIntervalMs={sampler.intervalMs}
          onSetSamplerInterval={sampler.setIntervalMs}
        />
      )}
    </div>
  );
}

// 渲染实时辅导主界面，包含画面源、会话目标、文字稿和 AI 老师对话。
function LiveTutoringView({
  busy,
  draftText,
  frameDescription,
  media,
  sampler,
  session,
  sessionGoal,
  sessionTopic,
  speech,
  textReady,
  turns,
  visionReady,
  onCaptureFrame,
  onCreateSession,
  onFinishSession,
  onOpenSettings,
  onSetDraftText,
  onSetFrameDescription,
  onSetSessionGoal,
  onSetSessionTopic,
  onSubmitTurn,
  onUpdateSessionStatus,
}: {
  busy: boolean;
  draftText: string;
  frameDescription: string;
  media: TutoringMediaController;
  sampler: TutoringSamplerController;
  session: TutoringSession | null;
  sessionGoal: string;
  sessionTopic: string;
  speech: TutoringSpeechController;
  textReady: boolean;
  turns: TutoringTurn[];
  visionReady: boolean;
  onCaptureFrame: () => void;
  onCreateSession: () => void;
  onFinishSession: () => void;
  onOpenSettings: () => void;
  onSetDraftText: (value: string) => void;
  onSetFrameDescription: (value: string) => void;
  onSetSessionGoal: (value: string) => void;
  onSetSessionTopic: (value: string) => void;
  onSubmitTurn: () => void;
  onUpdateSessionStatus: (session: TutoringSession, status: TutoringSession["status"]) => Promise<void>;
}) {
  const activeTurnRequiresVision = Boolean(sampler.lastFrameDataUrl || media.hasFrame || frameDescription.trim());
  const canSubmitToAi = activeTurnRequiresVision ? visionReady : textReady;
  const missingConnectionText = activeTurnRequiresVision
    ? "当前轮次包含画面，必须配置默认多模态连接后才能发送文本 + 图像。"
    : "请先配置默认文本连接后再发送纯文本辅导。";
  return (
    <div className="tutoring-live-grid">
      <Panel className="min-h-[34rem]" eyebrow="VIEW" title="眼镜视角模拟">
        <DevicePreview
          lastFrameDataUrl={sampler.lastFrameDataUrl}
          mode={media.mode}
          status={media.status}
          sourceLabel={media.sourceLabel}
          uploadedFileName={media.uploadedFileName}
          videoRef={media.videoRef}
        />
        <div className="mt-4 grid gap-3">
          <Toolbar>
            <Button size="sm" variant={media.mode === "camera" && (media.status === "starting" || media.status === "ready") ? "primary" : "outline"} onClick={() => void media.startCamera()}>
              摄像头
            </Button>
            <Button size="sm" variant={media.mode === "screen" && (media.status === "starting" || media.status === "ready") ? "primary" : "outline"} onClick={() => void media.startScreen()}>
              屏幕共享
            </Button>
            <label className="ui-button ui-button-outline ui-button-sm cursor-pointer">
              上传截图
              <input
                accept="image/*"
                className="sr-only"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void media.uploadFrame(file);
                }}
              />
            </label>
          </Toolbar>
          <Toolbar>
            <Button size="sm" variant="soft" onClick={onCaptureFrame}>
              看这里
            </Button>
            <Button size="sm" variant={sampler.enabled ? "primary" : "outline"} onClick={() => sampler.setEnabled(!sampler.enabled)}>
              {sampler.enabled ? "停止实时观察" : "开启实时观察"}
            </Button>
            <Button size="sm" variant="ghost" onClick={media.stop}>
              停止设备
            </Button>
          </Toolbar>
          {(media.error || sampler.error) && <p className="text-sm text-red">{media.error || sampler.error}</p>}
          {media.notice && !media.error ? <p className="text-sm text-muted" role="status">{media.notice}</p> : null}
          {media.mode === "screen" && media.status === "ready" ? <p className="text-xs text-muted">仅发送当前关键帧，不上传连续视频或系统音频。</p> : null}
          <TextAreaField label="画面补充说明" value={frameDescription} placeholder="例如：题目在左上角，我卡在第二步公式转换。" onChange={onSetFrameDescription} />
        </div>
      </Panel>

      <Panel className="min-h-[34rem]" eyebrow="CLASSROOM" title="AI 老师">
        <FormGrid>
          <TextField label="辅导主题" value={sessionTopic} onChange={onSetSessionTopic} />
          <TextAreaField label="本场目标" value={sessionGoal} onChange={onSetSessionGoal} />
        </FormGrid>
        <Toolbar className="mt-3">
          <Button disabled={Boolean(session)} variant="primary" onClick={onCreateSession}>
            创建会话
          </Button>
          {session && session.status !== "completed" && (
            <>
              <Button variant="outline" onClick={() => void onUpdateSessionStatus(session, session.status === "paused" ? "active" : "paused")}>
                {session.status === "paused" ? "继续" : "暂停"}
              </Button>
              <Button disabled={busy} variant="danger" onClick={onFinishSession}>
                结束并总结
              </Button>
            </>
          )}
          {!canSubmitToAi && (
            <Button variant="soft" onClick={onOpenSettings}>
              去配置 AI 连接
            </Button>
          )}
        </Toolbar>

        <SoftBlock className="mt-4">
          {session ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Chip tone="blue">{modeLabels[session.mode]}</Chip>
              <Chip tone={session.status === "completed" ? "green" : "yellow"}>{statusLabels[session.status]}</Chip>
              <Chip>关键帧 {session.frameCount}</Chip>
              <Chip>轮次 {session.turnCount}</Chip>
            </div>
          ) : (
            <p className="text-sm text-muted">先选择画面来源并创建会话，再发送问题给 AI 老师。</p>
          )}
        </SoftBlock>
        {!canSubmitToAi ? (
          <SoftBlock className="mt-3">
            <p className="text-sm leading-6 text-muted">{missingConnectionText}</p>
          </SoftBlock>
        ) : activeTurnRequiresVision ? (
          <p className="mt-3 text-xs text-muted">本轮会把学生输入和当前关键帧一起发送给默认多模态连接。</p>
        ) : null}

        <ConversationList turns={turns} />

        <div className="mt-4 grid gap-3">
          <TextAreaField label="学生输入 / 语音转写" value={draftText} placeholder="说出或输入你现在看不懂的地方。" onChange={onSetDraftText} />
          <Toolbar>
            <Button size="sm" variant={speech.listening ? "primary" : "outline"} onClick={speech.listening ? speech.stop : speech.start}>
              {speech.listening ? "停止转写" : "语音转写"}
            </Button>
            <Button size="sm" variant="ghost" onClick={speech.reset}>
              清空语音稿
            </Button>
            <Button disabled={!session || busy || !canSubmitToAi} variant="primary" onClick={onSubmitTurn}>
              {busy ? "分析中..." : "发送给 AI 老师"}
            </Button>
          </Toolbar>
          {speech.error && <p className="text-sm text-red">{speech.error}</p>}
        </div>
      </Panel>

      <Panel className="min-h-[34rem]" eyebrow="NOTES" title="课堂笔记">
        <TutorNotes turns={turns} session={session} />
      </Panel>
    </div>
  );
}

// 渲染画面预览，上传图片和实时视频共用同一块视觉区域。
function DevicePreview({
  lastFrameDataUrl,
  mode,
  sourceLabel,
  status,
  uploadedFileName,
  videoRef,
}: {
  lastFrameDataUrl: string;
  mode: TutoringMode;
  sourceLabel: string;
  status: string;
  uploadedFileName: string;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const hasPreviewSource = status === "ready";

  return (
    <div className="tutoring-preview">
      {mode === "upload" && lastFrameDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 这里渲染的是本轮内存关键帧 data URL，不适合交给 next/image 优化或持久化。
        <img alt="当前上传截图" className="h-full w-full object-contain" src={lastFrameDataUrl} />
      ) : mode === "upload" && uploadedFileName ? (
        <div className="grid h-full place-items-center p-6 text-center text-muted">
          <span>已选择 {uploadedFileName}，点击“看这里”生成本轮关键帧。</span>
        </div>
      ) : (
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
      )}
      {!hasPreviewSource && (
        <div className="absolute inset-0 grid place-items-center bg-surface-muted/80 p-6 text-center text-sm text-muted">
          选择摄像头、屏幕共享或上传截图，模拟未来眼镜传输的第一视角。
        </div>
      )}
      {hasPreviewSource && sourceLabel ? <span className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-black/65 px-3 py-1 text-xs text-white">{sourceLabel}</span> : null}
    </div>
  );
}

// 渲染课堂对话列表，AI 轮次会额外展示板书和追问。
function ConversationList({ turns }: { turns: TutoringTurn[] }) {
  if (!turns.length) {
    return <EmptyState>暂无对话。创建会话后，可以发送文字、语音转写或当前关键帧。</EmptyState>;
  }
  return (
    <DataList className="mt-4 max-h-[24rem] overflow-y-auto pr-1">
      {turns.map((turn) => (
        <article key={turn.id} className={`rounded-2xl border border-line p-3 ${turn.speaker === "ai_tutor" ? "bg-blue/5" : "bg-surface"}`}>
          <div className="flex items-center justify-between gap-3">
            <strong>{turn.speaker === "student" ? "学生" : turn.speaker === "ai_tutor" ? "AI 老师" : "系统"}</strong>
            <span className="text-xs text-muted">{formatDateTime(turn.createdAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{turn.content}</p>
          {turn.detectedProblem && <p className="mt-2 text-sm text-yellow">发现：{turn.detectedProblem}</p>}
          {turn.nextQuestion && <p className="mt-2 text-sm text-blue">追问：{turn.nextQuestion}</p>}
        </article>
      ))}
    </DataList>
  );
}

// 汇总 AI 老师生成的板书、问题定位和下一步动作，模拟真实课堂右侧笔记区。
function TutorNotes({ session, turns }: { session: TutoringSession | null; turns: TutoringTurn[] }) {
  const aiTurns = turns.filter((turn) => turn.speaker === "ai_tutor");
  const latestAiTurn = aiTurns.at(-1);
  return (
    <div className="grid gap-4">
      {session?.summary ? (
        <DetailBlock title="课后摘要">
          <p>{session.summary}</p>
        </DetailBlock>
      ) : (
        <SoftBlock>
          <p className="text-sm leading-6 text-muted">课堂结束前这里会持续显示最新板书、问题定位和下一步动作；结束后会保存摘要。</p>
        </SoftBlock>
      )}
      <DetailBlock title="最新板书">
        {latestAiTurn?.boardNotes?.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {latestAiTurn.boardNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">等待 AI 老师生成板书。</p>
        )}
      </DetailBlock>
      <DetailBlock title="下一步动作">
        <p>{latestAiTurn?.studentAction || session?.nextActions[0] || "发送一轮问题后，AI 会给出下一步动作。"}</p>
      </DetailBlock>
      <Timeline
        items={[
          { id: "setup", title: "选择视角", done: Boolean(session) },
          { id: "observe", title: "低频观察", active: Boolean(session && session.status === "active") },
          { id: "teach", title: "讲解追问", done: aiTurns.length > 0 },
          { id: "summary", title: "课后摘要", done: Boolean(session?.summary) },
        ]}
      />
    </div>
  );
}

// 渲染辅导记录列表，记录中只展示文字稿和摘要，不出现媒体文件入口。
function TutoringRecordsView({
  sessions,
  turnsBySessionId,
  onDeleteSession,
  onOpenSession,
}: {
  sessions: TutoringSession[];
  turnsBySessionId: Map<string, TutoringTurn[]>;
  onDeleteSession: (id: string) => void;
  onOpenSession: (id: string) => void;
}) {
  if (!sessions.length) return <EmptyState>暂无辅导记录。完成一次实时辅导后会出现在这里。</EmptyState>;
  return (
    <Panel eyebrow="RECORDS" title="辅导记录">
      <DataList>
        {sessions.map((session) => {
          const turns = turnsBySessionId.get(session.id) ?? [];
          return (
            <DataRow key={session.id}>
              <div className="min-w-0">
                <strong className="block truncate">{session.topic}</strong>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{session.summary || session.transcriptText || "尚未生成摘要"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip tone="blue">{modeLabels[session.mode]}</Chip>
                  <Chip>{statusLabels[session.status]}</Chip>
                  <Chip>{turns.length} 轮</Chip>
                  <Chip>{formatDateTime(session.startedAt)}</Chip>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="soft" onClick={() => onOpenSession(session.id)}>
                  打开
                </Button>
                <Button size="sm" variant="danger" onClick={() => onDeleteSession(session.id)}>
                  删除
                </Button>
              </div>
            </DataRow>
          );
        })}
      </DataList>
    </Panel>
  );
}

// 渲染辅导计划列表和创建表单，计划用于把实时辅导沉淀成下一步学习任务。
function TutoringPlansView({
  knowledgeEntries,
  mistakes,
  plans,
  selectedPlan,
  onAddPlan,
  onDeletePlan,
  onSelectPlan,
  onUpdatePlan,
}: {
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  plans: TutoringPlan[];
  selectedPlan: TutoringPlan | null;
  onAddPlan: (event: SubmitReactEvent) => void;
  onDeletePlan: (id: string) => void;
  onSelectPlan: (id: string) => void;
  onUpdatePlan: (id: string, patch: Partial<Omit<TutoringPlan, "id" | "createdAt" | "updatedAt">>) => Promise<void>;
}) {
  return (
    <div className="ui-content-grid">
      <Panel eyebrow="PLAN" title="新建辅导计划">
        <form className="grid gap-3" onSubmit={onAddPlan}>
          <TextField label="计划名称" name="title" placeholder="例如：资料分析公式辅导" />
          <TextAreaField label="辅导目标" name="objective" placeholder="希望 AI 老师重点讲什么、纠正什么。" />
          <TextAreaField label="下一步任务" name="nextTask" placeholder="例如：完成 3 道同类题，并复述解题步骤。" />
          <SelectField label="关联知识" name="knowledgeId" options={[["", "暂不关联"], ...knowledgeEntries.map((entry): [string, string] => [entry.id, entry.title])]} />
          <SelectField label="关联错题" name="mistakeId" options={[["", "暂不关联"], ...mistakes.slice(0, 40).map((mistake): [string, string] => [mistake.id, mistake.stem])]} />
          <Button type="submit" variant="primary">
            保存计划
          </Button>
        </form>
      </Panel>

      <Panel eyebrow="NEXT" title="计划列表">
        <DataList>
          {plans.length ? (
            plans.map((plan) => (
              <CardButton key={plan.id} active={selectedPlan?.id === plan.id} onClick={() => onSelectPlan(plan.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate">{plan.title}</strong>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{plan.objective}</p>
                  </div>
                  <Chip tone={plan.status === "completed" ? "green" : "blue"}>{plan.status}</Chip>
                </div>
              </CardButton>
            ))
          ) : (
            <EmptyState>暂无辅导计划</EmptyState>
          )}
        </DataList>
        {selectedPlan && (
          <SoftBlock className="mt-4">
            <DetailBlock title="下一步任务">
              <p>{selectedPlan.nextTask}</p>
            </DetailBlock>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="soft" onClick={() => void onUpdatePlan(selectedPlan.id, { status: selectedPlan.status === "completed" ? "active" : "completed" })}>
                {selectedPlan.status === "completed" ? "重新启用" : "标记完成"}
              </Button>
              <Button size="sm" variant="danger" onClick={() => onDeletePlan(selectedPlan.id)}>
                删除计划
              </Button>
            </div>
          </SoftBlock>
        )}
      </Panel>
    </div>
  );
}

// 渲染当前会话的知识库和错题关联，只有用户确认后才写入 tutoringLinks。
function TutoringLinksView({
  knowledgeEntries,
  links,
  mistakes,
  session,
  onAddLink,
  onDeleteLink,
  onOpenRecords,
}: {
  knowledgeEntries: KnowledgeEntry[];
  links: TutoringLink[];
  mistakes: Mistake[];
  session: TutoringSession | null;
  onAddLink: (input: Omit<TutoringLink, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onDeleteLink: (id: string) => void;
  onOpenRecords: () => void;
}) {
  async function addLink(event: SubmitReactEvent) {
    event.preventDefault();
    if (!session) return;
    const formData = new FormData(event.currentTarget);
    const target = formText(formData, "target");
    if (!target) return;
    const [targetType, targetId] = target.split(":") as ["knowledge" | "mistake", string];
    await onAddLink({
      evidence: [session.topic],
      reason: formText(formData, "reason") || "本场辅导中需要反复参考",
      score: 0.72,
      sourceId: session.id,
      sourceType: "session",
      targetId,
      targetType,
    });
    event.currentTarget.reset();
  }

  const targetOptions: Array<[string, string]> = [
    ["", "选择要关联的资料或错题"],
    ...knowledgeEntries.map((entry): [string, string] => [`knowledge:${entry.id}`, `知识：${entry.title}`]),
    ...mistakes.slice(0, 80).map((mistake): [string, string] => [`mistake:${mistake.id}`, `错题：${mistake.stem}`]),
  ];

  if (!session) {
    return (
      <Panel eyebrow="LINKS" title="资料关联">
        <EmptyState>
          先打开或创建一场辅导会话，再关联知识库和错题。
          <div className="mt-3">
            <Button variant="soft" onClick={onOpenRecords}>
              查看记录
            </Button>
          </div>
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="ui-content-grid">
      <Panel eyebrow="ADD LINK" title="添加关联">
        <form className="grid gap-3" onSubmit={addLink}>
          <SoftBlock>
            <strong>{session.topic}</strong>
            <p className="mt-1 text-sm text-muted">只保存用户确认后的关联，AI 不会自动污染知识库或错题库。</p>
          </SoftBlock>
          <SelectField label="关联目标" name="target" options={targetOptions} />
          <TextAreaField label="关联理由" name="reason" placeholder="例如：本次讲解一直围绕这个知识点。" />
          <Button type="submit" variant="primary">
            保存关联
          </Button>
        </form>
      </Panel>
      <Panel eyebrow="CONFIRMED" title="已确认关联">
        <DataList>
          {links.length ? (
            links.map((link) => (
              <DataRow key={link.id}>
                <div className="min-w-0">
                  <strong>{link.targetType === "knowledge" ? "知识资料" : "错题"}</strong>
                  <p className="mt-1 text-sm text-muted">{link.reason}</p>
                </div>
                <Button size="sm" variant="danger" onClick={() => onDeleteLink(link.id)}>
                  删除
                </Button>
              </DataRow>
            ))
          ) : (
            <EmptyState>暂无确认关联</EmptyState>
          )}
        </DataList>
      </Panel>
    </div>
  );
}

// 渲染设备设置和未来眼镜接入路线，当前只展示真实可用的浏览器输入源。
function TutoringDeviceView({
  mediaMode,
  samplerEnabled,
  samplerIntervalMs,
  onSetSamplerInterval,
}: {
  mediaMode: TutoringMode;
  samplerEnabled: boolean;
  samplerIntervalMs: number;
  onSetSamplerInterval: (value: number) => void;
}) {
  return (
    <Panel eyebrow="DEVICES" title="设备与成本策略">
      <div className="ui-card-grid">
        <SoftBlock>
          <strong>当前输入源</strong>
          <p className="mt-2 text-sm text-muted">{modeLabels[mediaMode]}。第一阶段用浏览器能力模拟眼镜视角，降低硬件接入成本。</p>
        </SoftBlock>
        <SoftBlock>
          <strong>低频采样</strong>
          <p className="mt-2 text-sm text-muted">当前为 {samplerEnabled ? `${samplerIntervalMs / 1000} 秒一次` : "手动采样"}，只上传关键帧，不推送连续视频。</p>
        </SoftBlock>
        <SoftBlock>
          <strong>未来眼镜桥接</strong>
          <p className="mt-2 text-sm text-muted">预留“眼镜/手机伴侣应用 → 本地桥接 → Web 前端”路线，后续替换 transport 即可。</p>
        </SoftBlock>
      </div>
      <Toolbar className="mt-4 justify-start">
        {[1000, 2000, 3000, 5000].map((value) => (
          <Button key={value} size="sm" variant={samplerIntervalMs === value ? "primary" : "outline"} onClick={() => onSetSamplerInterval(value)}>
            {value / 1000}s
          </Button>
        ))}
      </Toolbar>
    </Panel>
  );
}
