import type { Page } from "@playwright/test";

/** E2E 只需持久化的连接公开元数据。 */
export type ModelConnectionFixture = {
  id: string;
  label: string;
  provider: "openai" | "google" | "anthropic" | "deepseek" | "minimax" | "zhipu" | "custom";
  apiFormat: "responses" | "google_generate_content" | "anthropic_messages" | "chat_completions";
  baseUrl?: string;
};

/** E2E 会话模型选择夹具，不包含消息正文或密钥。 */
export type ModelConversationFixture = {
  id: string;
  title: string;
  connectionId: string;
  modelId: string;
  runtime?: { reasoning?: string | number; speed?: string };
};

/** 直接写入公开连接元数据和会话选择，避免视觉/状态回归依赖真实 Key 或外网。 */
export async function seedConversationModelFixtures(
  page: Page,
  connections: ModelConnectionFixture[],
  conversations: ModelConversationFixture[],
  { readyTimeout = 30_000 }: { readyTimeout?: number } = {},
): Promise<void> {
  // 等待应用完成 Dexie v16 打开与迁移，避免测试直开同名数据库时互相阻塞。
  await page.getByRole("main").getByRole("heading", { name: "总览", exact: true }).waitFor({ timeout: readyTimeout });
  await page.evaluate(async ({ connectionFixtures, conversationFixtures }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["apiConnectionProfiles", "aiConversations"], "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      const timestamp = new Date().toISOString();
      const profileStore = transaction.objectStore("apiConnectionProfiles");
      const conversationStore = transaction.objectStore("aiConversations");
      for (const fixture of connectionFixtures) {
        profileStore.put({
          id: fixture.id,
          label: fixture.label,
          provider: fixture.provider,
          apiFormat: fixture.apiFormat,
          baseUrl: fixture.baseUrl ?? "http://127.0.0.1:9/v1",
          capabilities: ["text", "streaming", "structured_output"],
          encryptedKey: "fixture-only",
          iv: "fixture-only",
          maskedKey: "fixture",
          providerOptions: {},
          testStatus: "idle",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      for (const fixture of conversationFixtures) {
        conversationStore.put({
          id: fixture.id,
          projectId: "civil-service",
          studyDomainId: "civil-service",
          title: fixture.title,
          kind: "general",
          status: "active",
          sourceType: "manual",
          selectedConnectionId: fixture.connectionId,
          selectedModelId: fixture.modelId,
          selectedRuntimeValues: fixture.runtime,
          messageCount: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    };
  }), { connectionFixtures: connections, conversationFixtures: conversations });
}

/** 清空当前测试上下文中的连接公开元数据，用于验证零连接恢复入口。 */
export async function clearConversationModelConnections(page: Page): Promise<void> {
  await page.getByRole("main").getByRole("heading", { name: "总览", exact: true }).waitFor();
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("apiConnectionProfiles", "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.objectStore("apiConnectionProfiles").clear();
    };
  }));
}

/** 为单个 fixture 写入可解密的测试凭据，使模型目录请求能被 page.route 精确控制。 */
export async function enableConversationModelDirectoryRequest(page: Page, connectionId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const secureDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("review_workspace_secure_keys", 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => request.result.createObjectStore("keys", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = secureDatabase.transaction("keys", "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      transaction.objectStore("keys").put({ id: "primary-aes-gcm-v2", key, createdAt: new Date().toISOString() });
    });
    secureDatabase.close();

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`ai-connection:${id}:api-key`),
    }, key, new TextEncoder().encode("fixture-directory-key"));
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const encryptedKey = `v2:${toBase64(new Uint8Array(cipher))}`;
    const encodedIv = toBase64(iv);

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("review_workspace");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("apiConnectionProfiles", "readwrite");
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => { database.close(); resolve(); };
        const store = transaction.objectStore("apiConnectionProfiles");
        const get = store.get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => store.put({ ...get.result, encryptedKey, iv: encodedIv });
      };
    });
  }, connectionId);
}

/** 从真实会话表读取模型选择，证明 UI 操作已在发送消息前落库。 */
export async function readConversationModelSelection(page: Page, conversationId: string): Promise<{
  modelId?: string;
  runtime?: { reasoning?: string | number; speed?: string };
}> {
  return page.evaluate(async (id) => new Promise((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const getRequest = database.transaction("aiConversations", "readonly").objectStore("aiConversations").get(id);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const result = {
          modelId: getRequest.result?.selectedModelId,
          runtime: getRequest.result?.selectedRuntimeValues,
        };
        database.close();
        resolve(result);
      };
    };
  }), conversationId);
}

/**
 * 在应用脚本前安装一次性 IndexedDB 故障钩子，确保 Dexie 缓存到的也是受控方法。
 * 未显式 arm 时所有调用原样透传，因此不会影响正常持久化和刷新恢复。
 */
export async function installConversationModelWriteFailureHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const runtimeWindow = window as typeof window & {
      __armConversationModelWriteFailure?: (modelId: string) => void;
    };
    let armedModelId: string | undefined;
    const shouldFail = (value: unknown) => {
      if (!armedModelId || !value || typeof value !== "object") return false;
      return (value as { selectedModelId?: string }).selectedModelId === armedModelId;
    };
    const consumeFailure = () => {
      armedModelId = undefined;
    };
    const originalAdd = IDBObjectStore.prototype.add;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function patchedPut(value: unknown, key?: IDBValidKey) {
      if (shouldFail(value)) {
        consumeFailure();
        return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    const originalCursorUpdate = IDBCursor.prototype.update;
    IDBCursor.prototype.update = function patchedCursorUpdate(value: unknown) {
      if (shouldFail(value)) {
        consumeFailure();
        const source = this.source instanceof IDBIndex ? this.source.objectStore : this.source;
        return originalAdd.call(source, value);
      }
      return originalCursorUpdate.call(this, value);
    };
    runtimeWindow.__armConversationModelWriteFailure = (modelId) => {
      armedModelId = modelId;
    };
  });
}

/** 只让下一次 aiConversations 读写事务失败，随后自动恢复正常透传。 */
export async function failNextConversationModelWrite(page: Page, modelId: string): Promise<void> {
  await page.evaluate((targetModelId) => {
    const runtimeWindow = window as typeof window & {
      __armConversationModelWriteFailure?: (modelId: string) => void;
    };
    if (!runtimeWindow.__armConversationModelWriteFailure) throw new Error("尚未安装模型写入故障钩子");
    runtimeWindow.__armConversationModelWriteFailure(targetModelId);
  }, modelId);
}
