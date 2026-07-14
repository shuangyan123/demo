import type { ApiProvider } from "./domains/ai-provider";
export type {
  AiQuotaAction,
  AiQuotaAdapterInput,
  AiQuotaCredentialKey,
  AiQuotaErrorCode,
  AiQuotaFetchStrategy,
  AiQuotaMetric,
  AiQuotaPluginConfig,
  AiQuotaProviderAdapter,
  AiQuotaProviderDescriptor,
  AiQuotaSnapshot,
  AiQuotaSourceMode,
  AiQuotaVerificationResult,
} from "./domains/ai-quota";

export type { ApiProvider } from "./domains/ai-provider";
export type {
  AiModelReasoningDescriptor,
  AiModelRuntimeCustomRange,
  AiModelRuntimeDescriptor,
  AiModelRuntimeOption,
  AiModelRuntimeValue,
  AiSelectedRuntimeValues,
} from "./domains/ai-model";

export const BOARD_OPTIONS = ["政治理论", "常识判断", "言语理解与表达", "数量关系", "判断推理", "资料分析"] as const;

export const KNOWLEDGE_CATEGORIES = ["政治理论", "常识判断", "申论"] as const;

export type Board = (typeof BOARD_OPTIONS)[number];
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export type ReviewResult = "correct" | "uncertain" | "wrong";
export type ExportFormat = "json" | "csv" | "markdown";
export type ExportScope = "selected" | "filtered";
export type InterviewType = "structured" | "structured_group" | "leaderless_group";
export type InterviewDifficulty = "easy" | "medium" | "hard";
export type InterviewPlanStatus = "active" | "paused" | "completed";
export type InterviewStage =
  | "briefing"
  | "preparation"
  | "answering"
  | "follow_up"
  | "peer_review"
  | "response"
  | "discussion"
  | "summary"
  | "evaluated";
export type InterviewStatus = "draft" | "active" | "evaluated";
export type InterviewSpeaker = "ai_interviewer" | "candidate" | "ai_peer" | "system";
export type InterviewLinkSourceType = "question" | "session";
export type InterviewLinkTargetType = "knowledge" | "mistake";
export type TutoringMode = "camera" | "screen" | "upload";
export type TutoringSessionStatus = "setup" | "active" | "paused" | "summarizing" | "completed";
export type TutoringSpeaker = "student" | "ai_tutor" | "system";
export type TutoringPlanStatus = "active" | "paused" | "completed";
export type TutoringLinkSourceType = "session" | "turn" | "plan";
export type TutoringLinkTargetType = "knowledge" | "mistake";
export type ImportBatchStatus = "queued" | "parsing" | "parsed" | "saved" | "failed";
export type ImportBatchSource = "fenbi" | "text" | "file";
export type ImportDraftIssue = "low_confidence" | "missing_answer" | "unknown_board" | "duplicate";

export type BulkSelectionState<TId extends string> = {
  ids: Set<TId>;
  count: number;
  hasSelection: boolean;
  allVisibleSelected: boolean;
};

export type ImportType = "text" | "file" | "ocr";
export type ImportStatus = "draft" | "parsing" | "parsed" | "saved" | "pending_ocr" | "failed";

