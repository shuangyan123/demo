import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { ApiConnectionProfile, ApiSetting } from "../types/domains/ai-connection.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME } from "./crypto-service.ts";
import { createDefaultPersonalizationSettings, personalizationSettingsRepository } from "./personalization-settings-repository.ts";
import { resetSecretMigrationForTests } from "./secret-migration-service.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";

const today = new Date("2026-06-19T08:00:00.000Z");
const localStorageValues = new Map<string, string>();

const localStorageMock: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear: () => localStorageValues.clear(),
  getItem: (key) => localStorageValues.get(key) ?? null,
  key: (index) => [...localStorageValues.keys()][index] ?? null,
  removeItem: (key) => void localStorageValues.delete(key),
  setItem: (key, value) => void localStorageValues.set(key, value),
};

Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: localStorageMock } });

async function resetDatabase() {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
  resetSecretMigrationForTests();
}

async function createLegacyKey(): Promise<void> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  localStorageMock.setItem(
    LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME,
    JSON.stringify(await crypto.subtle.exportKey("jwk", key)),
  );
}

test("旧 apiSettings 设置迁移后只作为兼容桥且不会在删除后复活", async () => {
  await resetDatabase();
  const legacySetting: ApiSetting = {
    id: "default",
    provider: "openai",
    baseUrl: "https://api.example/v1",
    model: "legacy-model",
    encryptedKey: "legacy-ciphertext",
    iv: "legacy-iv",
    maskedKey: "****-old",
    updatedAt: today.toISOString(),
  };
  await reviewDb.apiSettings.put(legacySetting);

  const migrated = await aiConnectionsRepository.loadSnapshot(today);
  assert.equal(migrated.profiles.length, 1);
  assert.equal(migrated.profiles[0].encryptedKey, legacySetting.encryptedKey);
  assert.equal(migrated.profiles[0].iv, legacySetting.iv);
  assert.equal(migrated.defaults.textConnectionId, "legacy-default");
  assert.equal(migrated.defaults.visionConnectionId, "legacy-default");
  assert.equal(migrated.defaults.speechConnectionId, "legacy-default");

  await aiConnectionsRepository.setDefault("text", undefined, today);
  assert.equal(await reviewDb.apiSettings.get("default"), undefined);
  await aiConnectionsRepository.removeProfile("legacy-default", today);
  const afterDelete = await aiConnectionsRepository.loadSnapshot(today);
  assert.deepEqual(afterDelete.profiles, []);
  assert.equal(afterDelete.defaults.textConnectionId, undefined);
});

