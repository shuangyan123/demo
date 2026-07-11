import {
  Activity, ArrowLeft, Ban, Blocks, BookOpen, Bot, Brain, CalendarClock, ChartNoAxesColumnIncreasing,
  ChevronDown, ChevronRight, ClipboardCheck, Clock3, FileInput, FilePenLine, Folder,
  FolderOpen, FolderPlus, GripVertical, LayoutDashboard, Library, MessageSquare, MessagesSquare, Mic, Monitor,
  Moon, MoreHorizontal, Paperclip, Plus, Search, Send, Settings, Slash, SlidersHorizontal, Sparkles, Sun, UserRoundPlus,
  Wrench, X, type LucideIcon,
} from "lucide-react";

/** 应用功能图标名称；品牌 Logo 继续由 ProviderIcon 独立管理。 */
export type AppIconName =
  | "activity" | "appearance" | "automation" | "back" | "blocks" | "board" | "bot" | "configuration"
  | "dashboard" | "dark" | "diagnostics" | "drag" | "entry" | "folder" | "folderOpen" | "import"
  | "interview" | "knowledge" | "knowledgeTraining" | "library" | "light" | "mcp" | "message"
  | "mic" | "more" | "motion" | "newChat" | "none" | "paperclip" | "personalization" | "plugins"
  | "project" | "review" | "scheduled" | "search" | "send" | "settings" | "slash" | "sparkles"
  | "stats" | "system" | "tool" | "tutoring" | "chevronDown" | "chevronRight" | "close" | "folderPlus";

const icons: Record<AppIconName, LucideIcon> = {
  activity: Activity, appearance: Sun, automation: CalendarClock, back: ArrowLeft, blocks: Blocks,
  board: ClipboardCheck, bot: Bot, configuration: SlidersHorizontal, dashboard: LayoutDashboard, dark: Moon,
  diagnostics: Activity, drag: GripVertical, entry: FilePenLine, folder: Folder, folderOpen: FolderOpen,
  import: FileInput, interview: MessagesSquare, knowledge: BookOpen, knowledgeTraining: Brain, library: Library,
  light: Sun, mcp: Blocks, message: MessageSquare, mic: Mic, more: MoreHorizontal, motion: Activity,
  newChat: Plus, none: Ban, paperclip: Paperclip, personalization: UserRoundPlus, plugins: Blocks,
  project: Folder, review: ClipboardCheck, scheduled: Clock3, search: Search, send: Send, settings: Settings,
  slash: Slash, sparkles: Sparkles, stats: ChartNoAxesColumnIncreasing, system: Monitor, tool: Wrench,
  tutoring: Bot, chevronDown: ChevronDown, chevronRight: ChevronRight, close: X, folderPlus: FolderPlus,
};

/** 统一 Lucide 的尺寸、线宽与无障碍表现；交互名称由外层按钮提供。 */
export function AppIcon({ name, size = 18, strokeWidth = 1.8 }: { name: AppIconName; size?: 16 | 18 | 20 | 22; strokeWidth?: number }) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={strokeWidth} />;
}
