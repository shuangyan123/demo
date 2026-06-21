import type { AiCapability, ApiConnectionProfile, ApiSetting } from "../types/review";
import { getProviderContract } from "./provider-contracts.ts";

// 把旧版单连接设置转换成新连接档案；复用原密文，避免迁移过程接触 API Key 明文。
export function createProfileFromLegacySetting(setting: ApiSetting): ApiConnectionProfile {
  const contract = getProviderContract(setting.provider);
  return {
    id: "legacy-default",
    label: `${contract.label} 默认连接`,
    provider: setting.provider,
    apiFormat: contract.apiFormat,
    baseUrl: setting.baseUrl,
    model: setting.model,
    capabilities: [...contract.capabilities] as AiCapability[],
    encryptedKey: setting.encryptedKey,
    iv: setting.iv,
    maskedKey: setting.maskedKey,
    providerOptions: {},
    testStatus: setting.testStatus,
    testMessage: setting.testMessage,
    createdAt: setting.updatedAt,
    updatedAt: setting.updatedAt,
  };
}
