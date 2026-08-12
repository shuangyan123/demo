export const DESKTOP_CREDENTIAL_ENVELOPE_VERSION = "desktop-v1" as const;
export const MAX_CREDENTIAL_CONTEXT_LENGTH = 256;
export const MAX_CREDENTIAL_SECRET_BYTES = 64 * 1024;
export const MAX_CREDENTIAL_PAYLOAD_BYTES = 128 * 1024;

export type DesktopCredentialEnvelope = {
  version: typeof DESKTOP_CREDENTIAL_ENVELOPE_VERSION;
  context: string;
  payload: string;
};

export type CredentialHostErrorCode =
  | "host_unavailable"
  | "host_protection_failed"
  | "host_unprotect_failed"
  | "host_context_mismatch"
  | "host_payload_invalid";

const HOST_ERROR_MESSAGES: Record<CredentialHostErrorCode, string> = {
  host_unavailable: "桌面凭据保护当前不可用",
  host_protection_failed: "桌面凭据保护失败，请稍后重试",
  host_unprotect_failed: "桌面凭据无法验证，请重新输入凭据",
  host_context_mismatch: "桌面凭据上下文不匹配，请重新输入凭据",
  host_payload_invalid: "桌面凭据保护数据无效，请重新输入凭据",
};

export class CredentialHostError extends Error {
  readonly code: CredentialHostErrorCode;

  constructor(code: CredentialHostErrorCode) {
    super(HOST_ERROR_MESSAGES[code]);
    this.name = "CredentialHostError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 只接受由产品 secretContext 生成的非空上下文形状，不允许通用文件或资源标识。 */
export function validateCredentialContext(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CREDENTIAL_CONTEXT_LENGTH) {
    throw new CredentialHostError("host_payload_invalid");
  }
  if (!/^(?:ai-connection|quota|mcp|fenbi):[A-Za-z0-9._~-]+(?::[A-Za-z0-9._~-]+)*$/.test(value)) {
    throw new CredentialHostError("host_payload_invalid");
  }
  return value;
}

function validateSecret(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_CREDENTIAL_SECRET_BYTES) {
    throw new CredentialHostError("host_payload_invalid");
  }
  return value;
}

export function createProtectedPayload(context: string, secret: string): string {
  const safeContext = validateCredentialContext(context);
  const safeSecret = validateSecret(secret);
  return JSON.stringify({
    version: DESKTOP_CREDENTIAL_ENVELOPE_VERSION,
    context: safeContext,
    secret: safeSecret,
  });
}

export function createCredentialEnvelope(context: string, encryptedPayload: Uint8Array): DesktopCredentialEnvelope {
  const safeContext = validateCredentialContext(context);
  if (encryptedPayload.byteLength === 0 || encryptedPayload.byteLength > MAX_CREDENTIAL_PAYLOAD_BYTES) {
    throw new CredentialHostError("host_protection_failed");
  }
  return {
    version: DESKTOP_CREDENTIAL_ENVELOPE_VERSION,
    context: safeContext,
    payload: Buffer.from(encryptedPayload).toString("base64"),
  };
}

function decodeBase64(value: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CredentialHostError("host_payload_invalid");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.length > MAX_CREDENTIAL_PAYLOAD_BYTES) {
    throw new CredentialHostError("host_payload_invalid");
  }
  return decoded;
}

export function decodeCredentialEnvelope(context: string, value: unknown): Buffer {
  const safeContext = validateCredentialContext(context);
  if (!isRecord(value) || Object.keys(value).some((key) => !["version", "context", "payload"].includes(key))) {
    throw new CredentialHostError("host_payload_invalid");
  }
  if (value.version !== DESKTOP_CREDENTIAL_ENVELOPE_VERSION) {
    throw new CredentialHostError("host_payload_invalid");
  }
  if (value.context !== safeContext) {
    throw new CredentialHostError("host_context_mismatch");
  }
  if (typeof value.payload !== "string") throw new CredentialHostError("host_payload_invalid");
  return decodeBase64(value.payload);
}

export function readProtectedPayload(context: string, value: string): string {
  const safeContext = validateCredentialContext(context);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["version", "context", "secret"].includes(key))) {
      throw new CredentialHostError("host_payload_invalid");
    }
    if (parsed.version !== DESKTOP_CREDENTIAL_ENVELOPE_VERSION) throw new CredentialHostError("host_payload_invalid");
    if (parsed.context !== safeContext) throw new CredentialHostError("host_context_mismatch");
    return validateSecret(parsed.secret);
  } catch (error) {
    if (error instanceof CredentialHostError) throw error;
    throw new CredentialHostError("host_unprotect_failed");
  }
}
