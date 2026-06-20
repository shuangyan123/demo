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

export type ApiProvider =
  | "openai"
  | "google"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "qwen"
  | "elevenlabs"
  | "azure"
  | "minimax"
  | "zhipu"
  | "kimi"
  | "doubao"
  | "custom";
export type ApiFormat = "responses" | "chat_completions" | "google_generate_content" | "anthropic_messages" | "azure_speech" | "qwen_multimodal";
export type AiCapability = "text" | "vision" | "structured_output" | "speech" | "streaming";
export type AiConnectionPurpose = "text" | "vision" | "speech";
export type PersonaModule = "tutoring" | "interview" | "knowledge_internalization";
export type PersonaStrictness = "gentle" | "balanced" | "strict";
export type PersonaVerbosity = "concise" | "balanced" | "detailed";
export type KnowledgeLinkKind = "related" | "internalized";
export type KnowledgeInternalizationMode = "create" | "merge";
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
  model: string;
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
  updatedAt: string;
};

export type AiConnectionSnapshot = {
  profiles: ApiConnectionProfile[];
  defaults: AiConnectionDefaults;
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
  model: string;
  voiceId: string;
  style: string;
};

export type PersonaDisplayMode = "default" | "custom";

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

export type ViewKey = "dashboard" | "library" | "review" | "knowledgeTraining" | "stats" | "knowledge" | "interview" | "tutoring" | "import" | "entry" | "settings";
