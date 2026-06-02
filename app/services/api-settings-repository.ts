import { reviewDb } from "../db/review-db";
import { toISODate } from "../lib/review-utils";
import type { ApiProvider, ApiSetting } from "../types/review";
import { encryptSecret, maskSecret } from "./crypto-service";

// 保存应用内 API 设置，并把明文 Key 加密后写入 IndexedDB。
export async function saveApiSetting(input: {
  provider: ApiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  today: Date;
}): Promise<ApiSetting> {
  const encrypted = await encryptSecret(input.apiKey);
  const setting: ApiSetting = {
    id: "default",
    provider: input.provider,
    baseUrl: input.baseUrl.replace(/\/$/, ""),
    model: input.model,
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    maskedKey: maskSecret(input.apiKey),
    testStatus: "idle",
    updatedAt: toISODate(input.today),
  };
  await reviewDb.apiSettings.put(setting);
  return setting;
}

// 写入最近一次 API 连接测试结果，方便设置页展示成功或失败原因。
export async function updateApiSettingTestStatus(status: "success" | "failed", message: string) {
  await reviewDb.apiSettings.update("default", {
    testStatus: status,
    testMessage: message,
  });
}
