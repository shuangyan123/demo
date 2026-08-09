import type { HostRuntime, WebVaultCapability } from "../capabilities.ts";

type WebCapabilityWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  FileSystemObserver?: new (
    callback: (records: Array<{ type?: string }>) => void,
  ) => {
    observe(handle: FileSystemDirectoryHandle, options?: { recursive?: boolean }): Promise<void>;
    disconnect(): void;
  };
};

/** Web 宿主只公布浏览器真实提供的能力，不模拟 Electron preload。 */
export function createWebHost(target: Window): HostRuntime {
  const webWindow = target as WebCapabilityWindow;
  const picker = webWindow.showDirectoryPicker;
  const Observer = webWindow.FileSystemObserver;
  const vault: WebVaultCapability | undefined = picker
    ? {
        kind: "web",
        chooseDirectory: (options) => picker.call(target, options),
        createObserver: Observer ? (listener) => new Observer(listener) : undefined,
      }
    : undefined;

  return {
    kind: "web",
    capabilities: { vault },
  };
}
