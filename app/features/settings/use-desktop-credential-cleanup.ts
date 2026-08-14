"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCleanupHostStatus } from "../../services/credential-cleanup-inventory.ts";
import { readCredentialCleanupJournal } from "../../services/credential-cleanup-state.ts";
import { reviewCredentialCleanup, type CredentialCleanupReview } from "../../services/credential-cleanup-review.ts";
import {
  projectDesktopCredentialCleanup,
  type DesktopCredentialCleanupUiModel,
  type DesktopCredentialCleanupUiStatus,
} from "./desktop-credential-cleanup-state.ts";

type DesktopCredentialCleanupHookModel = DesktopCredentialCleanupUiModel & {
  loading: boolean;
  refresh: () => Promise<void>;
  review: () => Promise<void>;
  acknowledge: (value: boolean) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
};

const INITIAL_MODEL: DesktopCredentialCleanupUiModel = {
  visible: false,
  status: "deferred",
  message: "",
  detail: "",
  busy: false,
  canReview: false,
  confirmationRequired: false,
  confirmationAcknowledged: false,
  canConfirm: false,
  canResume: false,
  canCancel: false,
};

const JOURNAL_REVIEW_STATES = new Set([
  "preflight",
  "verifying",
  "deleting_sources",
  "deleting_web_key",
  "partial",
  "recovery_required",
  "complete",
]);

function runningModel(current: DesktopCredentialCleanupUiModel): DesktopCredentialCleanupUiModel {
  return {
    ...current,
    status: "verifying",
    message: "Verifying the current Desktop state. No cleanup step can be repeated from this screen.",
    busy: true,
    canReview: false,
    confirmationRequired: false,
    confirmationAcknowledged: false,
    canConfirm: false,
    canResume: false,
    canCancel: false,
  };
}

function cancelledModel(current: DesktopCredentialCleanupUiModel): DesktopCredentialCleanupUiModel {
  return {
    ...current,
    status: "cancelled",
    message: "Cleanup was cancelled before a destructive action. Review again before continuing.",
    detail: "No destructive operation was started. A fresh review is required before another confirmation.",
    busy: false,
    canReview: true,
    confirmationRequired: false,
    confirmationAcknowledged: false,
    canConfirm: false,
    canResume: false,
    canCancel: false,
  };
}

/** Settings may surface safe recovery facts on load, but never resumes cleanup automatically. */
export function useDesktopCredentialCleanup(): DesktopCredentialCleanupHookModel {
  const [model, setModel] = useState<DesktopCredentialCleanupUiModel>(INITIAL_MODEL);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const confirmationInventoryVersion = useRef<string | undefined>(undefined);

  const readCurrentModel = useCallback(async (): Promise<DesktopCredentialCleanupUiModel> => {
    const host = await getCleanupHostStatus();
    const journal = readCredentialCleanupJournal();
    if (host.kind === "desktop" && JOURNAL_REVIEW_STATES.has(journal.state)) {
      const review = await reviewCredentialCleanup();
      return projectDesktopCredentialCleanup({
        hostKind: review.host.kind,
        hostStatus: review.host.status,
        review,
        reviewed: false,
      });
    }
    return projectDesktopCredentialCleanup({ hostKind: host.kind, hostStatus: host.status });
  }, []);

  const refresh = useCallback(async () => {
    confirmationInventoryVersion.current = undefined;
    try {
      setModel(await readCurrentModel());
    } catch {
      setModel(projectDesktopCredentialCleanup({ hostKind: "desktop", hostStatus: "unavailable" }));
    } finally {
      setLoading(false);
    }
  }, [readCurrentModel]);

  useEffect(() => {
    let active = true;
    void readCurrentModel().then((next) => {
      if (!active) return;
      setModel(next);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setModel(projectDesktopCredentialCleanup({ hostKind: "desktop", hostStatus: "unavailable" }));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [readCurrentModel]);

  const review = useCallback(async () => {
    if (inFlight.current || loading || !model.visible || !model.canReview) return;
    const operation = (async () => {
      confirmationInventoryVersion.current = undefined;
      setModel((current) => runningModel(current));
      try {
        const result: CredentialCleanupReview = await reviewCredentialCleanup();
        confirmationInventoryVersion.current = result.inventoryVersion;
        setModel(projectDesktopCredentialCleanup({
          hostKind: result.host.kind,
          hostStatus: result.host.status,
          review: result,
          reviewed: true,
          confirmationAcknowledged: false,
        }));
      } catch {
        confirmationInventoryVersion.current = undefined;
        setModel(projectDesktopCredentialCleanup({ hostKind: "desktop", hostStatus: "unavailable" }));
      }
    })();
    const tracked = operation.finally(() => {
      inFlight.current = undefined;
    });
    inFlight.current = tracked;
    await tracked;
  }, [loading, model.canReview, model.visible]);

  const acknowledge = useCallback((value: boolean) => {
    if (!model.confirmationRequired || model.busy) return;
    setModel((current) => ({
      ...current,
      confirmationAcknowledged: value,
      canConfirm: value && (current.status === "awaiting_confirmation" || current.status === "partial" || current.status === "recovery_required"),
      canResume: value && (current.status === "partial" || current.status === "recovery_required"),
    }));
  }, [model.busy, model.confirmationRequired]);

  const confirm = useCallback(async () => {
    if (inFlight.current || loading || model.busy || !model.canConfirm) return;
    const inventoryVersion = confirmationInventoryVersion.current;
    if (!inventoryVersion) return;
    const resume = model.status === "partial" || model.status === "recovery_required";
    const operation = (async () => {
      setModel((current) => runningModel(current));
      let executionStatus: Parameters<typeof projectDesktopCredentialCleanup>[0]["executionStatus"];
      try {
        const { executeDesktopCredentialCleanup } = await import("../../services/credential-cleanup-execution.ts");
        executionStatus = (await executeDesktopCredentialCleanup({
          confirmationInventoryVersion: inventoryVersion,
          confirmationAcknowledged: true,
          resume,
        })).status;
      } catch {
        executionStatus = "recovery_required";
      }
      confirmationInventoryVersion.current = undefined;
      try {
        const reviewResult = await reviewCredentialCleanup();
        setModel(projectDesktopCredentialCleanup({
          hostKind: reviewResult.host.kind,
          hostStatus: reviewResult.host.status,
          review: reviewResult,
          executionStatus,
          reviewed: false,
        }));
      } catch {
        setModel(projectDesktopCredentialCleanup({
          hostKind: "desktop",
          hostStatus: "unavailable",
          executionStatus,
        }));
      }
    })();
    const tracked = operation.finally(() => {
      inFlight.current = undefined;
    });
    inFlight.current = tracked;
    await tracked;
  }, [loading, model.busy, model.canConfirm, model.status]);

  const cancel = useCallback(() => {
    if (!model.canCancel || model.busy || inFlight.current) return;
    confirmationInventoryVersion.current = undefined;
    setModel((current) => cancelledModel(current));
  }, [model.busy, model.canCancel]);

  return { ...model, loading, refresh, review, acknowledge, confirm, cancel };
}

export type { DesktopCredentialCleanupUiStatus };
