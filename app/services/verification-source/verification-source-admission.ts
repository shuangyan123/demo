import type { VerificationSourceAdmissionResultV1 } from "../../types/domains/verification-source.ts";
import { admitFromAuthorizedSource, type AuthorizedVerificationSourceOwner } from "./verification-source-admission-core.ts";
import { FIRST_PARTY_DIAGNOSTIC_SOURCE_OWNER } from "../../server/diagnostic/source-owner.ts";

// 唯一批准来源是固定 controlled surface；无注册 API，不读取 caller/插件提供的 owner。
const AUTHORIZED_VERIFICATION_SOURCE_OWNERS: readonly AuthorizedVerificationSourceOwner[] = Object.freeze([FIRST_PARTY_DIAGNOSTIC_SOURCE_OWNER]);

/** 公共入口只定位 source/spec/attempt；不接收 resolver，不读取或证明完整历史，不执行验证。 */
export function admitVerifiedAssessment(request: unknown): VerificationSourceAdmissionResultV1 {
  return admitFromAuthorizedSource(request, (id) => AUTHORIZED_VERIFICATION_SOURCE_OWNERS.find((owner) => owner.id === id));
}
