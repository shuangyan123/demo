export type AutomationAuthorizationErrorPayload = {
  status: "ready" | "blocked" | "invalid";
  reasonCodes: readonly string[];
  missingPermissions: readonly string[];
  disabledResources: readonly string[];
  staleResources: readonly string[];
  invalidScopes: readonly string[];
};

/** 授权解析失败与运行期失败分离，避免调度器把阻断误报为普通模型错误。 */
export class AutomationAuthorizationError extends Error {
  readonly authorization: AutomationAuthorizationErrorPayload;

  constructor(authorization: AutomationAuthorizationErrorPayload) {
    super("自动化外部授权前置条件未满足");
    this.name = "AutomationAuthorizationError";
    this.authorization = authorization;
  }
}
