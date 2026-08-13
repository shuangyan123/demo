"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCleanupHostStatus } from "../../services/credential-cleanup-inventory.ts";
import { reviewCredentialCleanup, type CredentialCleanupReview } from "../../services/credential-cleanup-review.ts";
import { projectDesktopCredentialCleanup, type DesktopCredentialCleanupUiModel } from "./desktop-credential-cleanup-state.ts";

type DesktopCredentialCleanupHookModel = DesktopCredentialCleanupUiModel & {
  loading: boolean;
  refresh: () => Promise<void>;
  review: () => Promise<void>;
};

const INITIAL_MODEL: DesktopCredentialCleanupUiModel = {
  visible: false,
  status: "deferred",
  message: "",
  detail: "",
  busy: false,
  canReview: false,
};

export function useDesktopCredentialCleanup(): DesktopCredentialCleanupHookModel {
  const [model, setModel] = useState<DesktopCredentialCleanupUiModel>(INITIAL_MODEL);
  const [loading, setLoading] = useState(true);
  const reviewInFlight = useRef<Promise<void> | undefined>(undefined);

  const readHostModel = useCallback(async () => {
    const host = await getCleanupHostStatus();
    return projectDesktopCredentialCleanup({ hostKind: host.kind, hostStatus: host.status });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setModel(await readHostModel());
    } catch {
      setModel(projectDesktopCredentialCleanup({ hostKind: "desktop", hostStatus: "unavailable" }));
    } finally {
      setLoading(false);
    }
  }, [readHostModel]);

  useEffect(() => {
    let active = true;
    void readHostModel().then((next) => {
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
  }, [readHostModel]);

  const review = useCallback(async () => {
    if (reviewInFlight.current || loading || !model.visible || !model.canReview) return;
    const operation = (async () => {
      setModel((current) => ({ ...current, busy: true, canReview: false }));
      try {
        const result: CredentialCleanupReview = await reviewCredentialCleanup();
        setModel(projectDesktopCredentialCleanup({ hostKind: result.host.kind, hostStatus: result.host.status, review: result }));
      } catch {
        setModel(projectDesktopCredentialCleanup({ hostKind: "desktop", hostStatus: "unavailable" }));
      }
    })();
    const tracked = operation.finally(() => {
      reviewInFlight.current = undefined;
    });
    reviewInFlight.current = tracked;
    await tracked;
  }, [loading, model.canReview, model.visible]);

  return { ...model, loading, refresh, review };
}
