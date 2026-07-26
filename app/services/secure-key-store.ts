const SECURE_KEY_DATABASE_NAME = "review_workspace_secure_keys";
const SECURE_KEY_DATABASE_VERSION = 1;
const SECURE_KEY_STORE_NAME = "keys";
const PRIMARY_KEY_ID = "primary-aes-gcm-v2";

type StoredKeyRecord = {
  id: typeof PRIMARY_KEY_ID;
  key: CryptoKey;
  createdAt: string;
};

let databasePromise: Promise<IDBDatabase> | undefined;
let primaryKeyPromise: Promise<CryptoKey> | undefined;

/** 校验从 IndexedDB 读取的对象确实是不可导出的 AES-GCM 主密钥。 */
function isValidPrimaryKey(value: unknown): value is CryptoKey {
  if (!value || typeof value !== "object") return false;
  const candidate = value as CryptoKey;
  return candidate.type === "secret"
    && candidate.extractable === false
    && candidate.algorithm?.name === "AES-GCM"
    && candidate.usages.includes("encrypt")
    && candidate.usages.includes("decrypt");
}
/** 使用独立数据库保存 CryptoKey，避免升级业务数据库 review_workspace v16。 */
function openSecureKeyDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(SECURE_KEY_DATABASE_NAME, SECURE_KEY_DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("本机密钥库打开失败"));
    request.onblocked = () => reject(new Error("本机密钥库正在被其他页面占用，请关闭其他标签页后重试"));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SECURE_KEY_STORE_NAME)) {
        request.result.createObjectStore(SECURE_KEY_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

/** 读取主密钥；缺失时生成不可导出的 256 位 AES-GCM 密钥并持久化。 */
export function getOrCreateSecurePrimaryKey(): Promise<CryptoKey> {
  if (primaryKeyPromise) return primaryKeyPromise;
  primaryKeyPromise = (async () => {
    const database = await openSecureKeyDatabase();
    const existing = await new Promise<StoredKeyRecord | undefined>((resolve, reject) => {
      const request = database.transaction(SECURE_KEY_STORE_NAME, "readonly")
        .objectStore(SECURE_KEY_STORE_NAME)
        .get(PRIMARY_KEY_ID);
      request.onerror = () => reject(request.error ?? new Error("本机主密钥读取失败"));
      request.onsuccess = () => resolve(request.result as StoredKeyRecord | undefined);
    });
    if (existing) {
      if (!isValidPrimaryKey(existing.key)) throw new Error("本机密钥库已损坏，请重新输入已保存的凭据");
      return existing.key;
    }

    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SECURE_KEY_STORE_NAME, "readwrite");
      transaction.onerror = () => reject(transaction.error ?? new Error("本机主密钥保存失败"));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(SECURE_KEY_STORE_NAME).put({
        id: PRIMARY_KEY_ID,
        key,
        createdAt: new Date().toISOString(),
      } satisfies StoredKeyRecord);
    });
    return key;
  })().catch((error) => {
    primaryKeyPromise = undefined;
    throw error;
  });
  return primaryKeyPromise;
}

/** 只读取现有主密钥；解密流程不得在密钥丢失时创建一把不匹配的新密钥。 */
export async function readSecurePrimaryKey(): Promise<CryptoKey | undefined> {
  if (primaryKeyPromise) return primaryKeyPromise;
  const database = await openSecureKeyDatabase();
  const existing = await new Promise<StoredKeyRecord | undefined>((resolve, reject) => {
    const request = database.transaction(SECURE_KEY_STORE_NAME, "readonly")
      .objectStore(SECURE_KEY_STORE_NAME)
      .get(PRIMARY_KEY_ID);
    request.onerror = () => reject(request.error ?? new Error("本机主密钥读取失败"));
    request.onsuccess = () => resolve(request.result as StoredKeyRecord | undefined);
  });
  if (!existing) return undefined;
  if (!isValidPrimaryKey(existing.key)) throw new Error("本机密钥库已损坏");
  primaryKeyPromise = Promise.resolve(existing.key);
  return existing.key;
}

/** 删除独立安全密钥库；仅供用户确认后的完整重置和测试隔离使用。 */
export async function deleteSecureKeyStore(): Promise<void> {
  primaryKeyPromise = undefined;
  const database = await databasePromise?.catch(() => undefined);
  database?.close();
  databasePromise = undefined;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SECURE_KEY_DATABASE_NAME);
    request.onerror = () => reject(request.error ?? new Error("本机密钥库删除失败"));
    request.onblocked = () => reject(new Error("本机密钥库正在被其他页面占用，请关闭其他标签页后重试"));
    request.onsuccess = () => resolve();
  });
}

/** 测试隔离使用；生产代码应调用语义明确的完整重置入口。 */
export const resetSecureKeyStoreForTests = deleteSecureKeyStore;
