import { createDiagnosticRuntime, type DiagnosticRuntime } from "./runtime-core.ts";
import { parseDiagnosticStorageConfig } from "./storage-config.ts";

const RUNTIME_KEY = Symbol.for("recall.durable-diagnostic.runtime.v1");
const serverGlobal = globalThis as typeof globalThis & { [RUNTIME_KEY]?: DiagnosticRuntime };

/** 窄的受信 server composition seam；独立集成测试可显式提供 Host config/故障 IO。
 * 已存在 runtime 时拒绝替换；HTTP、renderer 与其他 consumer 不能调用此内部入口。
 */
export function composeDiagnosticRuntime(config: Parameters<typeof createDiagnosticRuntime>[0],
  open?: Parameters<typeof createDiagnosticRuntime>[1]): DiagnosticRuntime {
  if (serverGlobal[RUNTIME_KEY]) throw new Error("diagnostic_runtime_already_composed");
  return serverGlobal[RUNTIME_KEY] = createDiagnosticRuntime(config, open);
}

/** 同一 Node process 的 page/route bundles 共用一个 writer 与 issuer；不从 renderer 接收配置。 */
export function initializeDiagnosticRuntime(): DiagnosticRuntime {
  if (!serverGlobal[RUNTIME_KEY]) {
    const parsed = parseDiagnosticStorageConfig(process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP);
    composeDiagnosticRuntime(parsed.kind === "configured" ? parsed.config : undefined);
  }
  return serverGlobal[RUNTIME_KEY]!;
}

/** Owner 只读 startup/commit 已验证的索引；admission 内不初始化、不读文件。 */
export function diagnosticOwnerAttempt(attemptId: string) { return serverGlobal[RUNTIME_KEY]?.resolveAttempt(attemptId); }

/** 关闭 runtime 生命周期（供独立进程/集成 contracts）；不删除 durable 文件。 */
export function closeDiagnosticRuntime(): void {
  serverGlobal[RUNTIME_KEY]?.close();
  delete serverGlobal[RUNTIME_KEY];
}
