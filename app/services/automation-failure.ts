import type { AutomationFailureCategory, AutomationRecoveryAction } from "../types/domains/automation.ts";
import { automationExecutionCause, AutomationAuthorizationError } from "./automation-errors.ts";

export type AutomationFailureDiagnosis = {
  category: AutomationFailureCategory;
  recoveryAction: AutomationRecoveryAction;
  message: string;
};

const CATEGORY_TEXT: Record<AutomationFailureCategory, string> = {
  missing_connection: "缺少默认文本连接",
  network: "网络不可用或请求中断",
  permission: "浏览器或 Vault 权限异常",
  model: "模型服务返回异常",
  empty_scope: "可读取数据为空",
  unknown: "未知错误",
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "自动化执行失败";
}

function authorizationFailureMessage(error: AutomationAuthorizationError): string {
  const result = error.authorization;
  const details = [
    result.missingPermissions.length ? `MCP 工具：${result.missingPermissions.join("、")}` : "",
    result.disabledResources.length ? `已停用资源：${result.disabledResources.join("、")}` : "",
    result.staleResources.length ? `待重新发现资源：${result.staleResources.join("、")}` : "",
    result.invalidScopes.length ? `无效来源声明：${result.invalidScopes.join("、")}` : "",
  ].filter(Boolean);
  return details.length ? `无人值守授权未满足：${details.join("；")}` : "无人值守来源声明无效，请检查任务配置";
}

/** 将原始异常归类为用户可恢复的自动化错误。 */
export function classifyAutomationError(inputError: unknown, options: { online?: boolean } = {}): AutomationFailureDiagnosis {
  const error = automationExecutionCause(inputError);
  if (error instanceof AutomationAuthorizationError) {
    const needsMcp = error.authorization.reasonCodes.some((code) => code.startsWith("mcp_"));
    return {
      category: "permission",
      recoveryAction: needsMcp ? "configure_mcp" : "configure_automation",
      message: authorizationFailureMessage(error),
    };
  }
  if (error instanceof Error && "recoveryDiagnosis" in error) {
    const providerFailure = error as Error & {
      recoveryDiagnosis: Pick<AutomationFailureDiagnosis, "category" | "recoveryAction">;
    };
    return {
      ...providerFailure.recoveryDiagnosis,
      // AiProviderFailureError 构造器统一写入产品安全文案；Automation 不读取厂商原始错误。
      message: providerFailure.message,
    };
  }
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  if (message.includes("默认文本连接") || message.includes("AI 连接") || normalized.includes("connection")) {
    return { category: "missing_connection", recoveryAction: "configure_ai_connection", message };
  }
  if (options.online === false || /failed to fetch|networkerror|network request|offline|断网|网络/.test(normalized)) {
    return { category: "network", recoveryAction: "check_network", message };
  }
  if (/mcp/.test(normalized) && /授权|权限|server|工具|tool/.test(normalized)) {
    return { category: "permission", recoveryAction: "configure_mcp", message };
  }
  if (/notallowed|permission|security|vault|obsidian|directory|授权|权限/.test(normalized)) {
    return { category: "permission", recoveryAction: "open_knowledge", message };
  }
  if (/api|model|provider|http|json|token|key|quota|rate|模型|密钥|供应商/.test(normalized)) {
    return { category: "model", recoveryAction: "configure_ai_connection", message };
  }
  if (/至少选择|暂无可读取|没有可读取|empty|no data/.test(normalized)) {
    return { category: "empty_scope", recoveryAction: "open_import", message };
  }
  return { category: "unknown", recoveryAction: "retry", message };
}

/** 将失败分类展示为详情页中的稳定中文标签。 */
export function automationFailureLabel(category?: AutomationFailureCategory): string {
  return category ? CATEGORY_TEXT[category] : CATEGORY_TEXT.unknown;
}

/** 恢复动作只做导航或提示，不直接触发外部请求。 */
export function automationRecoveryLabel(action?: AutomationRecoveryAction): string {
  if (action === "configure_ai_connection") return "配置 AI 连接";
  if (action === "configure_mcp") return "检查 MCP 定时授权";
  if (action === "configure_automation") return "修正已安排来源";
  if (action === "open_knowledge") return "打开知识库";
  if (action === "open_import") return "导入资料";
  if (action === "open_entry") return "手动录入";
  if (action === "check_network") return "检查网络后重试";
  if (action === "retry") return "稍后重试";
  return "无需操作";
}
