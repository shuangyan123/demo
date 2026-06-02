export const BOARD_OPTIONS = ["政治理论", "常识判断", "言语理解与表达", "数量关系", "判断推理", "资料分析"] as const;

export type Board = (typeof BOARD_OPTIONS)[number];

export type ReviewResult = "correct" | "uncertain" | "wrong";

export type ImportType = "text" | "file" | "ocr";
export type ImportStatus = "draft" | "parsing" | "parsed" | "saved" | "pending_ocr" | "failed";

export type ApiProvider = "openai" | "deepseek" | "qwen" | "zhipu" | "kimi" | "doubao" | "custom";
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
  translucentSidebar: boolean;
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

export type ImportDraft = {
  id: string;
  selected: boolean;
  needsReview: boolean;
  board: Board;
  source: string;
  stem: string;
  answer: string;
  explanation: string;
  reasons: string[];
  tags: string[];
  mastery: number;
  confidence?: number;
};

export type Attempt = {
  id: string;
  mistakeId: string;
  result: ReviewResult;
  confidence: number;
  durationSec?: number;
  reviewedAt: string;
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

export type ApiSettingsForm = {
  provider: ApiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
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
  apiSetting?: ApiSetting;
};

export type Filters = {
  board: Board | "全部";
  mastery: "all" | "low" | "mid" | "high";
  search: string;
};

export type ViewKey = "dashboard" | "library" | "review" | "stats" | "import" | "entry" | "settings";