export type ApiFormat = "responses" | "chat_completions" | "google_generate_content" | "anthropic_messages" | "azure_speech" | "qwen_multimodal";
export type AiCapability = "text" | "vision" | "structured_output" | "speech" | "transcription" | "realtime" | "streaming";
export type AiConnectionPurpose = "text" | "vision" | "speech" | "transcription" | "realtime";
export type PersonaModule = "tutoring" | "interview" | "knowledge_internalization";
export type PersonaStrictness = "gentle" | "balanced" | "strict";
export type PersonaVerbosity = "concise" | "balanced" | "detailed";
export type KnowledgeLinkKind = "related" | "internalized";
export type KnowledgeInternalizationMode = "create" | "merge";
export type KnowledgeEvolutionMode = "create" | "merge" | "link";
export type KnowledgeEvolutionSourceType = "mistake" | "interview" | "tutoring" | "knowledge" | "conversation";
export type KnowledgeEvolutionStatus = "pending" | "accepted" | "rejected";
export type ObsidianSyncStatus = "synced" | "local_changed" | "vault_changed" | "conflict" | "disconnected";
export type ObsidianPermissionState = "granted" | "prompt" | "denied" | "unsupported";
export type ObsidianConnectionRecovery = "none" | "reauthorize" | "reselect" | "unsupported";
export type ThemeMode = "light" | "dark" | "system";
export type ReducedMotionMode = "system" | "on" | "off";
export type DifferenceMarker = "color" | "symbol";
export type PetPreference = "codex" | "none";

export type ThemeConfig = {
  name: string;
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  codeFont: string;
  diffuseGradient: boolean;
  contrast: number;
};

