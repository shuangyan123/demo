export type WorkspaceDataScope =
  | { kind: "personal" }
  | { kind: "sample"; scenarioId: string };

export const PERSONAL_WORKSPACE_DATA_SCOPE: WorkspaceDataScope = { kind: "personal" };
export const SAMPLE_ID_PREFIX = "sample:";

export function sampleRecordId(scenarioId: string, localId: string): string {
  return `${SAMPLE_ID_PREFIX}${scenarioId}:${localId}`;
}

export function isSampleRecordId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(SAMPLE_ID_PREFIX));
}

export function recordMatchesWorkspaceDataScope(
  record: { id?: string },
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): boolean {
  if (scope.kind === "personal") return !isSampleRecordId(record.id);
  return Boolean(record.id?.startsWith(`${SAMPLE_ID_PREFIX}${scope.scenarioId}:`));
}

export function filterWorkspaceRecords<T extends { id?: string }>(
  records: T[],
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): T[] {
  return records.filter((record) => recordMatchesWorkspaceDataScope(record, scope));
}
