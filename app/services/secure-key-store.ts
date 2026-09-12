const SECURE_KEY_DATABASE_NAME = "review_workspace_secure_keys";
const SECURE_KEY_DATABASE_VERSION = 1;
const SECURE_KEY_STORE_NAME = "keys";
const PRIMARY_KEY_ID = "primary-aes-gcm-v2";

type StoredKeyRecord = {
  id: typeof PRIMARY_KEY_ID;
  key: CryptoKey;
  createdAt: string;
};

export type SecurePrimaryWebKeyPresence = "present" | "absent" | "unavailable";
export type SecurePrimaryWebKeyCleanupResult = "deleted" | "already_absent";

export class SecurePrimaryWebKeyCleanupError extends Error {
  readonly code: "unavailable" | "delete_failed";

  constructor(code: "unavailable" | "delete_failed") {
    super(code === "unavailable" ? "The Web credential key store is unavailable." : "The Web credential key could not be deleted safely.");
    this.name = "SecurePrimaryWebKeyCleanupError";
    this.code = code;
  }
}

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
/** 使用独立数据库保存 CryptoKey，避免升级业务数据库 review_workspace v17。 */
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
/** 只打开已经存在的 key database；缺失时绝不通过 open() 隐式创建数据库。*/
async function openExistingSecureKeyDatabase(): Promise<IDBDatabase | undefined> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") {
    throw new SecurePrimaryWebKeyCleanupError("unavailable");
  }
  let databaseExists = false;
  try {
    databaseExists = (await indexedDB.databases()).some((database) => database.name === SECURE_KEY_DATABASE_NAME);
  } catch {
    throw new SecurePrimaryWebKeyCleanupError("unavailable");
  }
  if (!databaseExists) return undefined;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECURE_KEY_DATABASE_NAME, SECURE_KEY_DATABASE_VERSION);
    request.onerror = () => reject(new SecurePrimaryWebKeyCleanupError("unavailable"));
    request.onblocked = () => reject(new SecurePrimaryWebKeyCleanupError("unavailable"));
    request.onupgradeneeded = () => {
      // Existing database version/schema drift is not a reason to create or repair a key store here.
      try { request.transaction?.abort(); } catch { /* the request will reject */ }
      reject(new SecurePrimaryWebKeyCleanupError("unavailable"));
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function readExistingPrimaryKeyRecord(): Promise<{ database: IDBDatabase; record?: StoredKeyRecord; owned: boolean } | undefined> {
  const owned = !databasePromise;
  const database = await openExistingSecureKeyDatabase();
  if (!database) return undefined;
  try {
    const record = await new Promise<StoredKeyRecord | undefined>((resolve, reject) => {
      if (!database.objectStoreNames.contains(SECURE_KEY_STORE_NAME)) {
        reject(new SecurePrimaryWebKeyCleanupError("unavailable"));
        return;
      }
      const request = database.transaction(SECURE_KEY_STORE_NAME, "readonly")
        .objectStore(SECURE_KEY_STORE_NAME)
        .get(PRIMARY_KEY_ID);
      request.onerror = () => reject(new SecurePrimaryWebKeyCleanupError("unavailable"));
      request.onsuccess = () => resolve(request.result as StoredKeyRecord | undefined);
    });
    return { database, record, owned };
  } catch (error) {
    if (owned) database.close();
    throw error;
  }
}

/** 物理读取 Web shared key 是否存在；不生成 key、不修复 schema、不读取 key 内容。*/
export async function inspectPrimaryWebCredentialKey(): Promise<SecurePrimaryWebKeyPresence> {
  let result: { database: IDBDatabase; record?: StoredKeyRecord; owned: boolean } | undefined;
  try {
    result = await readExistingPrimaryKeyRecord();
    if (!result?.record) return "absent";
    return isValidPrimaryKey(result.record.key) ? "present" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    if (result?.owned) result.database.close();
  }
}

/** cleanup 专用的窄接口：只删除现有 primary Web credential key，不删除 Desktop material，也不生成 replacement key。*/
export async function deletePrimaryWebCredentialKeyForCleanup(options: { noWebConsumerConfirmed: true }): Promise<SecurePrimaryWebKeyCleanupResult> {
  if (!options.noWebConsumerConfirmed) throw new SecurePrimaryWebKeyCleanupError("delete_failed");
  let result: { database: IDBDatabase; record?: StoredKeyRecord; owned: boolean } | undefined;
  try {
    result = await readExistingPrimaryKeyRecord();
    if (!result?.record) return "already_absent";
    if (!isValidPrimaryKey(result.record.key)) throw new SecurePrimaryWebKeyCleanupError("unavailable");
    await new Promise<void>((resolve, reject) => {
      const transaction = result!.database.transaction(SECURE_KEY_STORE_NAME, "readwrite");
      transaction.onerror = () => reject(new SecurePrimaryWebKeyCleanupError("delete_failed"));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(SECURE_KEY_STORE_NAME).delete(PRIMARY_KEY_ID);
    });
    primaryKeyPromise = undefined;
    return "deleted";
  } catch (error) {
    if (error instanceof SecurePrimaryWebKeyCleanupError) throw error;
    throw new SecurePrimaryWebKeyCleanupError("delete_failed");
  } finally {
    result?.database.close();
    if (result) databasePromise = undefined;
  }
}

export async function hasPrimaryWebCredentialKey(): Promise<boolean> {
  return (await inspectPrimaryWebCredentialKey()) === "present";
}

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
