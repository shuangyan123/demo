/** 浏览器只能请求固定导出，不接收路径、Host identity 或 Repository capability。 */
export async function requestDiagnosticHistoryExport(): Promise<string> {
  const response = await fetch("/api/diagnostic/export", {
    method: "POST", headers: { "x-recall-export-intent": "diagnostic-history" },
    credentials: "same-origin", cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("诊断学习历史导出未完成；请确认桌面历史可用，或在保存结束后手动重试。现有资料保持不变。");
  return response.text();
}
