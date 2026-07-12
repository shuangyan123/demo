"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiConnectionSnapshot, AutomationRun, AutomationSnapshot, ImportJob, ObsidianVaultSnapshot } from "../../types/review";

export type LocalDiagnosticStatus = "ready" | "warning" | "error";
export type LocalDiagnosticAction = "ai-connections" | "knowledge" | "automation";

export type BrowserCapabilitySnapshot = {
  clipboard: boolean;
  fileSystemAccess: boolean;
  host: string;
  indexedDb: boolean;
  notifications: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  online: boolean;
  secureContext: boolean;
  userAgent: string;
  webLocks: boolean;
};

export type LocalDiagnosticItem = {
  id: string;
  title: string;
  description: string;
  status: LocalDiagnosticStatus;
  action?: LocalDiagnosticAction;
  actionLabel?: string;
};

export type LocalDiagnosticSection = {
  id: "ai" | "obsidian" | "data" | "automation" | "browser" | "app";
  title: string;
  status: LocalDiagnosticStatus;
  items: LocalDiagnosticItem[];
};

export type LocalDiagnostics = {
  generatedAt: string;
  readyCount: number;
  report: string;
  sections: LocalDiagnosticSection[];
  status: LocalDiagnosticStatus;
  summary: string;
};

export type LocalDiagnosticsInput = {
  aiReadError?: string;
  aiSnapshot: AiConnectionSnapshot;
  appVersion: string;
  automationSnapshot: AutomationSnapshot;
  browserCapabilities: BrowserCapabilitySnapshot;
  dataReadError?: string;
  generatedAt?: string;
  importJobs: ImportJob[];
  knowledgeEntryCount: number;
  mistakeCount: number;
  obsidianError?: string;
  obsidianSnapshot: ObsidianVaultSnapshot;
};

export type LocalDiagnosticsHookInput = Omit<LocalDiagnosticsInput, "browserCapabilities" | "generatedAt" | "obsidianError" | "obsidianSnapshot">;

const defaultBrowserCapabilities: BrowserCapabilitySnapshot = {
  clipboard: false,
  fileSystemAccess: false,
  host: "",
  indexedDb: false,
  notificationPermission: "unsupported",
  notifications: false,
  online: true,
  secureContext: false,
  userAgent: "",
  webLocks: false,
};

const defaultObsidianSnapshot: ObsidianVaultSnapshot = {
  id: "default",
  connected: false,
  conflictCount: 0,
  createdAt: "",
  lastSyncedAt: undefined,
  managedRoot: "AI知识库",
  mappedCount: 0,
  pendingProposalCount: 0,
  permission: "denied",
  recovery: "none",
  updatedAt: "",
  vaultName: "",
};

function item(id: string, title: string, description: string, status: LocalDiagnosticStatus, action?: LocalDiagnosticAction, actionLabel?: string): LocalDiagnosticItem {
  return { action, actionLabel, description, id, status, title };
}

function sectionStatus(items: LocalDiagnosticItem[]): LocalDiagnosticStatus {
  if (items.some((entry) => entry.status === "error")) return "error";
  if (items.some((entry) => entry.status === "warning")) return "warning";
  return "ready";
}

function hasDefaultConnection(snapshot: AiConnectionSnapshot, id?: string): boolean {
  return Boolean(id && snapshot.profiles.some((profile) => profile.id === id));
}

function defaultConnectionDescription(snapshot: AiConnectionSnapshot, id?: string, modelId?: string): string {
  const profile = snapshot.profiles.find((entry) => entry.id === id);
  if (!profile) return "未设置默认连接。";
  const testStatus = profile.testStatus === "success" ? "已验证" : profile.testStatus === "failed" ? "验证失败" : "未验证";
  return `${profile.label} / ${profile.provider} / ${modelId || "未选择模型"} / ${testStatus}`;
}

function formatDateTime(value?: string): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function recentFailedRuns(runs: AutomationRun[]): AutomationRun[] {
  return [...runs]
    .filter((run) => run.status === "failed")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
}

function reportLine(item: LocalDiagnosticItem): string {
  const label = item.status === "ready" ? "正常" : item.status === "warning" ? "注意" : "错误";
  return `- [${label}] ${item.title}：${item.description}`;
}

