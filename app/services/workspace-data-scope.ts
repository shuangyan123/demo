export type WorkspaceDataScope =
  | { kind: "personal" }
  | { kind: "sample"; scenarioId: string };

export const PERSONAL_WORKSPACE_DATA_SCOPE: WorkspaceDataScope = { kind: "personal" };
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
  record: { id?: string },
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): boolean {
  if (scope.kind === "personal") return !record.id?.startsWith(LEGACY_SAMPLE_ID_PREFIX);
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
