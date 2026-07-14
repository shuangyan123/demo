export type SettingsPluginStatus = "ready" | "warning" | "error" | "disabled";
export type SettingsPluginCategory = "featured" | "knowledge-sync" | "import-source" | "study-extension";
export type SettingsPluginPanelKey = "obsidian" | "fenbi-import";
export type SettingsPluginId = "obsidian-vault" | "fenbi-import";
export type SettingsPluginSurface = "plugin" | "skill";

export type SettingsPluginBadge = {
  label: string;
  tone: "neutral" | "blue" | "green" | "yellow" | "red";
};

export type SettingsPluginIcon = {
  label: string;
  background: string;
  assetPath?: string;
};

export type SettingsPluginPrimaryAction = {
  label: string;
  kind: "open" | "configure" | "refresh" | "test" | "install" | "try-in-chat";
};

export type SettingsPluginMenuAction = {
  label: string;
  kind: "docs" | "diagnostics" | "privacy" | "disable";
  href?: string;
};

export type SettingsPluginRuntimeContext = {
  entryCount: number;
  importJobCount: number;
  knowledgeDraftCount: number;
  mistakeCount: number;
  hasTextConnection: boolean;
  hasVisionConnection: boolean;
};

export type SettingsPluginDefinition = {
  id: SettingsPluginId;
  label: string;
  icon: SettingsPluginIcon;
  shortDescription: string;
  description: string;
  category: SettingsPluginCategory;
  surface: SettingsPluginSurface;
  featured?: boolean;
  installed?: boolean;
  providerLabel: string;
  statusBadge: SettingsPluginBadge;
  statusBadgeProvider?: (context: SettingsPluginRuntimeContext) => SettingsPluginBadge;
  primaryAction: SettingsPluginPrimaryAction;
  menuActions: SettingsPluginMenuAction[];
  statusProvider?: (context: SettingsPluginRuntimeContext) => SettingsPluginStatus;
  healthSummaryProvider?: (context: SettingsPluginRuntimeContext) => string;
  recentActivityProvider?: (context: SettingsPluginRuntimeContext) => string;
  recommendedActionProvider?: (context: SettingsPluginRuntimeContext) => string | undefined;
  privacyNote: string;
  capabilities: string[];
  detailPanelLoader: SettingsPluginPanelKey;
  panelLoader: SettingsPluginPanelKey;
  docsUrl?: string;
};

/** 设置插件注册表只声明应用内插件，不加载第三方动态代码。 */
export const settingsPluginDefinitions: SettingsPluginDefinition[] = [
  {
    id: "obsidian-vault",
    label: "Obsidian Vault",
    icon: { label: "Ob", background: "#7c3aed", assetPath: "/plugin-icons/obsidian.svg" },
    shortDescription: "本地 Vault 双向知识同步",
    description: "连接本地 Vault、同步托管知识库、查看 Wikilink 图谱和待确认提案。",
    category: "knowledge-sync",
    surface: "plugin",
    featured: true,
    installed: true,
    providerLabel: "由本地应用提供",
    statusBadge: { label: "本地", tone: "green" },
    statusBadgeProvider: (context) => context.entryCount ? { label: "可同步", tone: "green" } : { label: "需资料", tone: "yellow" },
    primaryAction: { label: "打开", kind: "open" },
    menuActions: [
      { label: "文档", kind: "docs", href: "docs/release-smoke.md" },
      { label: "诊断", kind: "diagnostics" },
      { label: "隐私", kind: "privacy" },
    ],
    statusProvider: (context) => context.entryCount ? "ready" : "warning",
    healthSummaryProvider: (context) => context.entryCount ? `${context.entryCount} 条知识资料可参与同步` : "还没有知识资料可同步",
    recentActivityProvider: (context) => `知识资料 ${context.entryCount} 条`,
    recommendedActionProvider: (context) => context.entryCount ? "连接或同步 Vault" : "先导入资料或从错题生成知识",
    privacyNote: "仅访问用户选择的 Vault 托管目录，不上传 Vault 正文。",
    capabilities: ["Vault 连接", "双向同步", "知识图谱", "提案确认"],
    detailPanelLoader: "obsidian",
    panelLoader: "obsidian",
    docsUrl: "docs/release-smoke.md",
  },
  {
    id: "fenbi-import",
    label: "粉笔导入",
    icon: { label: "粉", background: "#16a34a" },
    shortDescription: "错题文本与截图导入",
    description: "将粉笔错题文本、截图、PDF 和 docx 解析为可确认的公考错题草稿。",
    category: "import-source",
    surface: "plugin",
    installed: true,
    providerLabel: "由导入插件提供",
    statusBadge: { label: "导入源", tone: "green" },
    statusBadgeProvider: (context) => context.hasVisionConnection ? { label: "可用", tone: "green" } : { label: "需多模态", tone: "yellow" },
    primaryAction: { label: "导入", kind: "open" },
    menuActions: [
      { label: "文档", kind: "docs", href: "docs/api.md" },
      { label: "诊断", kind: "diagnostics" },
      { label: "隐私", kind: "privacy" },
    ],
    statusProvider: (context) => context.hasVisionConnection ? "ready" : "warning",
    healthSummaryProvider: (context) => context.hasVisionConnection ? "文本、文件和截图 OCR 均可用" : "文本/文件可用；截图 OCR 需要默认多模态连接",
    recentActivityProvider: (context) => `导入批次 ${context.importJobCount} 个，知识草稿 ${context.knowledgeDraftCount} 条`,
    recommendedActionProvider: (context) => context.hasVisionConnection ? "导入粉笔资料" : "配置默认多模态连接",
    privacyNote: "本地解析优先；AI/OCR 只走已配置默认连接，不把原文写入插件配置。",
    capabilities: ["文本解析", "截图 OCR", "批次诊断", "草稿确认"],
    detailPanelLoader: "fenbi-import",
    panelLoader: "fenbi-import",
    docsUrl: "docs/api.md",
  },
];
