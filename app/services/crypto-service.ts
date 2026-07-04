const keyStorageName = "review_workspace_crypto_key_v1";

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

// 获取或创建本机浏览器里的 AES-GCM 密钥；该密钥只用于本地 IndexedDB 加密。
async function getLocalCryptoKey(): Promise<CryptoKey> {
  const saved = window.localStorage.getItem(keyStorageName);
  if (saved) {
    return crypto.subtle.importKey("jwk", JSON.parse(saved) as JsonWebKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  }

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const exported = await crypto.subtle.exportKey("jwk", key);
  window.localStorage.setItem(keyStorageName, JSON.stringify(exported));
  return key;
}

// 加密 API Key，返回密文和随机初始化向量。
export async function encryptSecret(plainText: string): Promise<{ encryptedKey: string; iv: string }> {
  const key = await getLocalCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesToArrayBuffer(iv) }, key, encoded);
  return {
    encryptedKey: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

// 解密 IndexedDB 中保存的 API Key 密文，仅在发起当前请求前使用。
export async function decryptSecret(encryptedKey: string, iv: string): Promise<string> {
  const key = await getLocalCryptoKey();
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesToArrayBuffer(base64ToBytes(iv)) }, key, bytesToArrayBuffer(base64ToBytes(encryptedKey)));
  return new TextDecoder().decode(decrypted);
}

// 将 API Key 脱敏展示给用户，避免设置页暴露完整明文。
export function maskSecret(value: string): string {
  if (!value) return "未配置";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
