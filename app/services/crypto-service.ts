import { getOrCreateSecurePrimaryKey } from "./secure-key-store.ts";

export const LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME = "review_workspace_crypto_key_v1";
const VERSIONED_CIPHERTEXT_PREFIX = "v2:";

// 将字节数组编码为浏览器可存储的 base64 字符串。
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// 将 base64 字符串还原为字节数组。
function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

// 将 Uint8Array 裁剪为明确的 ArrayBuffer，满足 Web Crypto 的严格类型要求。
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 只读取旧版可导出 JWK；新加密流程绝不再创建或导出此类主密钥。 */
async function getLegacyLocalCryptoKey(): Promise<CryptoKey> {
  const saved = window.localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME);
  if (!saved) throw new Error("旧版本机主密钥已丢失，请重新输入已保存的凭据");
  try {
    return await crypto.subtle.importKey(
      "jwk",
      JSON.parse(saved) as JsonWebKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new Error("旧版本机主密钥已损坏，请重新输入已保存的凭据");
  }
}

/** 判断密文是否仍依赖旧版 localStorage JWK。 */
export function isLegacyEncryptedSecret(encryptedKey: string | undefined): boolean {
  return Boolean(encryptedKey && !encryptedKey.startsWith(VERSIONED_CIPHERTEXT_PREFIX));
}

// 使用不可导出主密钥加密凭据，并通过 AAD 绑定稳定的记录上下文。
export async function encryptSecret(plainText: string, context: string): Promise<{ encryptedKey: string; iv: string }> {
  const key = await getOrCreateSecurePrimaryKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const additionalData = new TextEncoder().encode(context);
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: bytesToArrayBuffer(iv),
    additionalData: bytesToArrayBuffer(additionalData),
  }, key, encoded);
  return {
    encryptedKey: `${VERSIONED_CIPHERTEXT_PREFIX}${bytesToBase64(new Uint8Array(encrypted))}`,
    iv: bytesToBase64(iv),
  };
}

// 解密指定上下文的密文；旧版密文仅用于可恢复迁移，不使用 AAD。
export async function decryptSecret(encryptedKey: string, iv: string, context: string): Promise<string> {
  try {
    const legacy = isLegacyEncryptedSecret(encryptedKey);
    const key = legacy ? await getLegacyLocalCryptoKey() : await getOrCreateSecurePrimaryKey();
    const cipherText = legacy ? encryptedKey : encryptedKey.slice(VERSIONED_CIPHERTEXT_PREFIX.length);
    const additionalData = legacy ? undefined : new TextEncoder().encode(context);
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: bytesToArrayBuffer(base64ToBytes(iv)),
      additionalData: additionalData ? bytesToArrayBuffer(additionalData) : undefined,
    }, key, bytesToArrayBuffer(base64ToBytes(cipherText)));
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    if (error instanceof Error && /旧版本机主密钥/.test(error.message)) throw error;
    throw new Error("本机凭据无法解密，请重新输入后保存");
  }
}

// 将 API Key 脱敏展示给用户，避免设置页暴露完整明文。
export function maskSecret(value: string): string {
  if (!value) return "未配置";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
