import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("reviewDesktopVault", {
  getState: () => ipcRenderer.invoke("review-vault:get-state"),
  chooseVault: () => ipcRenderer.invoke("review-vault:choose"),
  ensureManagedTree: (managedRoot: string) => ipcRenderer.invoke("review-vault:ensure-tree", managedRoot),
  listMarkdown: (managedRoot: string) => ipcRenderer.invoke("review-vault:list", managedRoot),
  readMarkdown: (managedRoot: string, relativePath: string) => ipcRenderer.invoke("review-vault:read", managedRoot, relativePath),
  writeMarkdown: (managedRoot: string, relativePath: string, markdown: string) => ipcRenderer.invoke("review-vault:write", managedRoot, relativePath, markdown),
  removeMarkdown: (managedRoot: string, relativePath: string) => ipcRenderer.invoke("review-vault:remove", managedRoot, relativePath),
  startWatching: (managedRoot: string) => ipcRenderer.invoke("review-vault:watch-start", managedRoot),
  stopWatching: () => ipcRenderer.invoke("review-vault:watch-stop"),
  onVaultChanged: (listener: (change: { revision: number; occurredAt: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: { revision: number; occurredAt: string }) => listener(change);
    ipcRenderer.on("review-vault:changed", handler);
    return () => ipcRenderer.removeListener("review-vault:changed", handler);
  },
});

contextBridge.exposeInMainWorld("reviewDesktopWindow", {
  setTitleBarTheme: (mode: "light" | "dark") => ipcRenderer.invoke("review-titlebar:set-theme", mode),
});
