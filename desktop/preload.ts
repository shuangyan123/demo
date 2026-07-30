import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("reviewDesktopVault", {
  getState: () => ipcRenderer.invoke("review-vault:get-state"),
  chooseVault: () => ipcRenderer.invoke("review-vault:choose"),
  ensureManagedTree: (managedRoot: string) => ipcRenderer.invoke("review-vault:ensure-tree", managedRoot),
  listMarkdown: (managedRoot: string) => ipcRenderer.invoke("review-vault:list", managedRoot),
  readMarkdown: (managedRoot: string, relativePath: string) => ipcRenderer.invoke("review-vault:read", managedRoot, relativePath),
  writeMarkdown: (managedRoot: string, relativePath: string, markdown: string) => ipcRenderer.invoke("review-vault:write", managedRoot, relativePath, markdown),
  removeMarkdown: (managedRoot: string, relativePath: string) => ipcRenderer.invoke("review-vault:remove", managedRoot, relativePath),
});
