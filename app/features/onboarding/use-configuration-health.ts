"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiConnectionSnapshot,
  AutomationSnapshot,
  ImportJob,
  KnowledgeEntry,
  Mistake,
  ObsidianVaultSnapshot,
} from "../../types/review";

export type ConfigurationHealthStatus = "ready" | "warning" | "missing";

export type ConfigurationHealthAction =
  | "ai-connections"
  | "obsidian"
  | "automation"
  | "import"
  | "entry"
  | "review"
  | "knowledge-training";

export type ConfigurationHealthItem = {
  id: string;
  title: string;
  description: string;
  status: ConfigurationHealthStatus;
  action?: ConfigurationHealthAction;
  actionLabel?: string;
};

export type ConfigurationHealthSection = {
  id: "ai" | "obsidian" | "automation" | "learning";
  title: string;
  status: ConfigurationHealthStatus;
  items: ConfigurationHealthItem[];
};

export type ConfigurationHealth = {
  status: ConfigurationHealthStatus;
  summary: string;
  readyCount: number;
  issueCount: number;
  sections: ConfigurationHealthSection[];
};

export type ConfigurationHealthInput = {
  aiSnapshot: AiConnectionSnapshot;
  automationSnapshot: AutomationSnapshot;
  dueKnowledgeCount: number;
  dueMistakeCount: number;
  importJobs: ImportJob[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  obsidianError?: string;
  obsidianSnapshot: ObsidianVaultSnapshot;
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

async function loadObsidianSnapshot(): Promise<ObsidianVaultSnapshot> {
  const { obsidianKnowledgeRepository } = await import("../../services/obsidian-knowledge-repository");
  return obsidianKnowledgeRepository.loadSnapshot();
}

function hasDefaultConnection(snapshot: AiConnectionSnapshot, id?: string): boolean {
  return Boolean(id && snapshot.profiles.some((profile) => profile.id === id));
}

function sectionStatus(items: ConfigurationHealthItem[]): ConfigurationHealthStatus {
  if (items.some((item) => item.status === "missing")) return "missing";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function readyItem(id: string, title: string, description: string): ConfigurationHealthItem {
  return { id, title, description, status: "ready" };
}

/** 将已有配置快照归一成健康检查模型，保持纯函数以便契约测试覆盖。 */
export function buildConfigurationHealth(input: ConfigurationHealthInput): ConfigurationHealth {
  const hasTextConnection = hasDefaultConnection(input.aiSnapshot, input.aiSnapshot.defaults.textConnectionId);
  const hasVisionConnection = hasDefaultConnection(input.aiSnapshot, input.aiSnapshot.defaults.visionConnectionId);
  const hasSpeechConnection = hasDefaultConnection(input.aiSnapshot, input.aiSnapshot.defaults.speechConnectionId);
  const enabledAutomations = input.automationSnapshot.definitions.filter((definition) => definition.enabled);

  const aiItems: ConfigurationHealthItem[] = [
    hasTextConnection
      ? readyItem("ai-text", "默认文本连接已配置", "文本生成、关联分析和自动化可使用默认文本模型。")
      : {
          id: "ai-text",
          title: "默认文本连接未配置",
          description: "文本生成、关联分析和自动化需要默认文本连接。",
          status: "missing",
          action: "ai-connections",
          actionLabel: "配置 AI 连接",
        },
    hasVisionConnection
      ? readyItem("ai-vision", "默认多模态连接已配置", "OCR、截图和关键帧分析可以使用多模态模型。")
      : {
          id: "ai-vision",
          title: "默认多模态连接未配置",
          description: "OCR、截图和关键帧分析暂不可用。",
          status: "warning",
          action: "ai-connections",
          actionLabel: "配置多模态",
        },
    hasSpeechConnection
      ? readyItem("ai-speech", "默认语音连接已配置", "云端朗读可以使用默认语音连接。")
      : {
          id: "ai-speech",
          title: "默认语音连接未配置",
          description: "朗读会保持静音，不会回退到浏览器本机音色。",
          status: "warning",
          action: "ai-connections",
          actionLabel: "配置语音",
        },
  ];

  const obsidianItems: ConfigurationHealthItem[] = [];
  if (input.obsidianError) {
    obsidianItems.push({
      id: "obsidian-read",
      title: "Obsidian 状态读取失败",
      description: input.obsidianError,
      status: "warning",
      action: "obsidian",
      actionLabel: "查看知识库",
    });
  } else if (input.obsidianSnapshot.permission === "unsupported") {
    obsidianItems.push({
      id: "obsidian-unsupported",
      title: "当前浏览器不支持目录桥接",
      description: "无法直接双向同步 Vault，可使用一次性 Markdown 导入。",
      status: "warning",
      action: "obsidian",
      actionLabel: "查看替代导入",
    });
  } else if (!input.obsidianSnapshot.connected) {
    obsidianItems.push({
      id: "obsidian-disconnected",
      title: "尚未连接 Obsidian Vault",
      description: "知识图谱桥接未启用，Vault 不会被读取或写入。",
      status: "missing",
      action: "obsidian",
      actionLabel: "连接 Obsidian",
    });
  } else if (input.obsidianSnapshot.permission === "prompt" || input.obsidianSnapshot.permission === "denied") {
    obsidianItems.push({
      id: "obsidian-permission",
      title: "Vault 权限需要恢复",
      description: "浏览器需要重新授权后才能继续读取托管目录。",
      status: "warning",
      action: "obsidian",
      actionLabel: "恢复授权",
    });
  } else if (input.obsidianSnapshot.conflictCount > 0) {
    obsidianItems.push({
      id: "obsidian-conflict",
      title: "存在 Obsidian 同步冲突",
      description: `还有 ${input.obsidianSnapshot.conflictCount} 条冲突需要手动选择保留版本。`,
      status: "warning",
      action: "obsidian",
      actionLabel: "处理冲突",
    });
  } else if (input.obsidianSnapshot.pendingProposalCount > 0) {
    obsidianItems.push({
      id: "obsidian-proposals",
      title: "有待确认的知识演进提案",
      description: `还有 ${input.obsidianSnapshot.pendingProposalCount} 条提案等待确认，不会自动写入知识库或 Vault。`,
      status: "warning",
      action: "obsidian",
      actionLabel: "查看提案",
    });
  } else {
    obsidianItems.push(readyItem("obsidian-ready", "Obsidian 桥接可用", "Vault 权限正常，托管目录可用于受控同步。"));
  }

  const automationItems: ConfigurationHealthItem[] = [];
  if (!input.automationSnapshot.definitions.length) {
    automationItems.push({
      id: "automation-empty",
      title: "尚未创建自动化任务",
      description: "自动化只会在应用打开时运行，需要先创建任务并选择数据范围。",
      status: "missing",
      action: "automation",
      actionLabel: "设置自动化",
    });
  } else if (!enabledAutomations.length) {
    automationItems.push({
      id: "automation-disabled",
      title: "自动化任务均未启用",
      description: "已有任务不会执行，启用后才会按计划在应用打开时运行。",
      status: "warning",
      action: "automation",
      actionLabel: "启用自动化",
    });
  } else if (!hasTextConnection) {
    automationItems.push({
      id: "automation-no-text",
      title: "自动化缺少默认文本连接",
      description: "已有启用任务，但运行时需要默认文本连接生成结果。",
      status: "missing",
      action: "ai-connections",
      actionLabel: "配置默认文本",
    });
  } else if (input.automationSnapshot.unreadCount > 0) {
    automationItems.push({
      id: "automation-unread",
      title: "有未读自动化运行结果",
      description: `收件箱里还有 ${input.automationSnapshot.unreadCount} 条结果需要查看。`,
      status: "warning",
      action: "automation",
      actionLabel: "查看收件箱",
    });
  } else {
    automationItems.push(readyItem("automation-ready", "自动化已就绪", "启用任务会在应用打开、恢复可见或网络恢复时按规则补跑。"));
  }

  const learningItems: ConfigurationHealthItem[] = [];
  if (!input.mistakes.length && !input.knowledgeEntries.length) {
    learningItems.push(
      {
        id: "learning-import-empty",
        title: "还没有学习资料",
        description: "可以先导入资料生成草稿，建立知识库和复盘素材。",
        status: "missing",
        action: "import",
        actionLabel: "导入资料",
      },
      {
        id: "learning-entry-empty",
        title: "也可以从手动录入开始",
        description: "直接录入错题、答案、解析和错因，形成最小学习闭环。",
        status: "missing",
        action: "entry",
        actionLabel: "手动录入",
      },
    );
  } else if (input.mistakes.length && !input.knowledgeEntries.length) {
    learningItems.push({
      id: "learning-no-knowledge",
      title: "错题尚未沉淀为知识资料",
      description: "可以从错题生成知识资料草稿，补齐知识训练闭环。",
      status: "warning",
      action: "import",
      actionLabel: "生成资料草稿",
    });
  } else if (input.dueMistakeCount > 0) {
    learningItems.push({
      id: "learning-due-review",
      title: "有到期错题复盘",
      description: `今天有 ${input.dueMistakeCount} 道错题可以直接开始复盘。`,
      status: "ready",
      action: "review",
      actionLabel: "开始复盘",
    });
  } else if (input.dueKnowledgeCount > 0) {
    learningItems.push({
      id: "learning-due-knowledge",
      title: "有到期知识训练",
      description: `今天有 ${input.dueKnowledgeCount} 条知识资料可以训练。`,
      status: "ready",
      action: "knowledge-training",
      actionLabel: "开始训练",
    });
  } else {
    learningItems.push(readyItem("learning-ready", "学习数据闭环可用", "错题和知识资料已经形成基础复盘与训练数据。"));
  }

  const sections: ConfigurationHealthSection[] = [
    { id: "ai", title: "AI 连接", status: sectionStatus(aiItems), items: aiItems },
    { id: "obsidian", title: "Obsidian", status: sectionStatus(obsidianItems), items: obsidianItems },
    { id: "automation", title: "自动化", status: sectionStatus(automationItems), items: automationItems },
    { id: "learning", title: "学习数据", status: sectionStatus(learningItems), items: learningItems },
  ];
  const allItems = sections.flatMap((section) => section.items);
  const issueCount = allItems.filter((item) => item.status !== "ready").length;
  const readyCount = allItems.length - issueCount;
  const status = sectionStatus(allItems);

  return {
    status,
    summary: status === "ready" ? "核心能力已就绪" : `${issueCount} 项待配置`,
    readyCount,
    issueCount,
    sections,
  };
}

/** 读取 Obsidian 可序列化快照，并和工作台已有快照聚合为配置健康状态。 */
export function useConfigurationHealth(input: Omit<ConfigurationHealthInput, "obsidianError" | "obsidianSnapshot">) {
  const [obsidianSnapshot, setObsidianSnapshot] = useState<ObsidianVaultSnapshot>(defaultObsidianSnapshot);
  const [obsidianError, setObsidianError] = useState("");

  const refreshObsidianHealth = useCallback(async () => {
    try {
      const snapshot = await loadObsidianSnapshot();
      setObsidianSnapshot(snapshot);
      setObsidianError("");
    } catch (error) {
      setObsidianError(error instanceof Error ? error.message : "Obsidian 状态读取失败");
    }
  }, []);

  useEffect(() => {
    let active = true;
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
    return () => {
      active = false;
    };
  }, []);

  const health = useMemo(
    () => buildConfigurationHealth({ ...input, obsidianError, obsidianSnapshot }),
    [input, obsidianError, obsidianSnapshot],
  );

  return { health, refreshObsidianHealth };
}
