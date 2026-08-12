"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { inspectCredentialProtection } from "../../platform/credential-protection.ts";
import { resolveHost } from "../../platform/host.ts";
import { migrateDesktopCredentials, type CredentialMigrationResult } from "../../services/credential-migration-service.ts";
import { readCredentialMigrationJournal } from "../../services/credential-migration-state.ts";
import {
  projectDesktopCredentialMigration,
  type DesktopCredentialMigrationUiModel,
} from "./desktop-credential-migration-state.ts";

type DesktopCredentialMigrationHookModel = DesktopCredentialMigrationUiModel & {
  loading: boolean;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
};

const INITIAL_MODEL: DesktopCredentialMigrationUiModel = {
  visible: false,
  status: "ready",
  message: "",
  busy: false,
  canStart: false,
};

function unavailableModel(): DesktopCredentialMigrationUiModel {
  return projectDesktopCredentialMigration({
    hostKind: "desktop",
    protectionStatus: "unavailable",
    journal: { state: "idle", backendPolicy: "web_preferred" },
  });
}

/** 设置页只读取安全状态；真正的迁移只能由用户按钮显式触发。 */
export function useDesktopCredentialMigration(): DesktopCredentialMigrationHookModel {
  const [model, setModel] = useState<DesktopCredentialMigrationUiModel>(INITIAL_MODEL);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<Promise<void> | undefined>(undefined);

  const readModel = useCallback(async (operationStatus?: CredentialMigrationResult["status"]): Promise<DesktopCredentialMigrationUiModel> => {
    const runtime = resolveHost();
    if (runtime.kind !== "desktop") return projectDesktopCredentialMigration({ hostKind: runtime.kind, protectionStatus: "available", journal: { state: "idle", backendPolicy: "web_preferred" } });

    const journal = readCredentialMigrationJournal();
    let protectionStatus: Awaited<ReturnType<typeof inspectCredentialProtection>>["status"] = "unavailable";
    try {
      protectionStatus = (await inspectCredentialProtection()).status;
    } catch {
      protectionStatus = "unavailable";
    }
    return projectDesktopCredentialMigration({
      hostKind: runtime.kind,
      protectionStatus,
      journal,
      operationStatus,
    });
  }, []);

  const refresh = useCallback(async () => {
    const next = await readModel();
    setModel(next);
    setLoading(false);
  }, [readModel]);

  useEffect(() => {
    let active = true;
    void readModel().then((next) => {
      if (!active) return;
      setModel(next);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setModel(unavailableModel());
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [readModel]);

  const start = useCallback(async () => {
    if (inFlight.current || loading || !model.visible || !model.canStart) return;
    setModel((current) => current.visible ? {
      ...current,
      status: "in_progress",
      message: "Desktop 凭据迁移正在进行。请保持应用打开，不要重复操作。",
      busy: true,
      canStart: false,
    } : current);

    const operation = (async () => {
      let operationStatus: CredentialMigrationResult["status"] | undefined;
      try {
        operationStatus = (await migrateDesktopCredentials()).status;
      } catch {
        operationStatus = "recovery_required";
      }
      try {
        setModel(await readModel(operationStatus));
      } catch {
        setModel(unavailableModel());
      }
    })();
    const tracked = operation.finally(() => {
      inFlight.current = undefined;
    });
    inFlight.current = tracked;
    await tracked;
  }, [loading, model, readModel]);

  return { ...model, loading, refresh, start };
}
