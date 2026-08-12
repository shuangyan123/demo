export type CredentialStorageFormat = "legacy-v1" | "web-v2" | "desktop-v1" | "missing" | "invalid" | "unknown";

export type DesktopCredentialEnvelope = {
  version: "desktop-v1";
  context: string;
  payload: string;
};

export type CredentialStorageFormatErrorCode = "invalid" | "unknown" | "context_mismatch";

export class CredentialStorageFormatError extends Error {
  readonly code: CredentialStorageFormatErrorCode;

  constructor(code: CredentialStorageFormatErrorCode, message: string) {
    super(message);
    this.name = "CredentialStorageFormatError";
    this.code = code;
  }
}

export const DESKTOP_CREDENTIAL_STORAGE_PREFIX = "desktop-v1:";

const CONTEXT_PATTERN = /^(?:ai-connection|quota|mcp|fenbi):[A-Za-z0-9._~-]+(?::[A-Za-z0-9._~-]+)*$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isCredentialContext(value: string): boolean {
  return value.length > 0 && value.length <= 256 && CONTEXT_PATTERN.test(value);
}

function isBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_PATTERN.test(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!isBase64(value)) throw new CredentialStorageFormatError("invalid", "Desktop credential envelope is invalid");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function hasVersionPrefix(value: string): boolean {
  return /^(?:v\d+|web-v\d+|desktop-v\d+):/.test(value);
}

/** Format 必须由显式前缀决定，不能通过尝试解密来猜测协议。 */
export function detectCredentialStorageFormat(encryptedKey?: string, iv?: string): CredentialStorageFormat {
  if (!encryptedKey && !iv) return "missing";
  if (encryptedKey?.startsWith(DESKTOP_CREDENTIAL_STORAGE_PREFIX)) return "desktop-v1";
  if (!encryptedKey || !iv) return "invalid";
  if (encryptedKey.startsWith("v2:")) return isBase64(encryptedKey.slice(3)) && isBase64(iv) ? "web-v2" : "invalid";
  if (hasVersionPrefix(encryptedKey)) return "unknown";
  return "legacy-v1";
}

function assertEnvelopeShape(value: unknown, context: string): asserts value is DesktopCredentialEnvelope {
  if (!isCredentialContext(context)) throw new CredentialStorageFormatError("invalid", "Credential context is invalid");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CredentialStorageFormatError("invalid", "Desktop credential envelope is invalid");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["version", "context", "payload"].includes(key))) {
    throw new CredentialStorageFormatError("invalid", "Desktop credential envelope is invalid");
  }
  if (record.version !== "desktop-v1") throw new CredentialStorageFormatError("unknown", "Desktop credential envelope version is unsupported");
  if (record.context !== context) throw new CredentialStorageFormatError("context_mismatch", "Desktop credential context does not match");
  if (typeof record.payload !== "string" || !isBase64(record.payload)) throw new CredentialStorageFormatError("invalid", "Desktop credential envelope is invalid");
}

export function serializeDesktopCredentialReference(envelope: DesktopCredentialEnvelope): string {
  assertEnvelopeShape(envelope, envelope.context);
  return `${DESKTOP_CREDENTIAL_STORAGE_PREFIX}${bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)))}`;
}

export function deserializeDesktopCredentialReference(value: string, context: string): DesktopCredentialEnvelope {
  if (!value.startsWith(DESKTOP_CREDENTIAL_STORAGE_PREFIX)) throw new CredentialStorageFormatError("unknown", "Desktop credential envelope version is unsupported");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(value.slice(DESKTOP_CREDENTIAL_STORAGE_PREFIX.length))));
  } catch (error) {
    if (error instanceof CredentialStorageFormatError) throw error;
    throw new CredentialStorageFormatError("invalid", "Desktop credential envelope is invalid");
  }
  assertEnvelopeShape(parsed, context);
  return parsed;
}
