"use client";

import { useEffect, useState } from "react";
import { getCachedConnectionModelCatalog, loadConnectionModelCatalog } from "../../services/model-directory-service";
import type { AiConnectionPurpose, AiModelCatalogEntry, ApiConnectionProfile } from "../../types/review";

/** 对话菜单复用共享模型目录；首帧读缓存/回退，后台仅刷新过期官方目录。 */
export function useConnectionModelCatalog(connection: ApiConnectionProfile | undefined, purpose: AiConnectionPurpose) {
  const catalogKey = connection ? `${connection.id}:${connection.provider}:${connection.baseUrl}:${purpose}` : "empty";
  const fallbackModels = connection ? getCachedConnectionModelCatalog(connection, purpose) : [];
  const [loaded, setLoaded] = useState<{ key: string; models: AiModelCatalogEntry[] }>();

  useEffect(() => {
    let active = true;
    if (!connection) return () => { active = false; };
    void loadConnectionModelCatalog(connection, purpose).then((result) => {
      if (active) setLoaded({ key: catalogKey, models: result.models });
    });
    return () => { active = false; };
  }, [catalogKey, connection, purpose]);

  return loaded?.key === catalogKey ? loaded.models : fallbackModels;
}