function buildReport(input: LocalDiagnosticsInput, sections: LocalDiagnosticSection[], status: LocalDiagnosticStatus): string {
  const lines = [
    "# 本地诊断报告",
    `- 生成时间：${input.generatedAt ?? new Date().toISOString()}`,
    `- 应用版本：${input.appVersion}`,
    `- 总体状态：${status === "ready" ? "正常" : status === "warning" ? "需要关注" : "存在错误"}`,
    `- 浏览器：${input.browserCapabilities.userAgent || "未知"}`,
    "",
  ];
  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push(...section.items.map(reportLine));
    lines.push("");
  }
  return lines.join("\n");
}

export function readBrowserCapabilities(): BrowserCapabilitySnapshot {
  if (typeof window === "undefined" || typeof navigator === "undefined") return defaultBrowserCapabilities;
  return {
    clipboard: "clipboard" in navigator,
    fileSystemAccess: "showDirectoryPicker" in window,
    host: window.location.host,
    indexedDb: "indexedDB" in window,
    notificationPermission: "Notification" in window ? Notification.permission : "unsupported",
    notifications: "Notification" in window,
    online: navigator.onLine,
    secureContext: window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1",
    userAgent: navigator.userAgent,
    webLocks: "locks" in navigator,
  };
}

async function loadObsidianSnapshot(): Promise<ObsidianVaultSnapshot> {
  const { obsidianKnowledgeRepository } = await import("../../services/obsidian-knowledge-repository");
  return obsidianKnowledgeRepository.loadSnapshot();
}

