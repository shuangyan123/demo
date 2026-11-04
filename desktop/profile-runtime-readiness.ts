import { existsSync, watch } from "node:fs";
import path from "node:path";
import type { StorageHostPaths } from "./storage-bootstrap.ts";
import { hasUnanchoredStorage, isPristineProfile, storagePathBinding } from "./storage-inspection.ts";

type RuntimeReadiness = { kind: "ready" } | { kind: "unavailable"; code: "storage_unavailable"; reason: string };
const failure = (reason: string): RuntimeReadiness => ({ kind: "unavailable", code: "storage_unavailable", reason });
const INITIAL_RUNTIME_DEADLINE_MS = 20_000;

/** Windows Chromium 在 Ready 后延迟落盘 Local State；弹窗前只读等待，不能刷新已授权候选来容忍变化。 */
export async function waitForInitialProfileRuntime(paths: StorageHostPaths): Promise<RuntimeReadiness> {
  try {
    const binding = JSON.stringify(storagePathBinding(paths));
    if (hasUnanchoredStorage(paths) || !isPristineProfile(paths.defaultUserData)) return failure("profile_not_pristine");
    if (process.platform !== "win32") return { kind: "ready" };
    const localState = path.join(paths.defaultUserData, "Local State");
    const validate = (): RuntimeReadiness => {
      if (JSON.stringify(storagePathBinding(paths)) !== binding) return failure("initial_runtime_binding_changed");
      if (hasUnanchoredStorage(paths) || !isPristineProfile(paths.defaultUserData)) return failure("profile_not_pristine");
      return existsSync(localState) ? { kind: "ready" } : failure("initial_runtime_unavailable");
    };
    if (existsSync(localState)) return validate();
    return await new Promise<RuntimeReadiness>(resolve => {
      let settled = false;
      const finish = (result: RuntimeReadiness) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        watcher.close();
        resolve(result);
      };
      const check = () => {
        try {
          if (JSON.stringify(storagePathBinding(paths)) !== binding || hasUnanchoredStorage(paths))
            finish(failure("initial_runtime_binding_changed"));
          else if (existsSync(localState)) finish(validate());
        } catch { finish(failure("initial_runtime_unavailable")); }
      };
      const watcher = watch(paths.defaultUserData, check);
      const deadline = setTimeout(() => {
        try { finish(validate()); } catch { finish(failure("initial_runtime_unavailable")); }
      }, INITIAL_RUNTIME_DEADLINE_MS);
      watcher.once("error", () => finish(failure("initial_runtime_unavailable")));
      // 防止文件在 watch 建立前完成原子发布；不轮询、不创建或删除运行时文件。
      check();
    });
  } catch { return failure("initial_runtime_unavailable"); }
}
