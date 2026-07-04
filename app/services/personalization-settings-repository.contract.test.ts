import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { PersonalizationSettings } from "../types/review.ts";
import {
  BUILT_IN_PERSONAS,
  createCustomPersonaDraft,
  createDefaultPersonalizationSettings,
  getPersonaImageValidationError,
  normalizePersonalizationSettings,
  personalizationSettingsRepository,
  removeCustomPersona,
  resolvePersona,
  resolvePersonaVoice,
} from "./personalization-settings-repository.ts";

const today = new Date("2026-06-19T08:00:00.000Z");

test("旧闪卡模式、头像和音色字典迁移到定制记录", () => {
  const migrated = normalizePersonalizationSettings({
    personaDisplayMode: "flashcard",
    personaAvatarDataUrls: { "patient-teacher": "data:image/png;base64,abc" },
    personaVoices: { "patient-teacher": { voiceId: "teacher", rate: 1.1, volume: 0.8 } },
  }, today);
  assert.equal(migrated.personaDisplayMode, "custom");
  assert.equal("personaCardRatio" in migrated, false);
  assert.equal(migrated.personaCustomizations["patient-teacher"].imageDataUrl, "data:image/png;base64,abc");
  assert.equal(migrated.personaCustomizations["patient-teacher"].voice?.voiceId, "teacher");
});

test("旧卡片比例被移除并统一使用固定 2:3 布局", () => {
  assert.equal("personaCardRatio" in normalizePersonalizationSettings({ personaCardRatio: "1:1" }, today), false);
  assert.equal("personaCardRatio" in normalizePersonalizationSettings({ personaCardRatio: "invalid" }, today), false);
});

test("定制人设视图默认使用闪卡并只接受已知模式", () => {
  assert.equal(createDefaultPersonalizationSettings(today).customPersonaViewMode, "flashcard");
  assert.equal(normalizePersonalizationSettings({ customPersonaViewMode: "avatar" }, today).customPersonaViewMode, "avatar");
  assert.equal(normalizePersonalizationSettings({ customPersonaViewMode: "unknown" as "avatar" }, today).customPersonaViewMode, "flashcard");
});

test("定制人设视图与既有图片数据在保存后保持", async () => {
  await reviewDb.personalizationSettings.clear();
  const settings = createDefaultPersonalizationSettings(today);
  settings.customPersonaViewMode = "avatar";
  settings.personaCustomizations["patient-teacher"] = { imageDataUrl: "data:image/webp;base64,legacy-three-four" };
  await personalizationSettingsRepository.save(settings, today);
  const reloaded = await personalizationSettingsRepository.load(today);
  assert.equal(reloaded.customPersonaViewMode, "avatar");
  assert.equal(reloaded.personaCustomizations["patient-teacher"].imageDataUrl, "data:image/webp;base64,legacy-three-four");
});

test("新建角色先创建未持久化草稿且不冒充内置人设", () => {
  const draft = createCustomPersonaDraft("draft-id");
  assert.equal(draft.id, "draft-id");
  assert.equal(draft.name, "未命名角色");
  assert.equal(draft.builtIn, false);
});

test("人设文本覆盖与专属音色优先级正确", () => {
  const settings = createDefaultPersonalizationSettings(today);
  settings.personaCustomizations["patient-teacher"] = {
    name: "定制讲师",
    teachingStyle: "先画结构图再解释",
    voice: { model: "tts", voiceId: "persona-voice", style: "calm", rate: 1.05, volume: 0.9 },
  };
  const persona = resolvePersona(settings, "tutoring");
  assert.equal(persona.name, "定制讲师");
  assert.equal(persona.teachingStyle, "先画结构图再解释");
  assert.equal(resolvePersonaVoice(settings, "tutoring")?.voiceId, "persona-voice");

  delete settings.personaCustomizations["patient-teacher"].voice;
  assert.equal(resolvePersonaVoice(settings, "tutoring"), undefined);
});

test("旧全局音色一次性复制到全部人设且删除后不会复活", async () => {
  await reviewDb.personalizationSettings.clear();
  await reviewDb.personalizationSettings.put({
    ...createDefaultPersonalizationSettings(today),
    voice: { model: "tts", voiceId: "legacy-global", style: "calm", rate: 1, volume: 1 },
    personaCardRatio: "1:1",
  } as unknown as PersonalizationSettings);

  const migrated = await personalizationSettingsRepository.load(today);
  for (const persona of BUILT_IN_PERSONAS) assert.equal(migrated.personaCustomizations[persona.id]?.voice?.voiceId, "legacy-global");
  const stored = await reviewDb.personalizationSettings.get("default");
  assert.equal(Boolean(stored && "voice" in stored), false);
  assert.equal(Boolean(stored && "personaCardRatio" in stored), false);

  delete migrated.personaCustomizations[BUILT_IN_PERSONAS[0].id].voice;
  await personalizationSettingsRepository.save(migrated, today);
  const reloaded = await personalizationSettingsRepository.load(today);
  assert.equal(resolvePersonaVoice(reloaded, "tutoring"), undefined);
});

test("角色图片限制接受 PNG JPEG WebP 且拒绝超限或错误类型", () => {
  assert.equal(getPersonaImageValidationError({ type: "image/png", size: 1024 }), undefined);
  assert.equal(getPersonaImageValidationError({ type: "image/jpeg", size: 1024 }), undefined);
  assert.equal(getPersonaImageValidationError({ type: "image/webp", size: 1024 }), undefined);
  assert.equal(getPersonaImageValidationError({ type: "image/gif", size: 1024 }), "仅支持 PNG、JPEG 或 WebP 图片");
  assert.equal(getPersonaImageValidationError({ type: "image/png", size: 20 * 1024 * 1024 + 1 }), "原图不能超过 20MB");
});

test("删除自定义角色会清理定制、默认选择和模块引用", () => {
  const settings = createDefaultPersonalizationSettings(today);
  const custom = { ...BUILT_IN_PERSONAS[0], id: "custom", name: "自定义", builtIn: false };
  settings.customPersonas = [custom];
  settings.defaultPersonaId = custom.id;
  settings.modulePersonaIds = { tutoring: custom.id, interview: custom.id };
  settings.personaCustomizations[custom.id] = { imageDataUrl: "data:image/png;base64,abc" };
  const cleaned = removeCustomPersona(settings, custom.id);
  assert.equal(cleaned.customPersonas.length, 0);
  assert.equal(cleaned.defaultPersonaId, BUILT_IN_PERSONAS[0].id);
  assert.deepEqual(cleaned.modulePersonaIds, {});
  assert.equal(cleaned.personaCustomizations[custom.id], undefined);
});
