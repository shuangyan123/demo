"use client";

import { useEffect, useState } from "react";
import { inspectConnectionModelCatalog, loadConnectionModelCatalog } from "../../services/model-directory-service";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AiModelCatalogEntry } from "../../types/domains/provider-catalog.ts";

/** 对话菜单复用共享模型目录；首帧读缓存/回退，后台仅刷新过期官方目录。 */
export function useConnectionModelCatalog(connection: ApiConnectionProfile | undefined, purpose: AiConnectionPurpose) {
  const catalogKey = connection ? `${connection.id}:${connection.provider}:${connection.baseUrl}:${purpose}` : "empty";
  const initial = connection ? inspectConnectionModelCatalog(connection, purpose) : undefined;
  const fallbackModels = initial?.models ?? [];
  const [loaded, setLoaded] = useState<{ key: string; models: AiModelCatalogEntry[] }>();
  const refreshRequired = Boolean(connection && !(initial?.source === "cache" && !initial.stale && initial.complete));

  useEffect(() => {
    let active = true;
    if (!connection) return () => { active = false; };
    if (initial?.source === "cache" && !initial.stale && initial.complete) {
      return () => { active = false; };
    }
    void loadConnectionModelCatalog(connection, purpose).then((result) => {
      if (active) setLoaded({ key: catalogKey, models: result.models });
    });
    return () => { active = false; };
  }, [catalogKey, connection, initial?.complete, initial?.source, initial?.stale, purpose]);

  return {
    key: catalogKey,
    loading: Boolean(connection && refreshRequired && loaded?.key !== catalogKey && fallbackModels.length === 0),
    models: loaded?.key === catalogKey ? loaded.models : fallbackModels,
  };
}