test("旧个性化语音连接一次性迁移为默认语音连接", async () => {
  await resetDatabase();
  const speechProfile: ApiConnectionProfile = {
    id: "speech-profile",
    label: "旧语音连接",
    provider: "elevenlabs",
    apiFormat: "chat_completions",
    baseUrl: "https://speech.example/v1",
    model: "speech-model",
    capabilities: ["speech"],
    encryptedKey: "ciphertext",
    iv: "iv",
    maskedKey: "****-voice",
    providerOptions: {},
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
  const personalization = {
    ...createDefaultPersonalizationSettings(today),
    voice: {
      mode: "cloud",
      language: "zh-CN",
      localVoiceUri: "legacy-system-voice",
      rate: 1.1,
      pitch: 1.2,
      volume: 0.8,
      cloudConnectionId: speechProfile.id,
      cloudModel: "legacy-speech-model",
      cloudVoiceId: "legacy-voice",
      cloudStyle: "耐心",
      fallbackToSystem: true,
    },
  } as unknown as PersonalizationSettings;
  await reviewDb.apiConnectionProfiles.put(speechProfile);
  await reviewDb.personalizationSettings.put(personalization);

  const migrated = await aiConnectionsRepository.loadSnapshot(today);
  assert.equal(migrated.defaults.speechConnectionId, speechProfile.id);
  const personalized = await personalizationSettingsRepository.load(today);
  assert.equal("voice" in personalized, false);
  assert.equal(personalized.personaCustomizations[personalized.defaultPersonaId]?.voice?.voiceId, "legacy-voice");
  assert.equal(personalized.personaCustomizations[personalized.defaultPersonaId]?.voice?.model, "legacy-speech-model");
});

test("OpenAI 兼容本地语音连接允许无 API Key 并保存为无鉴权", async () => {
  await resetDatabase();
  localStorageValues.clear();
  const profile = await aiConnectionsRepository.saveProfile({
    label: "本地 TTS",
    provider: "custom",
    capabilities: ["speech"],
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "",
    today,
  });

  assert.deepEqual(profile.capabilities, ["speech"]);
  assert.equal("model" in profile, false);
  assert.equal(profile.maskedKey, "无鉴权");
  assert.equal(await aiConnectionsRepository.resolveSecret(profile), "");
});

test("读取快照会清理不存在或能力不匹配的默认连接", async () => {
  await resetDatabase();
  const speechProfile: ApiConnectionProfile = {
    id: "speech-only",
    label: "仅语音",
    provider: "custom",
    apiFormat: "chat_completions",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-tts",
    capabilities: ["speech"],
    encryptedKey: "ciphertext",
    iv: "iv",
    maskedKey: "无鉴权",
    providerOptions: {},
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
  await reviewDb.apiConnectionProfiles.put(speechProfile);
  await reviewDb.apiConnectionDefaults.put({
    id: "default",
    textConnectionId: speechProfile.id,
    visionConnectionId: "missing-profile",
    speechConnectionId: speechProfile.id,
    updatedAt: today.toISOString(),
  });

  const snapshot = await aiConnectionsRepository.loadSnapshot(today);
  assert.equal(snapshot.defaults.textConnectionId, undefined);
  assert.equal(snapshot.defaults.visionConnectionId, undefined);
  assert.equal(snapshot.defaults.speechConnectionId, speechProfile.id);
  assert.deepEqual(await reviewDb.apiConnectionDefaults.get("default"), snapshot.defaults);
});

test("官方 Google 连接在读写边界补齐多模态能力，自定义连接保持用户声明", async () => {
  await resetDatabase();
  const googleProfile: ApiConnectionProfile = {
    id: "google-old",
    label: "旧 Gemini",
    provider: "google",
    apiFormat: "google_generate_content",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    capabilities: ["text"],
    encryptedKey: "ciphertext",
    iv: "iv",
    maskedKey: "****-key",
    providerOptions: {},
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
  await reviewDb.apiConnectionProfiles.put(googleProfile);
  const loaded = await aiConnectionsRepository.loadSnapshot(today);
  assert.equal(loaded.profiles[0].capabilities.includes("vision"), true);
  assert.equal((await reviewDb.apiConnectionProfiles.get(googleProfile.id))?.capabilities.includes("vision"), true);

  localStorageValues.clear();
  const custom = await aiConnectionsRepository.saveProfile({
    label: "自定义文本",
    provider: "custom",
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "",
    capabilities: ["text"],
    today,
  });
  assert.deepEqual(custom.capabilities, ["text"]);
});

test("无关旧 MCP 凭据损坏时新 Google 连接仍保存厂商且保留旧 JWK", async () => {
  await resetDatabase();
  localStorageValues.clear();
  await createLegacyKey();
  const brokenMcp: McpServerProfile = {
    id: "broken-mcp",
    label: "损坏 MCP",
    endpoint: "https://mcp.example",
    enabled: true,
    authMode: "bearer",
    encryptedToken: "broken-cipher",
    encryptedTokenIv: "broken-iv",
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
  localStorageMock.setItem(secretStorageLocations.mcpSettings, JSON.stringify({ profiles: [brokenMcp], discovery: {} }));

  const profile = await aiConnectionsRepository.saveProfile({
    label: "Google Gemini",
    provider: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "new-google-secret",
    today,
  });

  assert.equal(profile.provider, "google");
  assert.match(profile.encryptedKey, /^v2:/);
  assert.notEqual(localStorageMock.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME), null);
  assert.equal((await aiConnectionsRepository.loadSnapshot(today)).profiles.some((item) => item.id === profile.id), true);
});

test("切换已有连接厂商必须提供新 Key 并原地更新同一记录", async () => {
  await resetDatabase();
  localStorageValues.clear();
  const original = await aiConnectionsRepository.saveProfile({
    label: "主连接",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "openai-secret",
    today,
  });

  await assert.rejects(
    aiConnectionsRepository.saveProfile({
      id: original.id,
      label: original.label,
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "",
      today,
    }),
    /切换厂商后必须重新输入 API Key/,
  );
  assert.equal((await reviewDb.apiConnectionProfiles.get(original.id))?.provider, "openai");

  const updated = await aiConnectionsRepository.saveProfile({
    id: original.id,
    label: original.label,
    provider: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "google-secret",
    today,
  });
  assert.equal(updated.id, original.id);
  assert.equal(updated.provider, "google");
  assert.equal(await reviewDb.apiConnectionProfiles.count(), 1);
  assert.equal(await aiConnectionsRepository.resolveSecret(updated), "google-secret");
});

test("编辑默认文本连接会同步旧表，移除文本能力时会清理默认值和旧记录", async () => {
  await resetDatabase();
  localStorageValues.clear();
  const profile = await aiConnectionsRepository.saveProfile({
    label: "本地多模态",
    provider: "custom",
    capabilities: ["text", "vision"],
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "",
    today,
  });
  await aiConnectionsRepository.setDefaultSelection("text", profile.id, "model-v1", today);
  await aiConnectionsRepository.setDefault("vision", profile.id, today);

  await aiConnectionsRepository.saveProfile({
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    capabilities: ["text", "vision"],
    baseUrl: profile.baseUrl,
    apiKey: "",
    today,
  });
  assert.equal((await reviewDb.apiSettings.get("default"))?.model, "model-v1");

  await aiConnectionsRepository.saveProfile({
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    capabilities: ["vision"],
    baseUrl: profile.baseUrl,
    apiKey: "",
    today,
  });
  const snapshot = await aiConnectionsRepository.loadSnapshot(today);
  assert.equal(snapshot.defaults.textConnectionId, undefined);
  assert.equal(snapshot.defaults.visionConnectionId, profile.id);
  assert.equal(await reviewDb.apiSettings.get("default"), undefined);
});

test("核心业务文件不再依赖旧 apiSetting 或兼容请求器", async () => {
  const files = [
    "../features/review/review-workspace.tsx",
    "../features/interview/use-interview-data.ts",
    "../features/tutoring/use-tutoring-flow.ts",
    "../features/settings/api-connections-settings-view.tsx",
    "../features/import/use-import-drafts.ts",
    "./interview-ai-service.ts",
    "./tutoring-ai-service.ts",
    "./fenbi-import-service.ts",
    "./ai-association-service.ts",
  ];
  const sources = await Promise.all(files.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /\bapiSetting\b|\bApiSetting\b|callOpenAiCompatibleApi|callAiGenerate|resolveSecret\(/);
  }
  await assert.rejects(readFile(new URL("../api/ai/route.ts", import.meta.url), "utf8"));
});

test("朗读主流程不再引用浏览器系统音色或静默回退", async () => {
  const files = [
    "../features/shared/use-connection-speech-playback.ts",
    "../features/shared/use-speech-session.ts",
    "../features/settings/personalization-settings-view.tsx",
    "../features/interview/use-interview-speech.ts",
    "../features/tutoring/use-tutoring-speech.ts",
  ];
  const sources = await Promise.all(files.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance|localVoiceUri|fallbackToSystem|voice\.mode\b/);
  }
});

test("辅导关键帧严格使用多模态连接且缺失时给出明确提示", async () => {
  const source = await readFile(new URL("../features/tutoring/use-tutoring-flow.ts", import.meta.url), "utf8");
  assert.match(source, /input\.frameDataUrl \? visionConnection : textConnection/);
  assert.match(source, /请先在 AI 连接中配置默认多模态连接，再分析当前画面/);
  assert.match(source, /请先在 AI 连接中配置默认文本连接，再使用 AI 辅导/);
});

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
  Reflect.deleteProperty(globalThis, "window");
});
