export type WorkspaceDataScope =
  | { kind: "personal" }
  | { kind: "ui-review" }
  | { kind: "sample"; scenarioId: string };

export const PERSONAL_WORKSPACE_DATA_SCOPE: WorkspaceDataScope = { kind: "personal" };
export const UI_REVIEW_WORKSPACE_DATA_SCOPE: WorkspaceDataScope = { kind: "ui-review" };
export const LEGACY_SAMPLE_ID_PREFIX = "sample:";
export const UI_REVIEW_ID_PREFIX = "ui-review:";
export const SAMPLE_ID_PREFIX = UI_REVIEW_ID_PREFIX;

export function sampleRecordId(scenarioId: string, localId: string): string {
  return `${SAMPLE_ID_PREFIX}${scenarioId}:${localId}`;
}

export function uiReviewRecordId(packId: string, localId: string): string {
  return `${UI_REVIEW_ID_PREFIX}${packId}:${localId}`;
}

export function isUiReviewRecordId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(UI_REVIEW_ID_PREFIX));
}

export function isSampleRecordId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(UI_REVIEW_ID_PREFIX) || id?.startsWith(LEGACY_SAMPLE_ID_PREFIX));
}

export function recordMatchesWorkspaceDataScope(
  record: { id?: string; mistakeId?: string; knowledgeId?: string },
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): boolean {
  // 新提交的尝试使用随机 ID，仍必须继承学习对象的审查数据来源。
  const subjectId = record.mistakeId ?? record.knowledgeId;
  if (scope.kind === "personal") return !isSampleRecordId(record.id) && !isSampleRecordId(subjectId);
  if (scope.kind === "ui-review") return isUiReviewRecordId(record.id) || isUiReviewRecordId(subjectId);
  return Boolean(
    record.id?.startsWith(`${UI_REVIEW_ID_PREFIX}${scope.scenarioId}:`)
    || record.id?.startsWith(`${LEGACY_SAMPLE_ID_PREFIX}${scope.scenarioId}:`),
  );
}

export function filterWorkspaceRecords<T extends { id?: string }>(
  records: T[],
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): T[] {
  return records.filter((record) => recordMatchesWorkspaceDataScope(record, scope));
}