/** 把当前本地快照转换为可展示和可复制的诊断结果，保持纯函数便于契约测试。 */
export function buildLocalDiagnostics(input: LocalDiagnosticsInput): LocalDiagnostics {
  const hasTextConnection = hasDefaultConnection(input.aiSnapshot, input.aiSnapshot.defaults.textConnectionId);
  const hasVisionConnection = hasDefaultConnection(input.aiSnapshot, input.aiSnapshot.defaults.visionConnectionId);
  const hasSpeechConnection = hasDefaultConnection(input.aiSnapshot, input.aiSnapshot.defaults.speechConnectionId);
  const enabledDefinitions = input.automationSnapshot.definitions.filter((definition) => definition.enabled);
  const failedRuns = recentFailedRuns(input.automationSnapshot.runs);
  const failedImportJobs = input.importJobs.filter((job) => job.status === "failed");

  const aiItems: LocalDiagnosticItem[] = [
    input.aiReadError
      ? item("ai-read", "AI 连接读取失败", input.aiReadError, "error", "ai-connections", "配置 AI 连接")
      : item("ai-read", "AI 连接快照可读取", `已保存 ${input.aiSnapshot.profiles.length} 个连接档案。`, "ready"),
    hasTextConnection
      ? item("ai-text", "默认文本连接可用", defaultConnectionDescription(input.aiSnapshot, input.aiSnapshot.defaults.textConnectionId, input.aiSnapshot.defaults.textModelId), "ready")
      : item("ai-text", "默认文本连接缺失", "文本生成、关联分析和已安排任务会受影响。", "error", "ai-connections", "配置 AI 连接"),
    hasVisionConnection
      ? item("ai-vision", "默认多模态连接可用", defaultConnectionDescription(input.aiSnapshot, input.aiSnapshot.defaults.visionConnectionId, input.aiSnapshot.defaults.visionModelId), "ready")
      : item("ai-vision", "默认多模态连接缺失", "OCR、截图和关键帧分析暂不可用。", "warning", "ai-connections", "配置 AI 连接"),
    hasSpeechConnection
      ? item("ai-speech", "默认语音连接可用", defaultConnectionDescription(input.aiSnapshot, input.aiSnapshot.defaults.speechConnectionId, input.aiSnapshot.defaults.speechModelId), "ready")
      : item("ai-speech", "默认语音连接缺失", "朗读会保持静音，不会回退到本机音色。", "warning", "ai-connections", "配置 AI 连接"),
  ];

  const obsidianItems: LocalDiagnosticItem[] = [];
  if (input.obsidianError) {
    obsidianItems.push(item("obsidian-read", "Obsidian 状态读取失败", input.obsidianError, "error", "knowledge", "打开知识库"));
  } else if (input.obsidianSnapshot.permission === "unsupported") {
    obsidianItems.push(item("obsidian-unsupported", "浏览器不支持目录桥接", "可使用一次性 Markdown 导入，双向同步不可用。", "warning", "knowledge", "打开知识库"));
  } else if (!input.obsidianSnapshot.connected) {
    obsidianItems.push(item("obsidian-disconnected", "尚未连接 Vault", "未读取或写入任何 Vault 内容。", "warning", "knowledge", "打开知识库"));
  } else if (input.obsidianSnapshot.permission === "prompt" || input.obsidianSnapshot.permission === "denied") {
    obsidianItems.push(item("obsidian-permission", "Vault 权限需要恢复", `当前权限为 ${input.obsidianSnapshot.permission}，需要用户点击授权。`, "error", "knowledge", "打开知识库"));
  } else {
    obsidianItems.push(item("obsidian-ready", "Vault 权限正常", `已连接 ${input.obsidianSnapshot.vaultName || "未命名 Vault"}，托管目录 ${input.obsidianSnapshot.managedRoot}。`, "ready"));
  }
  if (input.obsidianSnapshot.conflictCount > 0) {
    obsidianItems.push(item("obsidian-conflicts", "存在同步冲突", `${input.obsidianSnapshot.conflictCount} 条冲突等待手动处理。`, "warning", "knowledge", "打开知识库"));
  }
  if (input.obsidianSnapshot.pendingProposalCount > 0) {
    obsidianItems.push(item("obsidian-proposals", "存在待确认提案", `${input.obsidianSnapshot.pendingProposalCount} 条知识演进提案等待确认。`, "warning", "knowledge", "打开知识库"));
  }

  const dataItems: LocalDiagnosticItem[] = [
    input.dataReadError
      ? item("data-read", "本地数据读取失败", input.dataReadError, "error")
      : item("data-read", "本地数据快照可读取", `错题 ${input.mistakeCount} 道，知识资料 ${input.knowledgeEntryCount} 条，导入任务 ${input.importJobs.length} 个。`, "ready"),
    input.browserCapabilities.indexedDb
      ? item("data-indexeddb", "IndexedDB 可用", "本地题库、知识库和已安排记录可持久化。", "ready")
      : item("data-indexeddb", "IndexedDB 不可用", "本地数据无法可靠保存，请检查浏览器隐私模式或权限。", "error"),
  ];
  if (failedImportJobs.length) {
    dataItems.push(item("data-import-failed", "存在失败导入任务", `最近记录中有 ${failedImportJobs.length} 个导入任务失败。`, "warning"));
  }

  const automationItems: LocalDiagnosticItem[] = [];
  if (!input.automationSnapshot.definitions.length) {
    automationItems.push(item("automation-empty", "尚未创建已安排任务", "已安排中没有任务定义。", "warning", "automation", "打开已安排"));
  } else if (!enabledDefinitions.length) {
    automationItems.push(item("automation-disabled", "已安排任务均未启用", "已有任务不会执行。", "warning", "automation", "打开已安排"));
  } else if (!hasTextConnection) {
    automationItems.push(item("automation-no-text", "启用任务缺少默认文本连接", "已安排运行需要默认文本连接。", "error", "ai-connections", "配置 AI 连接"));
  } else {
    automationItems.push(item("automation-ready", "已安排定义可运行", `已启用 ${enabledDefinitions.length} 个任务；应用关闭时不会后台运行。`, "ready"));
  }
  if (input.automationSnapshot.unreadCount > 0) {
    automationItems.push(item("automation-unread", "有未读运行结果", `${input.automationSnapshot.unreadCount} 条运行结果未读。`, "warning", "automation", "打开已安排"));
  }
  for (const run of failedRuns) {
    automationItems.push(item(`automation-failed-${run.id}`, `最近失败：${run.automationName}`, `${formatDateTime(run.createdAt)}，${run.error || "已安排执行失败"}`, "error", "automation", "打开已安排"));
  }

  const browserItems: LocalDiagnosticItem[] = [
    input.browserCapabilities.online
      ? item("browser-online", "网络在线", "浏览器当前报告为在线状态。", "ready")
      : item("browser-online", "网络离线", "AI 请求和部分同步能力会失败。", "warning"),
    input.browserCapabilities.secureContext
      ? item("browser-secure", "安全上下文可用", `${input.browserCapabilities.host || "当前页面"} 可使用需要安全上下文的浏览器能力。`, "ready")
      : item("browser-secure", "缺少安全上下文", "File System Access 等能力需要 HTTPS 或 localhost。", "error"),
    input.browserCapabilities.fileSystemAccess
      ? item("browser-fsa", "File System Access 可用", "可通过用户点击选择 Obsidian Vault 文件夹。", "ready")
      : item("browser-fsa", "File System Access 不可用", "当前浏览器无法直接桥接 Vault，可使用一次性 Markdown 导入。", "warning"),
    input.browserCapabilities.webLocks
      ? item("browser-locks", "Web Locks 可用", "多标签已安排去重可使用浏览器锁。", "ready")
      : item("browser-locks", "Web Locks 不可用", "已安排会退回 IndexedDB 租约兜底去重。", "warning"),
    input.browserCapabilities.notifications
      ? item("browser-notification", "通知 API 可用", `当前通知权限：${input.browserCapabilities.notificationPermission}。`, "ready")
      : item("browser-notification", "通知 API 不可用", "已安排完成后无法弹出系统通知。", "warning"),
    input.browserCapabilities.clipboard
      ? item("browser-clipboard", "剪贴板 API 可用", "可一键复制诊断报告。", "ready")
      : item("browser-clipboard", "剪贴板 API 不可用", "可手动选择诊断报告文本复制。", "warning"),
  ];

  const appItems: LocalDiagnosticItem[] = [
    item("app-version", "应用版本", input.appVersion, "ready"),
    item("app-generated-at", "诊断生成时间", input.generatedAt ?? new Date().toISOString(), "ready"),
  ];

  const sections: LocalDiagnosticSection[] = [
    { id: "ai", title: "AI 连接", items: aiItems, status: sectionStatus(aiItems) },
    { id: "obsidian", title: "Obsidian Vault", items: obsidianItems, status: sectionStatus(obsidianItems) },
    { id: "data", title: "本地数据", items: dataItems, status: sectionStatus(dataItems) },
    { id: "automation", title: "已安排", items: automationItems, status: sectionStatus(automationItems) },
    { id: "browser", title: "浏览器能力", items: browserItems, status: sectionStatus(browserItems) },
    { id: "app", title: "应用信息", items: appItems, status: sectionStatus(appItems) },
  ];
  const allItems = sections.flatMap((entry) => entry.items);
  const status = sectionStatus(allItems);
  const issueCount = allItems.filter((entry) => entry.status !== "ready").length;
  const readyCount = allItems.length - issueCount;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const report = buildReport({ ...input, generatedAt }, sections, status);

  return {
    generatedAt,
    readyCount,
    report,
    sections,
    status,
    summary: status === "ready" ? "本地诊断正常" : `${issueCount} 项需要关注`,
  };
}

