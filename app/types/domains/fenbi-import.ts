/** 粉笔实验直连凭据；Cookie 仅以本机 AES-GCM 密文保存。 */
export type FenbiImportCredential = {
  encryptedCookie: string;
  iv: string;
  maskedCookie: string;
  verifiedAt?: string;
  lastSyncAt?: string;
  lastSyncScope?: string;
};

/** 粉笔错题同步范围；第一阶段始终只读取错题。 */
export type FenbiSyncScope = {
  keypointIds?: string[];
  wrongOnly: true;
  sinceDays?: number;
};

/** 粉笔账户同步的流式事件，不包含 Cookie 或上游原始响应。 */
export type FenbiSyncEvent<TDraft = unknown> =
  | { type: "stage"; stage: "validate" | "catalog" | "questions" | "normalize" }
  | { type: "progress"; completed: number; total?: number }
  | { type: "drafts"; drafts: TDraft[] }
  | { type: "done"; parsed: number; duplicates: number; pending: number }
  | { type: "error"; code: string; message: string };
