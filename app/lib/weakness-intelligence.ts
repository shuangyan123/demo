import type {
  LearningErrorCause,
  LearningEvent,
  LearningEventOutcome,
  LearningEventSubjectType,
} from "../types/domains/learning-event.ts";

export const WEAKNESS_HISTORY_DAYS = 8;

const OUTCOME_STRENGTH: Record<LearningEventOutcome, number> = {
  correct: 1,
  uncertain: 2,
  wrong: 3,
};

const GENERIC_REASON_KEYS = new Set(["待归因", "其他", "其它", "未知", "不清楚", "未分类"]);

export const LEARNING_ERROR_CAUSE_LABELS: Record<Exclude<LearningErrorCause, "other">, string> = {
  knowledge_gap: "知识缺口",
  memory_lapse: "记忆遗忘",
  method_selection: "方法选择",
  comprehension: "理解偏差",
  calculation: "计算错误",
  careless: "粗心疏漏",
  time_pressure: "时间压力",
  changed_answer: "改答失误",
};

export type WeaknessSubjectInput = {
  subjectType: LearningEventSubjectType;
  subjectId: string;
  mastery: number;
  nextReviewAt?: string;
  updatedAt: string;
  reasons?: readonly string[];
};

export type WeaknessStudyDay = {
  date: string;
  outcome: LearningEventOutcome;
  events: LearningEvent[];
};

export type WeaknessSubjectAssessment = {
  subjectType: LearningEventSubjectType;
  subjectId: string;
  mastery: number;
  nextReviewAt?: string;
  updatedAt: string;
  due: boolean;
  latestOutcome?: LearningEventOutcome;
  wrongDays: number;
  uncertainDays: number;
  correctStreak: number;
  riskScore: number;
  currentlyWeak: boolean;
  studyDays: WeaknessStudyDay[];
};

export type WeaknessSubjectRef = Pick<WeaknessSubjectInput, "subjectType" | "subjectId">;

export type WeaknessRepeatedReasonCluster = {
  key: string;
  label: string;
  subjects: WeaknessSubjectRef[];
  recentFailureSubjects: WeaknessSubjectRef[];
  score: number;
};

export type WeaknessErrorCause = Exclude<LearningErrorCause, "other">;

export type WeaknessErrorCauseCluster = {
  cause: WeaknessErrorCause;
  label: string;
  subjects: WeaknessSubjectRef[];
  recentFailureDays: number;
  evidenceEvents: LearningEvent[];
  score: number;
};

export type WeaknessIntelligenceInput = {
  subjects: readonly WeaknessSubjectInput[];
  learningEvents: readonly LearningEvent[];
  today: Date;
};

export type WeaknessIntelligence = {
  subjects: WeaknessSubjectAssessment[];
  repeatedReasonClusters: WeaknessRepeatedReasonCluster[];
  errorCauseClusters: WeaknessErrorCauseCluster[];
};

/** 持久化掌握度 1..5 的只读排序分；不把派生百分分写回领域记录。 */
export function masteryLevelToScore(value: number): number {
  const level = Math.max(1, Math.min(5, Number.isFinite(value) ? value : 1));
  return Math.round(((level - 1) / 4) * 100);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function subjectKey(subject: WeaknessSubjectRef): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

function compareSubjectRefs(left: WeaknessSubjectRef, right: WeaknessSubjectRef): number {
  return left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId);
}

function compareSubjects(left: WeaknessSubjectInput, right: WeaknessSubjectInput): number {
  return subjectKey(left).localeCompare(subjectKey(right))
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.mastery - left.mastery
    || (right.nextReviewAt ?? "").localeCompare(left.nextReviewAt ?? "")
    || [...(left.reasons ?? [])].toSorted().join("\u001f").localeCompare([...(right.reasons ?? [])].toSorted().join("\u001f"));
}

function stableEventSignature(event: LearningEvent): string {
  return [
    event.id,
    event.sourceType,
    event.sourceId,
    event.subjectType,
    event.subjectId,
    event.outcome,
    event.observedAt,
    event.masteryAfter ?? "",
    event.durationSec ?? "",
    event.selfConfidence ?? "",
    event.hintCount ?? "",
    event.errorCause ?? "",
    event.attemptOrdinal ?? "",
    event.practiceKind ?? "",
  ].join("\u001f");
}

function eventSourceKey(event: LearningEvent): string {
  return `${event.sourceType}:${event.sourceId}`;
}

function compareEventsNewest(left: LearningEvent, right: LearningEvent): number {
  return right.observedAt.localeCompare(left.observedAt)
    || OUTCOME_STRENGTH[right.outcome] - OUTCOME_STRENGTH[left.outcome]
    || left.sourceType.localeCompare(right.sourceType)
    || left.sourceId.localeCompare(right.sourceId)
    || left.id.localeCompare(right.id)
    || stableEventSignature(left).localeCompare(stableEventSignature(right));
}

