import type { Page } from "@playwright/test";

const LEARNING_STORES = [
  "mistakes",
  "attempts",
  "knowledgeEntries",
  "knowledgeAttempts",
  "interviewQuestions",
  "interviewPracticePlans",
  "interviewSessions",
  "interviewEvaluations",
  "tutoringSessions",
  "tutoringTurns",
  "tutoringPlans",
];

export async function replaceLearningFacts(page: Page, records: Record<string, unknown[]>): Promise<void> {
  await page.evaluate(async ({ stores, nextRecords }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const available = stores.filter((store) => database.objectStoreNames.contains(store));
      const transaction = database.transaction(available, "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("学习事实写入事务已中止"));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      try {
        for (const storeName of available) {
          const store = transaction.objectStore(storeName);
          store.clear();
          for (const record of nextRecords[storeName] ?? []) store.put(record);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
  }), { stores: LEARNING_STORES, nextRecords: records });
}
