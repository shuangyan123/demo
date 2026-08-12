export type BuiltinPluginId = "obsidian-vault" | "fenbi-import";
export type SettingsPluginAuthorizationReason = "plugin_disabled";

const BUILTIN_PLUGIN_LABELS: Record<BuiltinPluginId, string> = {
  "obsidian-vault": "Obsidian Vault",
  "fenbi-import": "粉笔导入",
};

export class SettingsPluginDisabledError extends Error {
  readonly reason: SettingsPluginAuthorizationReason = "plugin_disabled";
  readonly pluginId: BuiltinPluginId;

  constructor(pluginId: BuiltinPluginId) {
    super(`${BUILTIN_PLUGIN_LABELS[pluginId]} 插件已停用，已阻止执行`);
    this.name = "SettingsPluginDisabledError";
    this.pluginId = pluginId;
  }
}

type PluginPreferencesV1 = {
  version: 1;
  enabled: Record<BuiltinPluginId, boolean>;
};

const STORAGE_KEY = "review_settings_plugins_v1";
const DEFAULT_PREFERENCES: PluginPreferencesV1 = {
  version: 1,
  enabled: { "obsidian-vault": true, "fenbi-import": true },
};
const listeners = new Set<() => void>();
let cachedPreferences = DEFAULT_PREFERENCES;
let initialized = false;

function normalize(value: unknown): PluginPreferencesV1 {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  const enabled = (value as { enabled?: Record<string, unknown> }).enabled;
  return {
    version: 1,
    enabled: {
      "obsidian-vault": typeof enabled?.["obsidian-vault"] === "boolean" ? enabled["obsidian-vault"] : true,
      "fenbi-import": typeof enabled?.["fenbi-import"] === "boolean" ? enabled["fenbi-import"] : true,
    },
  };
}

function read(): PluginPreferencesV1 {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  if (initialized) return cachedPreferences;
  try {
    cachedPreferences = normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    cachedPreferences = DEFAULT_PREFERENCES;
  }
  initialized = true;
  return cachedPreferences;
}

function publishPreferenceChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("review:settings-plugin-changed"));
}

/** 内置插件偏好使用版本化小型本地配置，不触碰 review_workspace Dexie v16。 */
export const settingsPluginPreferencesRepository = {
  getSnapshot: read,
  getServerSnapshot: () => DEFAULT_PREFERENCES,
  isEnabled: (id: BuiltinPluginId) => read().enabled[id],
  setEnabled(id: BuiltinPluginId, enabled: boolean): PluginPreferencesV1 {
    const current = read();
    cachedPreferences = { ...current, enabled: { ...current.enabled, [id]: enabled } };
    initialized = true;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPreferences));
    listeners.forEach((listener) => listener());
    publishPreferenceChange();
    return cachedPreferences;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        try {
          cachedPreferences = normalize(event.newValue ? JSON.parse(event.newValue) : null);
        } catch {
          cachedPreferences = DEFAULT_PREFERENCES;
        }
        initialized = true;
        listener();
        publishPreferenceChange();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
};

/** 内置插件的真实执行入口使用当前快照复核，不能依赖渲染时的 enabled 值。 */
export function assertSettingsPluginEnabled(id: BuiltinPluginId): void {
  if (!settingsPluginPreferencesRepository.isEnabled(id)) throw new SettingsPluginDisabledError(id);
}

/** 供事件回调使用的安全入口：停用只返回安全文案，不暴露底层状态或凭据。 */
export function guardSettingsPluginAction(id: BuiltinPluginId, onBlocked: (message: string) => void, fallback = "插件已停用，已阻止执行"): boolean {
  try {
    assertSettingsPluginEnabled(id);
    return true;
  } catch (error) {
    onBlocked(error instanceof Error ? error.message : fallback);
    return false;
  }
}