export type Mistake = {
  id: string;
  board: Board;
  source: string;
  stem: string;
  answer: string;
  explanation: string;
  reasons: string[];
  tags: string[];
  mastery: number;
  nextReviewAt: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEntry = {
  id: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  favorite: boolean;
  mastery: number;
  nextReviewAt: string;
  lastReviewedAt?: string;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Obsidian Vault 连接只在 repository 内保留目录句柄，React 只消费可序列化快照。 */
export type ObsidianVaultConfig = {
  id: "default";
  vaultName: string;
  managedRoot: string;
  directoryHandle?: FileSystemDirectoryHandle;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ObsidianVaultSnapshot = Omit<ObsidianVaultConfig, "directoryHandle"> & {
  connected: boolean;
  permission: ObsidianPermissionState;
  recovery: ObsidianConnectionRecovery;
  mappedCount: number;
  conflictCount: number;
  pendingProposalCount: number;
};

export type ObsidianNoteMapping = {
  path: string;
  knowledgeId: string;
  category: KnowledgeCategory;
  baseHash: string;
  vaultHash: string;
  appHash: string;
  status: ObsidianSyncStatus;
  wikilinks: string[];
  sourceRefs: string[];
  conflictVaultMarkdown?: string;
  conflictAppMarkdown?: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ObsidianGraphNode = {
  id: string;
  title: string;
  category?: KnowledgeCategory;
  knowledgeId?: string;
  path?: string;
  status: "synced" | "issue" | "external";
};

export type ObsidianGraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
};

export type ObsidianGraphSnapshot = {
  nodes: ObsidianGraphNode[];
  edges: ObsidianGraphEdge[];
  syncedCount: number;
  externalCount: number;
  issueCount: number;
};

export type KnowledgeEvolutionProposal = {
  id: string;
  mode: KnowledgeEvolutionMode;
  status: KnowledgeEvolutionStatus;
  category: KnowledgeCategory;
  sourceType: KnowledgeEvolutionSourceType;
  sourceIds: string[];
  targetKnowledgeId?: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  proposedLinks: string[];
  reason: string;
  confidence: number;
  /** 记录提案来自哪条对话，只保存标识，不复制完整对话上下文。 */
  conversationId?: string;
  /** 关联对话内的工具运行，便于在消息时间线中恢复提案状态。 */
  runId?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEvolutionGenerationDiagnostic = {
  id: string;
  tone: "info" | "warning" | "error";
  message: string;
};

export type KnowledgeEvolutionGenerationResult = {
  proposals: KnowledgeEvolutionProposal[];
  diagnostics: KnowledgeEvolutionGenerationDiagnostic[];
  parsedCount: number;
  filteredCount: number;
  sourceCount: number;
  requestId?: string;
  emptyKind?: "no_sources" | "empty_response" | "parse_error" | "filtered";
  emptyReason?: string;
};

export type ObsidianSyncReport = {
  imported: number;
  exported: number;
  unchanged: number;
  conflicts: number;
  disconnected: number;
  warnings: string[];
};

export type ImportDraft = {
  id: string;
  batchId?: string;
  fileName?: string;
  fileType?: string;
  selected: boolean;
  needsReview: boolean;
  issues?: ImportDraftIssue[];
  board: Board;
  source: string;
  stem: string;
  options?: string[];
  answer: string;
  myAnswer?: string;
  explanation: string;
  reasons: string[];
  tags: string[];
  mastery: number;
  confidence?: number;
};

export type PersistedImportDraft = ImportDraft & {
  batchId: string;
  fileName?: string;
  fileType?: string;
  rawText: string;
  issues: ImportDraftIssue[];
  options: string[];
  myAnswer: string;
  createdAt: string;
  updatedAt: string;
};

export type Attempt = {
  id: string;
  mistakeId: string;
  result: ReviewResult;
  confidence: number;
  durationSec?: number;
  reviewedAt: string;
};

export type KnowledgeAttempt = {
  id: string;
  knowledgeId: string;
  result: ReviewResult;
  confidence: number;
  reviewedAt: string;
};

export type KnowledgeMistakeLink = {
  id: string;
  mistakeId: string;
  knowledgeId: string;
  kind: KnowledgeLinkKind;
  reason: string;
  score: number;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeInternalizationDraft = {
  id: string;
  selected: boolean;
  mode: KnowledgeInternalizationMode;
  sourceMistakeIds: string[];
  targetKnowledgeId?: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  principle: string;
  conditions: string[];
  pitfalls: string[];
  steps: string[];
  transferPractice: string;
  content: string;
  tags: string[];
  reason: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type InterviewQuestion = {
  id: string;
  type: InterviewType;
  title: string;
  prompt: string;
  material: string;
  tags: string[];
  source: string;
  difficulty?: InterviewDifficulty;
  expectedDurationSec?: number;
  favorite?: boolean;
  lastPracticedAt?: string;
  practiceCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type InterviewQuestionDraft = {
  id: string;
  selected: boolean;
  type: InterviewType;
  title: string;
  prompt: string;
  material: string;
  tags: string[];
  source: string;
  difficulty: InterviewDifficulty;
  expectedDurationSec: number;
  confidence: number;
  issues: string[];
};

export type InterviewQuestionSet = {
  id: string;
  type: InterviewType | "mixed";
  title: string;
  description: string;
  questionIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type InterviewPracticePlan = {
  id: string;
  title: string;
  type: InterviewType | "mixed";
  sourceSetId?: string;
  questionIds: string[];
  targetSessionCount: number;
  completedSessionCount: number;
  nextPracticeAt: string;
  status: InterviewPlanStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

export type InterviewSession = {
  id: string;
  questionId: string;
  planId?: string;
  type: InterviewType;
  title: string;
  questionPrompt: string;
  questionMaterial: string;
  status: InterviewStatus;
  stage: InterviewStage;
  startedAt: string;
  completedAt?: string;
  totalDurationSec: number;
  transcriptText: string;
  createdAt: string;
  updatedAt: string;
};

export type InterviewTurn = {
  id: string;
  sessionId: string;
  speaker: InterviewSpeaker;
  stage: InterviewStage;
  content: string;
  durationSec?: number;
  createdAt: string;
};

export type InterviewScoreDimension = {
  name: string;
  score: number;
  maxScore: number;
  comment: string;
};

export type InterviewEvaluation = {
  id: string;
  sessionId: string;
  type: InterviewType;
  totalScore: number;
  dimensions: InterviewScoreDimension[];
  strengths: string[];
  problems: string[];
  suggestions: string[];
  evidence: string[];
  createdAt: string;
  updatedAt: string;
};

export type InterviewLink = {
  id: string;
  sourceType: InterviewLinkSourceType;
  sourceId: string;
  targetType: InterviewLinkTargetType;
  targetId: string;
  reason: string;
  score: number;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
};

export type TutoringSession = {
  id: string;
  mode: TutoringMode;
  topic: string;
  goal: string;
  status: TutoringSessionStatus;
  startedAt: string;
  completedAt?: string;
  transcriptText: string;
  summary: string;
  nextActions: string[];
  frameCount: number;
  turnCount: number;
  estimatedCostNote: string;
  createdAt: string;
  updatedAt: string;
};

export type TutoringTurn = {
  id: string;
  sessionId: string;
  speaker: TutoringSpeaker;
  content: string;
  frameDescription?: string;
  boardNotes?: string[];
  detectedProblem?: string;
  studentAction?: string;
  nextQuestion?: string;
  confidence?: number;
  createdAt: string;
};

export type TutoringPlan = {
  id: string;
  title: string;
  objective: string;
  linkedKnowledgeIds: string[];
  linkedMistakeIds: string[];
  nextTask: string;
  nextPracticeAt: string;
  status: TutoringPlanStatus;
  createdAt: string;
  updatedAt: string;
};

export type TutoringLink = {
  id: string;
  sourceType: TutoringLinkSourceType;
  sourceId: string;
  targetType: TutoringLinkTargetType;
  targetId: string;
  reason: string;
  score: number;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
};

export type TutoringSnapshot = {
  sessions: TutoringSession[];
  turns: TutoringTurn[];
  plans: TutoringPlan[];
  links: TutoringLink[];
};

export type InterviewSnapshot = {
  questions: InterviewQuestion[];
  questionSets: InterviewQuestionSet[];
  practicePlans: InterviewPracticePlan[];
  sessions: InterviewSession[];
  turns: InterviewTurn[];
  evaluations: InterviewEvaluation[];
  links: InterviewLink[];
};

export type AssociationSuggestion = {
  id: string;
  selected: boolean;
  targetId: string;
  relatedId: string;
  mistakeId: string;
  knowledgeId: string;
  score: number;
  reason: string;
  evidence: string[];
  source: "local" | "ai";
};

export type ImportJob = {
  id: string;
  type: ImportType;
  fileName?: string;
  fileType?: string;
  rawText: string;
  status: ImportStatus;
  message: string;
  parsedCount: number;
  error?: string;
  createdAt: string;
};

export type ImportBatch = {
  id: string;
  source: ImportBatchSource;
  fileNames: string[];
  fileCount: number;
  status: ImportBatchStatus;
  parsedCount: number;
  savedCount: number;
  message: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type FenbiParseResult = {
  batch: ImportBatch;
  drafts: PersistedImportDraft[];
};

/** 导入插件支持的输入类型；粉笔先作为公考专项的首个内置 provider。 */
export type ImportProviderInputKind = "text" | "file" | "image" | "pdf" | "docx";

/** 导入插件解析模式；local 不调用 AI，ai 只使用默认文本连接。 */
export type ImportProviderParseMode = "local" | "ai";

/** 导入插件诊断只保存摘要，不持久化完整原文。 */
export type ImportProviderDiagnostic = {
  tone: "info" | "warning" | "error";
  message: string;
};

/** 导入插件统一解析结果，供设置插件页和旧导入视图复用。 */
export type ImportProviderParseResult = {
  providerId: string;
  sourceLabel: string;
  mode: ImportProviderParseMode | "file";
  drafts: ImportDraft[];
  diagnostics: ImportProviderDiagnostic[];
};

/** 应用内部导入插件接口，不执行第三方动态代码。 */
export type ImportProviderPlugin = {
  id: "fenbi";
  label: string;
  description: string;
  category: "civil-service";
  privacyNote: string;
  supportedInputs: ImportProviderInputKind[];
  requiredConnections: AiConnectionPurpose[];
  diagnosticCapabilities: string[];
  retryPolicy: "safe-reparse" | "manual-only";
  draftSink: "import-drafts";
  aiCapabilities: Array<"text-parse" | "vision-ocr">;
  parseText: (input: {
    rawText: string;
    mode: ImportProviderParseMode;
    textConnection?: ApiConnectionProfile;
  }) => Promise<ImportProviderParseResult>;
  parseFile: (input: {
    file: File;
    visionConnection?: ApiConnectionProfile;
  }) => Promise<ImportProviderParseResult>;
};

export type ApiSetting = {
  id: "default";
  provider: ApiProvider;
  baseUrl: string;
  model: string;
  encryptedKey: string;
  iv: string;
  maskedKey: string;
  testStatus?: "idle" | "success" | "failed";
  testMessage?: string;
  updatedAt: string;
};

export type ApiConnectionProfile = {
  id: string;
  label: string;
  provider: ApiProvider;
  apiFormat: ApiFormat;
  baseUrl: string;
  /** 仅用于读取旧连接；新连接的模型由会话或能力默认值持有。 */
  model?: string;
  capabilities: AiCapability[];
  encryptedKey: string;
  iv: string;
  maskedKey: string;
  providerOptions: Record<string, string>;
  testStatus?: "idle" | "success" | "failed";
  testMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiConnectionDefaults = {
  id: "default";
  textConnectionId?: string;
  visionConnectionId?: string;
  speechConnectionId?: string;
  transcriptionConnectionId?: string;
  realtimeConnectionId?: string;
  textModelId?: string;
  visionModelId?: string;
  speechModelId?: string;
  transcriptionModelId?: string;
  realtimeModelId?: string;
  updatedAt: string;
};

/** 一次真实调用所需的连接与模型选择，避免业务重新依赖连接中的旧 model 字段。 */
export type AiRuntimeModelSelection = {
  connection: ApiConnectionProfile;
  modelId: string;
  /** 归一化运行值；厂商字段只在服务端 mapper 内生成。 */
  selectedRuntimeValues?: import("./domains/ai-model").AiSelectedRuntimeValues;
};

export type AiConnectionSnapshot = {
  profiles: ApiConnectionProfile[];
  defaults: AiConnectionDefaults;
};

export type AiUsageRecord = {
  id: string;
  provider: ApiProvider;
  connectionId?: string;
  model?: string;
  purpose: "text" | "vision" | "speech" | "transcription" | "quota";
  module: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedAmount?: number;
  currency?: string;
  status: "succeeded" | "failed";
  error?: string;
  createdAt: string;
};

export type PersonaProfile = {
  id: string;
  name: string;
  role: string;
  teachingStyle: string;
  questioningStyle: string;
  strictness: PersonaStrictness;
  verbosity: PersonaVerbosity;
  customInstructions: string;
  builtIn: boolean;
};

export type VoiceProfile = {
  rate: number;
  volume: number;
  pitch?: number;
  emotion?: string;
  languageBoost?: string;
  model: string;
  voiceId: string;
  style: string;
};

export type PersonaDisplayMode = "default" | "custom";

/** 定制人设库的视觉密度模式；不改变默认/定制两类业务模式。 */
export type CustomPersonaViewMode = "flashcard" | "avatar";

export type PersonaCustomization = {
  name?: string;
  role?: string;
  teachingStyle?: string;
  questioningStyle?: string;
  strictness?: PersonaStrictness;
  verbosity?: PersonaVerbosity;
  customInstructions?: string;
  imageDataUrl?: string;
  voice?: VoiceProfile;
};

export type PersonalizationSettings = {
  id: "default";
  personaDisplayMode: PersonaDisplayMode;
  customPersonaViewMode: CustomPersonaViewMode;
  defaultPersonaId: string;
  modulePersonaIds: Partial<Record<PersonaModule, string>>;
  customPersonas: PersonaProfile[];
  personaCustomizations: Record<string, PersonaCustomization>;
  updatedAt: string;
};

export type AppearanceSettings = {
  id: "default";
  mode: ThemeMode;
  lightTheme: ThemeConfig;
  darkTheme: ThemeConfig;
  pointerCursor: boolean;
  reducedMotion: ReducedMotionMode;
  uiFontSize: number;
  codeFontSize: number;
  diffMarker: DifferenceMarker;
  pet: PetPreference;
  updatedAt: string;
};

export type ReviewSnapshot = {
  mistakes: Mistake[];
  attempts: Attempt[];
  importJobs: ImportJob[];
};

export type KnowledgeTrainingSnapshot = {
  entries: KnowledgeEntry[];
  attempts: KnowledgeAttempt[];
  dueEntries: KnowledgeEntry[];
  lowEntries: KnowledgeEntry[];
};

export type KnowledgeCategorySummary = {
  category: KnowledgeCategory;
  total: number;
  due: number;
  weak: number;
  favorites: number;
};

export type KnowledgeQueueFilter = "due" | "weak" | "favorite" | "all";

export type KnowledgeImportDraft = {
  id: string;
  selected: boolean;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  mastery: number;
};

export type KnowledgeStarterTemplate = {
  category: KnowledgeCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  mastery: number;
};

/** 自动化内置模板；custom 表示用户自行维护提示词。 */
export type AutomationTemplateId = "daily_review" | "knowledge_evolution" | "weekly_progress" | "custom";

/** 自动化只读取用户明确选择的数据范围。 */
export type AutomationSourceScope = "mistakes" | "knowledge" | "interview" | "tutoring" | "obsidian";

/** 自动化调度配置；所有时间按 definition.timeZone 解释。 */
export type AutomationSchedule =
  | { kind: "interval"; intervalMinutes: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "cron"; expression: string };

/** 本地自动化定义；租约字段只由 repository 更新，避免多标签重复执行。 */
export type AutomationDefinition = {
  id: string;
  name: string;
  templateId: AutomationTemplateId;
  prompt: string;
  sourceScopes: AutomationSourceScope[];
  enabled: boolean;
  timeZone: string;
  schedule: AutomationSchedule;
  nextRunAt?: string;
  lastRunAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** 运行记录只保存实际进入执行后的状态，不保留未实现的队列态。 */
export type AutomationRunStatus = "running" | "succeeded" | "failed";
export type AutomationRunTrigger = "manual" | "scheduled" | "catchup";

/** 自动化运行只持久化摘要，不保存完整上下文或完整提示词。 */
export type AutomationContextSummary = {
  scope: AutomationSourceScope;
  label: string;
  count: number;
  sampleTitles: string[];
  warning?: string;
};

/** 自动化失败分类用于给出可恢复动作，避免只展示原始错误。 */
export type AutomationFailureCategory = "missing_connection" | "network" | "permission" | "model" | "empty_scope" | "unknown";
export type AutomationRecoveryAction = "configure_ai_connection" | "open_knowledge" | "open_import" | "open_entry" | "check_network" | "retry" | "none";

/** 每次自动化运行都进入收件箱，AI 结果只保存文本和待确认提案引用。 */
export type AutomationRun = {
  id: string;
  automationId: string;
  automationName: string;
  status: AutomationRunStatus;
  trigger: AutomationRunTrigger;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  unread: boolean;
  missedCount: number;
  proposalIds: string[];
  contextSummary?: AutomationContextSummary[];
  contextCharCount?: number;
  failureCategory?: AutomationFailureCategory;
  failureRecoveryAction?: AutomationRecoveryAction;
  createdAt: string;
};

export type AutomationSnapshot = {
  definitions: AutomationDefinition[];
  runs: AutomationRun[];
  unreadCount: number;
};

export type Filters = {
  board: Board | "全部";
  mastery: "all" | "low" | "mid" | "high";
  search: string;
};

export type KnowledgeFilters = {
  category: KnowledgeCategory | "全部";
  search: string;
  tag: string;
  favoriteOnly: boolean;
};

export type ViewKey = "conversation" | "dashboard" | "library" | "review" | "knowledgeTraining" | "stats" | "knowledge" | "automation" | "interview" | "tutoring" | "import" | "entry" | "plugins" | "settings";

export type StudyDomainId = "civil-service";

/** 专项学习模块声明；视图仍复用现有工作台 key。 */
export type StudyModuleDefinition = {
  id: Exclude<ViewKey, "automation" | "import" | "plugins" | "settings">;
  label: string;
  description: string;
  icon: string;
  capabilities: string[];
  healthSignals?: Array<"review" | "knowledge" | "ai" | "schedule" | "obsidian" | "import">;
  recommendedActionLabel?: string;
};

/** 专项首页的学习链路声明，供不同考试项目复用同一仪表盘结构。 */
export type StudyDomainFlowStep = {
  id: "import" | "mistake" | "knowledge" | "training" | "tutoring" | "scheduled" | "obsidian";
  label: string;
  description: string;
  moduleId: ViewKey | "plugins";
};

/** 专项学习项目声明；公考是第一组，后续专项按同一 registry 扩展。 */
export type StudyDomainDefinition = {
  id: StudyDomainId;
  label: string;
  description: string;
  modules: StudyModuleDefinition[];
  dashboard: {
    headline: string;
    flow: StudyDomainFlowStep[];
    defaultNextActions: string[];
  };
};

/** “已安排”是原本自动化能力的产品入口，不新增调度数据结构。 */
export type ScheduledWorkspaceState = {
  viewKey: "automation";
  label: "已安排";
  description: string;
  unreadCount: number;
};

export type AiConversationKind = "general" | "tutoring" | "interview" | "knowledge" | "import";
export type AiConversationStatus = "active" | "archived";
export type AiConversationRole = "user" | "assistant" | "system" | "tool";
export type AiConversationSourceType = "manual" | "mistake" | "tutoring" | "interview" | "import" | "knowledge";

export type AiProject = {
  id: string;
  label: string;
  description: string;
  studyDomainId?: StudyDomainId;
  createdAt: string;
  updatedAt: string;
};

/** 对话文件夹即分类；允许嵌套，但不持久化任何会话正文。 */
export type AiConversationFolder = {
  id: string;
  projectId: string;
  parentId?: string;
  label: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationAttachment = {
  id: string;
  conversationId: string;
  messageId?: string;
  kind: "image" | "file" | "audio" | "vault" | "context";
  label: string;
  summary: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: string;
};

export type AiConversation = {
  id: string;
  projectId: string;
  studyDomainId?: StudyDomainId;
  title: string;
  kind: AiConversationKind;
  status: AiConversationStatus;
  sourceType: AiConversationSourceType;
  sourceId?: string;
  folderId?: string;
  selectedConnectionId?: string;
  /** 对话级模型覆盖；连接档案继续负责密钥和协议，模型可按会话切换。 */
  selectedModelId?: string;
  /** 会话级归一化运行值；作为普通对象写入现有记录，无需升级 Dexie schema。 */
  selectedRuntimeValues?: import("./domains/ai-model").AiSelectedRuntimeValues;
  /** @deprecated 仅供 repository 读取历史会话并迁移到 selectedRuntimeValues。 */
  selectedReasoningEffort?: string;
  /** @deprecated 仅供 repository 读取历史会话并迁移到 selectedRuntimeValues。 */
  selectedSpeedMode?: "standard" | "priority";
  summary?: string;
  lastMessagePreview?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationMessage = {
  id: string;
  conversationId: string;
  role: AiConversationRole;
  content: string;
  attachmentIds: string[];
  usage?: AiUsageRecord;
  createdAt: string;
};

export type AiConversationRunStep = {
  id: string;
  conversationId: string;
  runId: string;
  label: string;
  state: "pending" | "running" | "done" | "error";
  text?: string;
  usage?: AiUsageRecord["totalTokens"];
  createdAt: string;
  updatedAt: string;
};

export type CommandSearchResult = {
  id: string;
  group: "chat" | "project" | "study" | "mistake" | "knowledge" | "scheduled" | "plugin" | "settings";
  label: string;
  description: string;
  shortcut?: string;
  view?: ViewKey;
  projectId?: string;
  conversationId?: string;
  pluginId?: string;
  settingsSection?: string;
};

export type McpServerProfile = {
  id: string;
  label: string;
  endpoint: string;
  enabled: boolean;
  authMode: "none" | "bearer";
  /** Bearer Token 仅在设置仓储中加密保存，普通快照永不返回明文。 */
  encryptedToken?: string;
  encryptedTokenIv?: string;
  createdAt: string;
  updatedAt: string;
};

export type McpToolPermission = "ask" | "allow_session" | "deny";

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  permission: McpToolPermission;
};

export type McpDiscoveryResult = {
  serverId: string;
  status: "untested" | "ready" | "error";
  tools: string[];
  resources: string[];
  prompts: string[];
  message: string;
  checkedAt?: string;
  toolDescriptors?: McpToolDescriptor[];
};

export type AiModelCatalogEntry = {
  id: string;
  label: string;
  provider: ApiProvider;
  purposes: AiConnectionPurpose[];
  capabilities: AiCapability[];
  status: "recommended" | "stable" | "preview" | "deprecated" | "manual";
  source: "official_live" | "official_fallback" | "manual";
  /** 用于两级选择器按最近两代模型家族分组。 */
  family?: string;
  generation?: string;
  modalityGroup?: "text" | "multimodal" | "speech" | "transcription" | "realtime";
  lifecycle?: "active" | "preview" | "deprecated";
  documentationUrl?: string;
  verifiedAt?: string;
};

/** 厂商语音能力声明；设置 UI 只渲染厂商真实支持的参数。 */
export type VoiceProviderDescriptor = {
  provider: ApiProvider;
  models: string[];
  voices: Array<{ id: string; label: string }>;
  supports: { style: boolean; speed: boolean; volume: boolean; pitch: boolean; emotion: boolean; languageBoost: boolean };
};

/** 实时语音配置只在当前内存会话中使用，不写入 IndexedDB。 */
export type RealtimeVoiceSessionConfig = {
  provider: Extract<ApiProvider, "openai" | "google" | "zhipu">;
  connectionId: string;
  model: string;
  voiceId: string;
};

/** UI 消费的归一化实时事件，不暴露厂商原始事件。 */
export type RealtimeVoiceEvent =
  | { type: "setup" | "connected" | "interrupted" | "ended" }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "audio"; pcmBase64: string; sampleRate: number }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "error"; message: string };

/** 新建连接允许展示的主流厂商；旧 ApiProvider 联合仍负责历史数据兼容。 */
export type ActiveApiProvider = "openai" | "google" | "anthropic" | "xai" | "deepseek" | "minimax" | "zhipu";

export type AiProviderCatalogEntry = {
  provider: ApiProvider;
  label: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  capabilities: AiCapability[];
  documentationUrl: string;
  modelListStrategy: "official_api" | "static_catalog" | "manual";
  models: AiModelCatalogEntry[];
};

export type CodexMessage = {
  id: string;
  role: AiConversationRole;
  text: string;
  createdAt: string;
};

export type CodexToolStep = {
  id: string;
  label: string;
  state: "pending" | "running" | "done" | "error";
  text?: string;
  updatedAt: string;
};

export type CodexConversation = {
  id: string;
  title: string;
  projectId?: string;
  studyDomainId?: StudyDomainId;
  messages: CodexMessage[];
  toolSteps: CodexToolStep[];
  usage?: AiUsageRecord;
  updatedAt: string;
};