function uniqueSubjects(subjects: readonly WeaknessSubjectInput[]): WeaknessSubjectInput[] {
  const unique = new Map<string, WeaknessSubjectInput>();
  for (const subject of [...subjects].toSorted(compareSubjects)) {
    const key = subjectKey(subject);
    if (!unique.has(key)) unique.set(key, subject);
  }
  return [...unique.values()].toSorted(compareSubjects);
}

/** 同一来源只保留一条 canonical event，避免投影重复影响历史与证据。 */
function uniqueEvents(events: readonly LearningEvent[]): LearningEvent[] {
  const unique = new Map<string, LearningEvent>();
  for (const event of [...events].toSorted((left, right) => (
    eventSourceKey(left).localeCompare(eventSourceKey(right))
      || stableEventSignature(left).localeCompare(stableEventSignature(right))
  ))) {
    const key = eventSourceKey(event);
    if (!unique.has(key)) unique.set(key, event);
  }
  return [...unique.values()].toSorted(compareEventsNewest);
}

function validStudyDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) ? undefined : date;
}

function isDue(value: string | undefined, today: Date): boolean {
  const dueDate = validStudyDate(value);
  return dueDate !== undefined && dueDate <= today.toISOString().slice(0, 10);
}

function collapseStudyDays(events: readonly LearningEvent[]): WeaknessStudyDay[] {
  const byDate = new Map<string, LearningEvent[]>();
  for (const event of events) {
    const date = validStudyDate(event.observedAt);
    if (!date || !OUTCOME_STRENGTH[event.outcome]) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  }

  return [...byDate.entries()]
    .map(([date, dateEvents]) => {
      const sortedEvents = dateEvents.toSorted(compareEventsNewest);
      const outcome = sortedEvents
        .toSorted((left, right) => OUTCOME_STRENGTH[right.outcome] - OUTCOME_STRENGTH[left.outcome] || compareEventsNewest(left, right))[0]!.outcome;
      return { date, outcome, events: sortedEvents };
    })
    .toSorted((left, right) => right.date.localeCompare(left.date))
    .slice(0, WEAKNESS_HISTORY_DAYS);
}

function latestOutcomeAdjustment(outcome: LearningEventOutcome | undefined): number {
  return outcome === "wrong" ? 16 : outcome === "uncertain" ? 8 : 0;
}

function isFailureOutcome(outcome: LearningEventOutcome | undefined): boolean {
  return outcome === "wrong" || outcome === "uncertain";
}

function deriveSubjectAssessment(subject: WeaknessSubjectInput, events: readonly LearningEvent[], today: Date): WeaknessSubjectAssessment {
  const studyDays = collapseStudyDays(events);
  const latestOutcome = studyDays[0]?.outcome;
  const wrongDays = studyDays.filter((day) => day.outcome === "wrong").length;
  const uncertainDays = studyDays.filter((day) => day.outcome === "uncertain").length;
  const correctStreak = studyDays.findIndex((day) => day.outcome !== "correct");
  const resolvedCorrectStreak = correctStreak === -1 ? studyDays.length : correctStreak;
  const due = isDue(subject.nextReviewAt, today);
  const masteryRisk = 100 - masteryLevelToScore(subject.mastery);
  const riskScore = clampScore(
    masteryRisk
      + latestOutcomeAdjustment(latestOutcome)
      + Math.min(18, wrongDays * 6 + uncertainDays * 3)
      + (due ? 4 : 0)
      - Math.min(12, resolvedCorrectStreak * 4),
  );
  const recoveryGuard = subject.mastery >= 3
    && !due
    && studyDays.length >= 2
    && studyDays[0]?.outcome === "correct"
    && studyDays[1]?.outcome === "correct";

  return {
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    mastery: subject.mastery,
    ...(subject.nextReviewAt !== undefined ? { nextReviewAt: subject.nextReviewAt } : {}),
    updatedAt: subject.updatedAt,
    due,
    latestOutcome,
    wrongDays,
    uncertainDays,
    correctStreak: resolvedCorrectStreak,
    riskScore,
    currentlyWeak: !recoveryGuard && (subject.mastery <= 2 || isFailureOutcome(latestOutcome) || due),
    studyDays,
  };
}

function normalizeReason(reason: string): { key: string; label: string } | undefined {
  const label = reason.trim();
  const key = label.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  if (!key || GENERIC_REASON_KEYS.has(key)) return undefined;
  return { key, label: label.slice(0, 80) };
}

function subjectRef(subject: WeaknessSubjectInput): WeaknessSubjectRef {
  return { subjectType: subject.subjectType, subjectId: subject.subjectId };
}