/** 聚合浏览器能力和 Obsidian 可序列化快照，生成设置页诊断状态。 */
export function useLocalDiagnostics(input: LocalDiagnosticsHookInput) {
  const [browserCapabilities, setBrowserCapabilities] = useState<BrowserCapabilitySnapshot>(() => readBrowserCapabilities());
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());
  const [obsidianSnapshot, setObsidianSnapshot] = useState<ObsidianVaultSnapshot>(defaultObsidianSnapshot);
  const [obsidianError, setObsidianError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setBrowserCapabilities(readBrowserCapabilities());
    setGeneratedAt(new Date().toISOString());
    try {
      const snapshot = await loadObsidianSnapshot();
      setObsidianSnapshot(snapshot);
      setObsidianError("");
    } catch (error) {
      setObsidianError(error instanceof Error ? error.message : "Obsidian 状态读取失败");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setBrowserCapabilities(readBrowserCapabilities());
      setGeneratedAt(new Date().toISOString());
      loadObsidianSnapshot()
        .then((snapshot) => {
          if (!active) return;
          setObsidianSnapshot(snapshot);
          setObsidianError("");
        })
        .catch((error) => {
          if (!active) return;
          setObsidianError(error instanceof Error ? error.message : "Obsidian 状态读取失败");
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const diagnostics = useMemo(
    () => buildLocalDiagnostics({ ...input, browserCapabilities, generatedAt, obsidianError, obsidianSnapshot }),
    [browserCapabilities, generatedAt, input, obsidianError, obsidianSnapshot],
  );

  return { diagnostics, refresh, refreshing };
}
