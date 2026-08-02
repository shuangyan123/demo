import type { InstalledExtensionRecord } from "../../../types/domains/declarative-extension.ts";
import type { BuiltinPluginId } from "../../../services/settings-plugin-preferences-repository.ts";
import type { SettingsPluginDefinition } from "./settings-plugin-registry.ts";

export type PluginDirectoryItem =
  | { kind: "builtin"; id: BuiltinPluginId; enabled: boolean; definition: SettingsPluginDefinition }
  | { kind: "declarative"; id: string; enabled: boolean; record: InstalledExtensionRecord };

/** 把固定集成与真实安装包投影为统一目录；市场入口本身不伪装成插件。 */
export function buildPluginDirectory(
  definitions: SettingsPluginDefinition[],
  enabled: Record<BuiltinPluginId, boolean>,
  installed: InstalledExtensionRecord[],
): PluginDirectoryItem[] {
  return [
    ...definitions.map((definition) => ({ kind: "builtin" as const, id: definition.id, enabled: enabled[definition.id], definition })),
    ...installed.map((record) => ({ kind: "declarative" as const, id: record.id, enabled: record.enabled, record })),
  ];
}