function deriveRepeatedReasonClusters(
  subjects: readonly WeaknessSubjectInput[],
  assessments: readonly WeaknessSubjectAssessment[],
): WeaknessRepeatedReasonCluster[] {
  const assessmentsByKey = new Map(assessments.map((assessment) => [subjectKey(assessment), assessment]));
  const groups = new Map<string, { labels: Set<string>; subjects: Map<string, WeaknessSubjectRef> }>();

  for (const subject of subjects) {
    if (subject.subjectType !== "mistake" || !assessmentsByKey.get(subjectKey(subject))?.currentlyWeak) continue;
    const reasons = new Map<string, string>();
    for (const reason of subject.reasons ?? []) {
      const normalized = normalizeReason(reason);
      if (normalized) reasons.set(normalized.key, normalized.label);
    }
    for (const [key, label] of reasons) {
      const group = groups.get(key) ?? { labels: new Set<string>(), subjects: new Map<string, WeaknessSubjectRef>() };
      group.labels.add(label);
      group.subjects.set(subjectKey(subject), subjectRef(subject));
      groups.set(key, group);
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const groupSubjects = [...group.subjects.values()].toSorted(compareSubjectRefs);
      const recentFailureSubjects = groupSubjects.filter((item) => isFailureOutcome(assessmentsByKey.get(subjectKey(item))?.latestOutcome));
      return {
        key,
        label: [...group.labels].toSorted((left, right) => left.localeCompare(right))[0] ?? key,
        subjects: groupSubjects,
        recentFailureSubjects,
        score: clampScore(56 + Math.min(28, groupSubjects.length * 7) + Math.min(12, recentFailureSubjects.length * 3)),
      };
    })
    .filter((cluster) => cluster.subjects.length >= 2)
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

function isWeaknessErrorCause(value: LearningErrorCause | undefined): value is WeaknessErrorCause {
  return value !== undefined && value !== "other" && Object.hasOwn(LEARNING_ERROR_CAUSE_LABELS, value);
}

function compareCauseEvidence(left: LearningEvent, right: LearningEvent): number {
  return OUTCOME_STRENGTH[right.outcome] - OUTCOME_STRENGTH[left.outcome] || compareEventsNewest(left, right);
}

function deriveErrorCauseClusters(
  assessments: readonly WeaknessSubjectAssessment[],
): WeaknessErrorCauseCluster[] {
  const groups = new Map<string, {
    subjects: Map<string, WeaknessSubjectRef>;
    days: Set<string>;
    evidenceBySubjectDay: Map<string, LearningEvent>;
  }>();

  for (const assessment of assessments) {
    const ref = { subjectType: assessment.subjectType, subjectId: assessment.subjectId } satisfies WeaknessSubjectRef;
    for (const day of assessment.studyDays) {
      for (const event of day.events) {
        if (!isFailureOutcome(event.outcome) || !isWeaknessErrorCause(event.errorCause)) continue;
        const group = groups.get(event.errorCause) ?? {
          subjects: new Map<string, WeaknessSubjectRef>(),
          days: new Set<string>(),
          evidenceBySubjectDay: new Map<string, LearningEvent>(),
        };
        const key = subjectKey(ref);
        const subjectDayKey = `${key}\u001f${day.date}`;
        group.subjects.set(key, ref);
        group.days.add(subjectDayKey);
        const existing = group.evidenceBySubjectDay.get(subjectDayKey);
        if (!existing || compareCauseEvidence(event, existing) < 0) group.evidenceBySubjectDay.set(subjectDayKey, event);
        groups.set(event.errorCause, group);
      }
    }
  }

  return [...groups.entries()]
    .map(([cause, group]) => {
      const subjects = [...group.subjects.values()].toSorted(compareSubjectRefs);
      const evidenceEvents = [...group.evidenceBySubjectDay.values()].toSorted(compareEventsNewest);
      return {
        cause: cause as WeaknessErrorCause,
        label: LEARNING_ERROR_CAUSE_LABELS[cause as WeaknessErrorCause],
        subjects,
        recentFailureDays: group.days.size,
        evidenceEvents,
        score: clampScore(58 + Math.min(21, subjects.length * 7) + Math.min(18, group.days.size * 3)),
      };
    })
    .filter((cluster) => cluster.subjects.length >= 2)
    .toSorted((left, right) => left.cause.localeCompare(right.cause));
}

/** 只读、确定性的薄弱与显式错因智能；不访问 Dexie，也不写回任何状态。 */
export function deriveWeaknessIntelligence(input: WeaknessIntelligenceInput): WeaknessIntelligence {
  const subjects = uniqueSubjects(input.subjects);
  const events = uniqueEvents(input.learningEvents);
  const assessments = subjects.map((subject) => deriveSubjectAssessment(
    subject,
    events.filter((event) => event.subjectType === subject.subjectType && event.subjectId === subject.subjectId),
    input.today,
  ));
  return {
    subjects: assessments,
    repeatedReasonClusters: deriveRepeatedReasonClusters(subjects, assessments),
    errorCauseClusters: deriveErrorCauseClusters(assessments),
  };
}
