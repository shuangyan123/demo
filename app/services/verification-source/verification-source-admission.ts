import type { VerificationSourceAdmissionResultV1 } from "../../types/domains/verification-source.ts";
import { admitFromAuthorizedSource, type AuthorizedVerificationSourceOwner } from "./verification-source-admission-core.ts";

// 当前没有独立批准的生产来源；无注册 API，也不读取 caller、插件、模型或导入包提供的 owner。
const AUTHORIZED_VERIFICATION_SOURCE_OWNERS: readonly AuthorizedVerificationSourceOwner[] = Object.freeze([]);

/** 公共入口只定位 source/spec/attempt；不接收 resolver，不读取或证明完整历史，不执行验证。 */
export function admitVerifiedAssessment(request: unknown): VerificationSourceAdmissionResultV1 {
  return admitFromAuthorizedSource(request, (id) => AUTHORIZED_VERIFICATION_SOURCE_OWNERS.find((owner) => owner.id === id));
}
