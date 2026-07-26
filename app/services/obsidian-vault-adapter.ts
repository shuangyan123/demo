import type { KnowledgeCategory } from "../types/domains/knowledge.ts";
import type { ObsidianPermissionState } from "../types/domains/obsidian.ts";

type PermissionMode = "read" | "readwrite";
type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: PermissionMode }) => Promise<PermissionState>;
};
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: PermissionMode }) => Promise<FileSystemDirectoryHandle>;
};

export type ObsidianVaultErrorCode =
  | "cancelled"
  | "permission_denied"
  | "user_activation_required"
  | "managed_root_missing"
  | "handle_invalid"
  | "not_readable"
  | "path_invalid"
  | "write_failed";

/** 为 UI 和 repository 保留可判断的错误码，同时统一浏览器原生异常的中文提示。 */
export class ObsidianVaultError extends Error {
  readonly code: ObsidianVaultErrorCode;

  constructor(code: ObsidianVaultErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "ObsidianVaultError";
  }
}

export type VaultMarkdownFile = {
  path: string;
  markdown: string;
};

const CATEGORIES: KnowledgeCategory[] = ["政治理论", "常识判断", "申论"];

/** 规范化 Vault 内部路径，禁止绝对路径和父级跳转逃逸托管目录。 */
export function normalizeObsidianPath(path: string, label = "Vault 路径"): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new ObsidianVaultError("path_invalid", `${label}无效，请使用 Vault 内不含 . 或 .. 的相对目录。`);
  }
  return segments.join("/");
}

/** 把 Chrome/Edge File System Access 异常转换为稳定、可操作的业务错误。 */
export function toObsidianVaultError(error: unknown, action = "访问 Vault"): ObsidianVaultError {
  if (error instanceof ObsidianVaultError) return error;
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError") return new ObsidianVaultError("cancelled", "已取消选择 Vault，现有知识库没有发生变化。", { cause: error });
  if (name === "NotAllowedError") return new ObsidianVaultError("permission_denied", `无法${action}：目录读写权限被拒绝，请重新授权。`, { cause: error });
  if (name === "SecurityError" || /user gesture|secure context|activation/i.test(message)) {
    return new ObsidianVaultError("user_activation_required", `无法${action}：请直接点击页面按钮，并确保使用 HTTPS 或 localhost。`, { cause: error });
  }
  if (name === "InvalidStateError" || name === "DataCloneError") {
    return new ObsidianVaultError("handle_invalid", "已保存的 Vault 句柄已失效，请重新选择 Vault。", { cause: error });
  }
  if (name === "NotReadableError" || name === "NoModificationAllowedError") {
    return new ObsidianVaultError("not_readable", `无法${action}：文件可能被占用、移动或设为只读，请检查后重试。`, { cause: error });
  }
  return new ObsidianVaultError("write_failed", `无法${action}${message ? `：${message}` : "，请检查目录后重试。"}`, { cause: error });
}

async function ensureDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of normalizeObsidianPath(path, "托管目录").split("/")) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

async function resolveDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of normalizeObsidianPath(path, "托管目录").split("/")) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

async function walkMarkdown(directory: FileSystemDirectoryHandle, prefix = ""): Promise<VaultMarkdownFile[]> {
  const result: VaultMarkdownFile[] = [];
  const iterable = directory as IterableDirectoryHandle;
  for await (const [name, handle] of iterable.entries()) {
    if (name.startsWith(".") || name === "Attachments" || name === "附件" || name === "Trash") continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      result.push(...await walkMarkdown(handle as FileSystemDirectoryHandle, relativePath));
    } else if (/\.md$/i.test(name)) {
      const file = await (handle as FileSystemFileHandle).getFile();
      result.push({ path: relativePath, markdown: await file.text() });
    }
  }
  return result;
}

/** 浏览器 Vault 适配器集中管理目录权限和文件读写，业务组件不持有目录句柄。 */
export const obsidianVaultAdapter = {
  isSupported(): boolean {
    return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
  },

  async chooseVault(): Promise<FileSystemDirectoryHandle> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) throw new Error("当前浏览器不支持选择 Vault 文件夹，请改用 Chrome 或 Edge，或使用一次性 Markdown 导入。");
    try {
      return await picker({ id: "review-workspace-obsidian", mode: "readwrite" });
    } catch (error) {
      throw toObsidianVaultError(error, "选择 Vault");
    }
  },

  async permission(handle?: FileSystemDirectoryHandle, request = false): Promise<ObsidianPermissionState> {
    if (!this.isSupported()) return "unsupported";
    if (!handle) return "denied";
    const permissionHandle = handle as PermissionHandle;
    const method = request ? permissionHandle.requestPermission : permissionHandle.queryPermission;
    if (!method) return "unsupported";
    try {
      const state = await method.call(handle, { mode: "readwrite" });
      return state === "granted" ? "granted" : state === "prompt" ? "prompt" : "denied";
    } catch (error) {
      throw toObsidianVaultError(error, request ? "恢复 Vault 权限" : "检查 Vault 权限");
    }
  },

  async ensureManagedTree(handle: FileSystemDirectoryHandle, managedRoot: string): Promise<void> {
    try {
      const root = await ensureDirectory(handle, managedRoot);
      await Promise.all(CATEGORIES.map((category) => root.getDirectoryHandle(category, { create: true })));
    } catch (error) {
      throw toObsidianVaultError(error, "创建托管目录");
    }
  },

  async listMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string): Promise<VaultMarkdownFile[]> {
    try {
      return walkMarkdown(await resolveDirectory(handle, managedRoot));
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new ObsidianVaultError("managed_root_missing", `托管目录“${normalizeObsidianPath(managedRoot, "托管目录")}”不存在。请恢复目录或重新选择 Vault，当前映射未被修改。`, { cause: error });
      }
      throw toObsidianVaultError(error, "读取 Vault");
    }
  },

  async readMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string, relativePath: string): Promise<string> {
    const segments = normalizeObsidianPath(relativePath, "Obsidian 笔记路径").split("/");
    const fileName = segments.pop()!;
    try {
      const directory = await resolveDirectory(handle, [managedRoot, ...segments].join("/"));
      const file = await (await directory.getFileHandle(fileName)).getFile();
      return file.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new ObsidianVaultError("managed_root_missing", `Obsidian 笔记“${relativePath}”已移动或删除，请先重新同步。`, { cause: error });
      }
      throw toObsidianVaultError(error, "读取 Obsidian 笔记");
    }
  },

  async writeMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string, relativePath: string, markdown: string): Promise<void> {
    const segments = normalizeObsidianPath(relativePath, "Obsidian 笔记路径").split("/");
    const fileName = segments.pop();
    if (!fileName || !/\.md$/i.test(fileName)) throw new Error("Obsidian 笔记路径必须以 .md 结尾");
    try {
      const directory = await ensureDirectory(handle, [managedRoot, ...segments].join("/"));
      const fileHandle = await directory.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(markdown);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw toObsidianVaultError(error, "写入 Obsidian 笔记");
    }
  },

  async removeMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string, relativePath: string): Promise<void> {
    const segments = normalizeObsidianPath(relativePath, "Obsidian 笔记路径").split("/");
    const fileName = segments.pop();
    if (!fileName) return;
    try {
      const directory = await resolveDirectory(handle, [managedRoot, ...segments].join("/"));
      await directory.removeEntry(fileName);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      throw toObsidianVaultError(error, "删除 Obsidian 笔记");
    }
  },
};
