import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from "electron";
import {
  CredentialHostError,
  createCredentialEnvelope,
  createProtectedPayload,
  decodeCredentialEnvelope,
  readProtectedPayload,
  type CredentialHostErrorCode,
  type DesktopCredentialEnvelope,
} from "./credential-storage-envelope.js";

export type DesktopCredentialProtectionStatus =
  | { status: "available"; backend: "os_protected" }
  | { status: "unavailable" | "unsupported" | "temporarily_unavailable" };

export type DesktopCredentialUnprotectResult = {
  secret: string;
  shouldReProtect: boolean;
};

const CREDENTIAL_STATUS_CHANNEL = "review-credential-storage:status";
const CREDENTIAL_PROTECT_CHANNEL = "review-credential-storage:protect";
const CREDENTIAL_UNPROTECT_CHANNEL = "review-credential-storage:unprotect";

function isTrustedSender(event: IpcMainInvokeEvent, developmentUrl?: string): boolean {
  const value = event.senderFrame?.url ?? event.sender.getURL();
  if (value.startsWith("review-app://workspace/")) return true;
  if (!developmentUrl) return false;
  try {
    return new URL(value).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, developmentUrl?: string): void {
  if (!isTrustedSender(event, developmentUrl)) throw new Error("CREDENTIAL_UNTRUSTED_SENDER");
}

function asSafeHostError(error: unknown, fallback: CredentialHostErrorCode): CredentialHostError {
  return error instanceof CredentialHostError ? error : new CredentialHostError(fallback);
}

/**
 * 只在 app ready 后探测异步 safeStorage。basic_text 明确视为不支持，绝不降级为明文保护。
 */
export async function getDesktopCredentialProtectionStatus(): Promise<DesktopCredentialProtectionStatus> {
  if (!app.isReady()) return { status: "temporarily_unavailable" };
  if (!["win32", "darwin", "linux"].includes(process.platform)) return { status: "unsupported" };
  try {
    if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
      return { status: "unsupported" };
    }
    return (await safeStorage.isAsyncEncryptionAvailable())
      ? { status: "available", backend: "os_protected" }
      : { status: "temporarily_unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

async function requireAvailable(): Promise<void> {
  const status = await getDesktopCredentialProtectionStatus();
  if (status.status !== "available") throw new CredentialHostError("host_unavailable");
}

async function protectCredential(context: string, secret: string): Promise<DesktopCredentialEnvelope> {
  await requireAvailable();
  try {
    const payload = createProtectedPayload(context, secret);
    const encrypted = await safeStorage.encryptStringAsync(payload);
    return createCredentialEnvelope(context, encrypted);
  } catch (error) {
    throw asSafeHostError(error, "host_protection_failed");
  }
}

async function unprotectCredential(context: string, envelope: unknown): Promise<DesktopCredentialUnprotectResult> {
  await requireAvailable();
  const encrypted = decodeCredentialEnvelope(context, envelope);
  try {
    let decrypted = await safeStorage.decryptStringAsync(encrypted);
    let shouldReProtect = decrypted.shouldReEncrypt;
    if (decrypted.shouldReEncrypt) {
      // Electron 43 的异步 API 在密钥轮换时要求再次解密以取得新保护级别下的结果。
      decrypted = await safeStorage.decryptStringAsync(encrypted);
      shouldReProtect ||= decrypted.shouldReEncrypt;
    }
    return { secret: readProtectedPayload(context, decrypted.result), shouldReProtect };
  } catch (error) {
    throw asSafeHostError(error, "host_unprotect_failed");
  }
}

function safeIpcError(error: unknown, fallback: CredentialHostErrorCode): Error {
  const safe = asSafeHostError(error, fallback);
  return new Error(safe.message);
}

/** 安装最小凭据保护 IPC；不暴露 safeStorage、文件路径或任意机器密文解密接口。 */
export function installDesktopCredentialStorageIpc(developmentUrl?: string): void {
  for (const channel of [CREDENTIAL_STATUS_CHANNEL, CREDENTIAL_PROTECT_CHANNEL, CREDENTIAL_UNPROTECT_CHANNEL]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle(CREDENTIAL_STATUS_CHANNEL, async (event) => {
    assertTrustedSender(event, developmentUrl);
    return getDesktopCredentialProtectionStatus();
  });
  ipcMain.handle(CREDENTIAL_PROTECT_CHANNEL, async (event, context: unknown, secret: unknown) => {
    assertTrustedSender(event, developmentUrl);
    try {
      if (typeof context !== "string" || typeof secret !== "string") throw new CredentialHostError("host_payload_invalid");
      return await protectCredential(context, secret);
    } catch (error) {
      throw safeIpcError(error, "host_protection_failed");
    }
  });
  ipcMain.handle(CREDENTIAL_UNPROTECT_CHANNEL, async (event, context: unknown, envelope: unknown) => {
    assertTrustedSender(event, developmentUrl);
    try {
      if (typeof context !== "string") throw new CredentialHostError("host_payload_invalid");
      return await unprotectCredential(context, envelope);
    } catch (error) {
      throw safeIpcError(error, "host_unprotect_failed");
    }
  });
}
