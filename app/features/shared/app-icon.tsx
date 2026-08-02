import {
  Activity, ArrowLeft, Ban, Blocks, BookOpen, Bot, Brain, CalendarClock, CalendarDays, Camera, ChartNoAxesColumnIncreasing,
  Check, ChevronDown, ChevronRight, ClipboardCheck, Clock3, FileInput, FilePenLine, Folder,
  FolderOpen, FolderPlus, GripVertical, LayoutDashboard, Library, MessageSquare, MessagesSquare, Mic, Monitor,
  ArrowDown, CircleAlert, Copy, Download, ExternalLink, Info, ListTree, Moon, MoreHorizontal, Paperclip, Phone, Play, Plus, RefreshCw, RotateCcw, Save, ScanLine, Search, Send, Settings, Settings2, Square, Upload, Undo2,
  PanelLeft, Slash, SlidersHorizontal, Sparkles, Sun, Trash2, UserRoundPlus, Wrench, X, type LucideIcon,
} from "lucide-react";

/** 应用功能图标名称；品牌 Logo 继续由 ProviderIcon 独立管理。 */
export type AppIconName =
  | "activity" | "appearance" | "automation" | "back" | "blocks" | "board" | "bot" | "camera" | "configuration"
  | "dashboard" | "dark" | "diagnostics" | "drag" | "entry" | "folder" | "folderOpen" | "import"
  | "interview" | "knowledge" | "knowledgeTraining" | "library" | "light" | "mcp" | "message"
  | "mic" | "more" | "motion" | "newChat" | "none" | "paperclip" | "phone" | "personalization" | "plugins"
  | "project" | "review" | "scheduled" | "screenshot" | "search" | "send" | "settings" | "slash" | "sparkles"
  | "sidebar" | "stats" | "system" | "tool" | "tutoring" | "check" | "chevronDown" | "chevronRight" | "close" | "edit" | "folderPlus"
  | "refresh" | "warning" | "configure" | "copy" | "trash" | "down" | "topics" | "calendar" | "info"
  | "upload" | "download" | "save" | "undo" | "retry" | "play" | "stop" | "externalLink";

const icons: Record<AppIconName, LucideIcon> = {
  activity: Activity, appearance: Sun, automation: CalendarClock, back: ArrowLeft, blocks: Blocks,
  board: ClipboardCheck, bot: Bot, camera: Camera, configuration: SlidersHorizontal, dashboard: LayoutDashboard, dark: Moon,
  diagnostics: Activity, drag: GripVertical, entry: FilePenLine, folder: Folder, folderOpen: FolderOpen,
  import: FileInput, interview: MessagesSquare, knowledge: BookOpen, knowledgeTraining: Brain, library: Library,
  light: Sun, mcp: Blocks, message: MessageSquare, mic: Mic, more: MoreHorizontal, motion: Activity,
  newChat: Plus, none: Ban, paperclip: Paperclip, phone: Phone, personalization: UserRoundPlus, plugins: Blocks,
  project: Folder, review: ClipboardCheck, scheduled: Clock3, screenshot: ScanLine, search: Search, send: Send, settings: Settings,
  sidebar: PanelLeft, slash: Slash, sparkles: Sparkles, stats: ChartNoAxesColumnIncreasing, system: Monitor, tool: Wrench,
  tutoring: Bot, check: Check, chevronDown: ChevronDown, chevronRight: ChevronRight, close: X, edit: FilePenLine, folderPlus: FolderPlus,
  refresh: RefreshCw, warning: CircleAlert, configure: Settings2, copy: Copy, trash: Trash2, down: ArrowDown, topics: ListTree,
  calendar: CalendarDays, info: Info,
  upload: Upload, download: Download, save: Save, undo: Undo2, retry: RotateCcw, play: Play, stop: Square, externalLink: ExternalLink,
};

/** 统一 Lucide 的尺寸、线宽与无障碍表现；交互名称由外层按钮提供。 */
export function AppIcon({ name, size = 18, strokeWidth = 1.8 }: { name: AppIconName; size?: 14 | 16 | 18 | 20 | 22; strokeWidth?: number }) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={strokeWidth} />;
}
