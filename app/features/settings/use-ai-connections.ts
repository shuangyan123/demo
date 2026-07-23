"use client";

import { useCallback, useEffect, useState } from "react";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import type { AiConnectionSnapshot } from "../../types/domains/ai-connection.ts";

// 为业务工作台提供当前能力连接快照，设置变更后可显式刷新。
export function useAiConnections(onError: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<AiConnectionSnapshot>({ profiles: [], defaults: { id: "default", updatedAt: "" } });
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextSnapshot = await aiConnectionsRepository.loadSnapshot();
      setSnapshot(nextSnapshot);
      setReadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 连接读取失败";
      setReadError(message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      refresh().catch((error) => {
        if (active) onError(error instanceof Error ? error.message : "AI 连接读取失败");
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onError, refresh]);
  const textConnection = snapshot.profiles.find((profile) => profile.id === snapshot.defaults.textConnectionId);
  const visionConnection = snapshot.profiles.find((profile) => profile.id === snapshot.defaults.visionConnectionId);
  const speechConnection = snapshot.profiles.find((profile) => profile.id === snapshot.defaults.speechConnectionId);
  return { loading, readError, refresh, snapshot, speechConnection, textConnection, visionConnection };
}
