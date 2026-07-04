"use client";

import type { SyntheticEvent } from "react";
import { useEffect, useState } from "react";
import { splitInput, textValue } from "../../lib/form-utils";
import { markDuplicateDrafts } from "../../services/dedupe-service";
import { parseFenbiFile, parseFenbiTextWithAi } from "../../services/fenbi-import-service";
import { parseFenbiTextByName } from "../../services/fenbi-parser";
import { importDraftRepository } from "../../services/import-draft-repository";
import { reviewRepository } from "../../services/review-repository";
import type { ApiConnectionProfile, ImportBatch, ImportDraft, ImportJob, Mistake, PersistedImportDraft } from "../../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

type UseImportDraftsInput = {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  importJobs: ImportJob[];
  mistakes: Mistake[];
  today: Date;
  onRefreshWorkspace: () => Promise<void>;
  setNotice: (message: string) => void;
};

// AI 文本解析和图片 OCR 使用不同能力默认值，缺失时不做隐式跨能力回退。
function requireTextConnection(connection?: ApiConnectionProfile): ApiConnectionProfile {
  if (!connection) throw new Error("请先在 AI 连接中配置默认文本连接，再使用 AI 文本解析。");
  return connection;
}

// 从表单中读取批量文件；空文件会被过滤，避免误生成空批次。
function filesFromForm(form: HTMLFormElement): File[] {
  const input = form.elements.namedItem("files");
  if (input instanceof HTMLInputElement && input.files) {
    return Array.from(input.files).filter((file) => file.size > 0);
  }
  const fallback = new FormData(form).get("file");
  return fallback instanceof File && fallback.size > 0 ? [fallback] : [];
}

