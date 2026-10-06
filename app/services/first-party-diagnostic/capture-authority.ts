import { createControlledDiagnosticCaptureMechanism, createDiagnosticCaptureMechanism } from "./capture-authority-core.ts";

// 未受控的普通机制；其 unknown captures 不由固定 production owner 查找。
// 默认时钟和随机身份在内部提供，caller 只能定位规格并提交 response。
export const FIRST_PARTY_DIAGNOSTIC_CAPTURE = createDiagnosticCaptureMechanism({
  generateAttemptId: () => globalThis.crypto.randomUUID(),
  now: () => Date.now(),
});

/** 固定 server surface 专用；依赖不接受 caller 注入，未受控的普通 facade 仍保持 unknown。 */
export function createControlledDiagnosticCapture() {
  return createControlledDiagnosticCaptureMechanism({
    generateAttemptId: () => globalThis.crypto.randomUUID(),
    now: () => Date.now(),
  });
}
