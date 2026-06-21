import type { KnowledgeCategory, ObsidianPermissionState } from "../types/review";

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

export type VaultMarkdownFile = {
  path: string;
  markdown: string;
};

const CATEGORIES: KnowledgeCategory[] = ["政治理论", "常识判断", "申论"];

async function ensureDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of path.split("/").map((item) => item.trim()).filter(Boolean)) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

async function resolveDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of path.split("/").map((item) => item.trim()).filter(Boolean)) {
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
    if (!picker) throw new Error("当前浏览器不支持双向 Vault 目录访问，请改用 Chrome 或 Edge，或使用一次性 Markdown 导入。");
    try {
      return await picker({ id: "review-workspace-obsidian", mode: "readwrite" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("已取消选择 Vault，现有知识库没有发生变化。", { cause: error });
      }
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new Error("Vault 目录权限被拒绝，请重新连接并允许读写权限。", { cause: error });
      }
      if (error instanceof DOMException && error.name === "SecurityError") {
        throw new Error("目录选择需要由你直接点击按钮触发，并且页面必须处于安全上下文。", { cause: error });
      }
      if (error instanceof Error && /user gesture|secure context/i.test(error.message)) {
        throw new Error("目录选择需要由你直接点击按钮触发，并且页面必须处于安全上下文。", { cause: error });
      }
      throw error;
    }
  },

  async permission(handle?: FileSystemDirectoryHandle, request = false): Promise<ObsidianPermissionState> {
    if (!this.isSupported()) return "unsupported";
    if (!handle) return "denied";
    const permissionHandle = handle as PermissionHandle;
    const method = request ? permissionHandle.requestPermission : permissionHandle.queryPermission;
    if (!method) return "unsupported";
    const state = await method.call(handle, { mode: "readwrite" });
    return state === "granted" ? "granted" : state === "prompt" ? "prompt" : "denied";
  },

  async ensureManagedTree(handle: FileSystemDirectoryHandle, managedRoot: string): Promise<void> {
    const root = await ensureDirectory(handle, managedRoot);
    await Promise.all(CATEGORIES.map((category) => root.getDirectoryHandle(category, { create: true })));
  },

  async listMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string): Promise<VaultMarkdownFile[]> {
    try {
      return walkMarkdown(await resolveDirectory(handle, managedRoot));
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return [];
      throw error;
    }
  },

  async writeMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string, relativePath: string, markdown: string): Promise<void> {
    const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName || !/\.md$/i.test(fileName)) throw new Error("Obsidian 笔记路径必须以 .md 结尾");
    const directory = await ensureDirectory(handle, [managedRoot, ...segments].join("/"));
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(markdown);
    await writable.close();
  },

  async removeMarkdown(handle: FileSystemDirectoryHandle, managedRoot: string, relativePath: string): Promise<void> {
    const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) return;
    const directory = await resolveDirectory(handle, [managedRoot, ...segments].join("/"));
    await directory.removeEntry(fileName);
  },
};