// 导入模块的状态和持久化编排 hook；UI 不直接操作 Dexie，便于后续接入更多来源。
export function useImportDrafts({ textConnection, visionConnection, importJobs, mistakes, onRefreshWorkspace, setNotice, today }: UseImportDraftsInput) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [drafts, setDrafts] = useState<PersistedImportDraft[]>([]);
  const [importBusy, setImportBusy] = useState(false);

  // 刷新导入批次和持久草稿，和主工作台快照分离，避免每次编辑草稿都重读错题库。
  async function refreshImportDrafts() {
    const snapshot = await importDraftRepository.load();
    setBatches(snapshot.batches);
    setDrafts(snapshot.drafts);
  }

  useEffect(() => {
    let active = true;
    void importDraftRepository
      .load()
      .then((snapshot) => {
        if (!active) return;
        setBatches(snapshot.batches);
        setDrafts(snapshot.drafts);
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "导入草稿读取失败");
      });
    return () => {
      active = false;
    };
  }, [setNotice]);

  // 把解析结果写成批次草稿，并同步写入兼容旧 UI 的 importJobs 记录。
  async function persistParsedDrafts(input: {
    batchId: string;
    drafts: ImportDraft[];
    fileName?: string;
    fileType?: string;
    rawText?: string;
    jobType: ImportJob["type"];
    jobMessage: string;
    existingDrafts?: Array<{ stem: string }>;
  }) {
    const withIssues = markDuplicateDrafts(input.drafts, mistakes, input.existingDrafts);
    await importDraftRepository.addDrafts(withIssues, {
      batchId: input.batchId,
      fileName: input.fileName,
      fileType: input.fileType,
      rawText: input.rawText,
      today,
    });
    await reviewRepository.createImportJob(
      {
        type: input.jobType,
        fileName: input.fileName,
        fileType: input.fileType,
        rawText: input.rawText ?? "",
        status: "parsed",
        parsedCount: withIssues.length,
        message: input.jobMessage,
      },
      today,
    );
  }

  // 处理粘贴文本导入：本地解析或 AI 结构化解析都会进入持久草稿。
  async function parseTextImport(event: SubmitReactEvent, mode: "local" | "ai") {
    event.preventDefault();
    const form = event.currentTarget;
    const rawText = textValue(new FormData(form).get("rawText"));
    if (!rawText) {
      setNotice("请先粘贴粉笔错题文本");
      return;
    }

    setImportBusy(true);
    const batch = await importDraftRepository.createBatch(
      {
        source: "text",
        fileNames: ["粘贴文本"],
        fileCount: 1,
        message: mode === "ai" ? "正在使用 AI 解析文本" : "正在本地解析文本",
      },
      today,
    );
    try {
      await importDraftRepository.updateBatch(batch.id, { status: "parsing" }, today);
      const parsedDrafts = mode === "ai" ? await parseFenbiTextWithAi(rawText, requireTextConnection(textConnection)) : parseFenbiTextByName(rawText, "paste.txt");
      await persistParsedDrafts({
        batchId: batch.id,
        drafts: parsedDrafts,
        existingDrafts: drafts,
        fileName: "粘贴文本",
        fileType: "text/plain",
        rawText,
        jobType: "text",
        jobMessage: mode === "ai" ? "AI 已生成粉笔错题草稿" : "文本已生成粉笔错题草稿",
      });
      form.reset();
      await refreshImportDrafts();
      await onRefreshWorkspace();
      setNotice(`已生成 ${parsedDrafts.length} 条粉笔错题草稿`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      await importDraftRepository.updateBatch(batch.id, { status: "failed", error: message, message }, today);
      await reviewRepository.createImportJob({ type: "text", rawText, status: "failed", parsedCount: 0, message, error: message }, today);
      await refreshImportDrafts();
      await onRefreshWorkspace();
      setNotice(message);
    } finally {
      setImportBusy(false);
    }
  }

  // 处理批量文件导入，逐个文件解析并累积到同一个批次中。
  async function parseFileImport(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = filesFromForm(form);
    if (!files.length) {
      setNotice("请选择粉笔截图或导出文件");
      return;
    }

    setImportBusy(true);
    const batch = await importDraftRepository.createBatch(
      {
        source: "fenbi",
        fileNames: files.map((file) => file.name),
        fileCount: files.length,
        message: `正在解析 ${files.length} 个文件`,
      },
      today,
    );

    let totalParsed = 0;
    let lastError = "";
    const parsedInBatch: ImportDraft[] = [];
    try {
      await importDraftRepository.updateBatch(batch.id, { status: "parsing" }, today);
      for (const file of files) {
        try {
          const parsedDrafts = await parseFenbiFile(file, visionConnection);
          totalParsed += parsedDrafts.length;
          await persistParsedDrafts({
            batchId: batch.id,
            drafts: parsedDrafts.map((draft) => ({ ...draft, fileName: file.name, fileType: file.type || "unknown" })),
            existingDrafts: [...drafts, ...parsedInBatch],
            fileName: file.name,
            fileType: file.type || "unknown",
            rawText: file.type.startsWith("text/") ? await file.text() : "",
            jobType: file.type.startsWith("image/") ? "ocr" : "file",
            jobMessage: `${file.name} 已生成粉笔错题草稿`,
          });
          parsedInBatch.push(...parsedDrafts);
          await importDraftRepository.updateBatch(batch.id, { parsedCount: totalParsed, message: `已解析 ${totalParsed} 条草稿` }, today);
        } catch (error) {
          lastError = error instanceof Error ? error.message : `${file.name} 解析失败`;
          await reviewRepository.createImportJob({
            type: file.type.startsWith("image/") ? "ocr" : "file",
            fileName: file.name,
            fileType: file.type || "unknown",
            rawText: "",
            status: "failed",
            parsedCount: 0,
            message: lastError,
            error: lastError,
          }, today);
        }
      }

      if (!totalParsed && lastError) throw new Error(lastError);
      await importDraftRepository.updateBatch(batch.id, {
        status: "parsed",
        parsedCount: totalParsed,
        message: lastError ? `已解析 ${totalParsed} 条草稿，部分文件失败` : `已解析 ${totalParsed} 条草稿`,
        error: lastError || undefined,
      }, today);
      form.reset();
      await refreshImportDrafts();
      await onRefreshWorkspace();
      setNotice(lastError ? `已生成 ${totalParsed} 条草稿，部分文件失败` : `已生成 ${totalParsed} 条粉笔错题草稿`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件导入失败";
      await importDraftRepository.updateBatch(batch.id, { status: "failed", error: message, message }, today);
      await refreshImportDrafts();
      await onRefreshWorkspace();
      setNotice(message);
    } finally {
      setImportBusy(false);
    }
  }

  // 更新某条导入草稿的局部字段，同时保持本地 UI 和 Dexie 一致。
  function updateDraft(id: string, patch: Partial<ImportDraft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
    void importDraftRepository.updateDraft(id, patch, today).catch((error) => {
      setNotice(error instanceof Error ? error.message : "草稿保存失败");
    });
  }

  // 批量更新当前草稿，常用于快速统一板块、来源或标签。
  function updateDrafts(ids: string[], patch: Partial<ImportDraft>) {
    setDrafts((current) => current.map((draft) => (ids.includes(draft.id) ? { ...draft, ...patch } : draft)));
    void importDraftRepository.updateDrafts(ids, patch, today).catch((error) => {
      setNotice(error instanceof Error ? error.message : "草稿批量更新失败");
    });
  }

  // 把草稿中的错因或标签文本重新拆分为数组。
  function updateDraftList(id: string, key: "reasons" | "tags", value: string) {
    updateDraft(id, { [key]: splitInput(value) });
  }

  // 删除草稿并刷新批次视图，避免批次数量和草稿区不一致。
  async function deleteDrafts(ids: string[]) {
    await importDraftRepository.removeDrafts(ids);
    await refreshImportDrafts();
    setNotice(`已删除 ${ids.length} 条草稿`);
  }

  // 将选中的导入草稿批量确认入库，并同步刷新错题库快照。
  async function confirmDrafts(ids?: string[]) {
    const selectedIds = ids ?? drafts.filter((draft) => draft.selected && draft.stem.trim()).map((draft) => draft.id);
    if (!selectedIds.length) {
      setNotice("请选择至少一条有效草稿");
      return;
    }
    const saved = await importDraftRepository.confirmDrafts(selectedIds, today);
    await reviewRepository.createImportJob(
      {
        type: "text",
        rawText: "",
        status: "saved",
        parsedCount: saved.length,
        message: `${saved.length} 条粉笔错题草稿已确认入库`,
      },
      today,
    );
    await refreshImportDrafts();
    await onRefreshWorkspace();
    setNotice(`${saved.length} 条粉笔错题已入库`);
  }

  return {
    batches,
    drafts,
    importBusy,
    importJobs,
    confirmDrafts,
    deleteDrafts,
    parseFileImport,
    parseTextImport,
    refreshImportDrafts,
    updateDraft,
    updateDraftList,
    updateDrafts,
  };
}
