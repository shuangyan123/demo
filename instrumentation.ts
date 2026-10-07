/** standalone Node startup 先加载完整 owner snapshot；缺失 storage 时保留 typed unavailable。 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeDiagnosticRuntime } = await import("./app/server/diagnostic/runtime.ts");
    initializeDiagnosticRuntime();
  }
}
