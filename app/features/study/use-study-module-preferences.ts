"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudyDomainId } from "../../types/domains/workspace.ts";
import { getDefaultEnabledStudyModuleIds, resolveEnabledStudyModules, type StudyModuleId } from "./study-registry.ts";

type StudyModulePreferencesRepository = typeof import("../../services/study-module-preferences-repository.ts");

/** 把项目级 stable ID 偏好订阅为 sidebar 可直接消费的 registry 模块集合。 */
export function useStudyModulePreferences(domainId: StudyDomainId) {
  const defaultEnabledModuleIds = useMemo(() => getDefaultEnabledStudyModuleIds(domainId), [domainId]);
  const [enabledModuleIds, setEnabledModuleIds] = useState<readonly StudyModuleId[]>(defaultEnabledModuleIds);
  const repositoryPromise = useRef<Promise<StudyModulePreferencesRepository> | null>(null);
  const loadRepository = useCallback(() => {
    repositoryPromise.current ??= import("../../services/study-module-preferences-repository");
    return repositoryPromise.current;
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void loadRepository().then((repository) => {
      if (!active) return;
      setEnabledModuleIds(repository.getEnabledStudyModuleIds(domainId));
      unsubscribe = repository.subscribeToStudyModulePreferences(() => {
        setEnabledModuleIds(repository.getEnabledStudyModuleIds(domainId));
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [domainId, loadRepository]);

  const updatePreferences = useCallback(async (operation: (repository: StudyModulePreferencesRepository) => readonly StudyModuleId[]) => {
    const repository = await loadRepository();
    const next = operation(repository);
    setEnabledModuleIds(next);
    return next;
  }, [loadRepository]);

  const enabledModules = useMemo(
    () => resolveEnabledStudyModules(domainId, enabledModuleIds),
    [domainId, enabledModuleIds],
  );

  const addModule = useCallback(
    (moduleId: string) => updatePreferences((repository) => repository.addStudyModule(domainId, moduleId)),
    [domainId, updatePreferences],
  );
  const removeModule = useCallback(
    (moduleId: string) => updatePreferences((repository) => repository.removeStudyModule(domainId, moduleId)),
    [domainId, updatePreferences],
  );
  const resetDefaults = useCallback(
    () => updatePreferences((repository) => repository.resetStudyModulePreferences(domainId)),
    [domainId, updatePreferences],
  );

  return { addModule, enabledModuleIds, enabledModules, removeModule, resetDefaults };
}
