import { createDiagnosticCaptureMechanism } from "./capture-authority-core.ts";

// Production-capable 内部机制；无产品调用路径，不是已批准的 admission owner。
// 默认时钟和随机身份在内部提供，caller 只能定位规格并提交 response。
export const FIRST_PARTY_DIAGNOSTIC_CAPTURE = createDiagnosticCaptureMechanism({
  generateAttemptId: () => globalThis.crypto.randomUUID(),
  now: () => Date.now(),
});
