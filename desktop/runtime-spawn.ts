export type RuntimeSpawnFailureCode =
  | "RUNTIME_SPAWN_ACCESS_DENIED"
  | "RUNTIME_SPAWN_BUSY"
  | "RUNTIME_SPAWN_MISSING"
  | "RUNTIME_SPAWN_INVALID_EXECUTABLE"
  | "RUNTIME_SPAWN_UNKNOWN";

export type RuntimeSpawnFailureDetails = {
  code: RuntimeSpawnFailureCode;
  nodeCode?: string;
  syscall?: string;
};

export class RuntimeSpawnFailure extends Error {
  readonly details: RuntimeSpawnFailureDetails;
  readonly attempts: number;

  constructor(details: RuntimeSpawnFailureDetails, attempts: number, cause?: unknown) {
    super("Desktop runtime spawn failed", { cause });
    this.name = "RuntimeSpawnFailure";
    this.details = details;
    this.attempts = attempts;
  }
}

function errorProperty(error: unknown, property: "code" | "syscall" | "message"): string {
  if (!error || typeof error !== "object" || !(property in error)) return "";
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : "";
}

export function classifyRuntimeSpawnFailure(error: unknown): RuntimeSpawnFailureDetails {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  const source = cause ?? error;
  const nodeCode = errorProperty(source, "code");
  const syscall = errorProperty(source, "syscall");
  const message = errorProperty(source, "message");
  if (nodeCode === "EACCES" || nodeCode === "EPERM") return { code: "RUNTIME_SPAWN_ACCESS_DENIED", nodeCode, syscall };
  if (nodeCode === "EBUSY") return { code: "RUNTIME_SPAWN_BUSY", nodeCode, syscall };
  if (nodeCode === "ENOENT") return { code: "RUNTIME_SPAWN_MISSING", nodeCode, syscall };
  if (nodeCode === "ENOEXEC" || nodeCode === "EINVAL" || /not a valid win32 application|bad exe format/i.test(message)) {
    return { code: "RUNTIME_SPAWN_INVALID_EXECUTABLE", nodeCode: nodeCode || undefined, syscall };
  }
  return { code: "RUNTIME_SPAWN_UNKNOWN", nodeCode: nodeCode || undefined, syscall: syscall || undefined };
}

export function isRetryableRuntimeSpawnFailure(code: RuntimeSpawnFailureCode): boolean {
  return code === "RUNTIME_SPAWN_ACCESS_DENIED" || code === "RUNTIME_SPAWN_BUSY" || code === "RUNTIME_SPAWN_MISSING";
}

/** 首次失败只对安装器/杀软可能造成的瞬时 spawn 错误重试一次。 */
export async function runWithRuntimeSpawnRetry<T>(
  operation: (attempt: number) => Promise<T>,
  wait: (milliseconds: number) => Promise<void>,
  retryDelayMs = 450,
): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const details = classifyRuntimeSpawnFailure(error);
      if (attempt === 1 && isRetryableRuntimeSpawnFailure(details.code)) {
        await wait(retryDelayMs);
        continue;
      }
      throw new RuntimeSpawnFailure(details, attempt, error);
    }
  }
  throw new RuntimeSpawnFailure({ code: "RUNTIME_SPAWN_UNKNOWN" }, 2);
}
