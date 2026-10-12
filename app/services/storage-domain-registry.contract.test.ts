import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { auditLocalStoragePolicies } from "../../scripts/storage-policy-source-guard.mjs";
import { CORE_DATA_STORE_POLICIES, LOCAL_STORAGE_DATA_POLICIES, NON_CORE_DATA_STORE_POLICIES } from "./local-data-reliability.ts";
import { STORAGE_DOMAIN_REGISTRY } from "./storage-domain-registry.ts";

async function productionSources(directory: string): Promise<Array<[string, string]>> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry): Promise<Array<[string, string]>> => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(file);
    return /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(file) && !/\.test\./.test(file) ? [[file, await readFile(file, "utf8")]] : [];
  }))).flat();
}
const sources = new Map(await productionSources(path.resolve("app")));

test("storage registry derives backup policy and covers every existing classification", () => {
  const ids = STORAGE_DOMAIN_REGISTRY.map((domain) => domain.domainId);
  assert.equal(new Set(ids).size, ids.length);
  for (const [table, policy] of Object.entries(CORE_DATA_STORE_POLICIES)) {
    const domain = STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === `review_workspace.${table}`)!;
    assert.equal(domain.backup.current, policy.backup === "included" ? "sanitized" : "excluded");
    assert.equal(domain.reset.current, "covered");
  }
  for (const key of Object.keys(NON_CORE_DATA_STORE_POLICIES)) assert.ok(ids.includes(key));
  for (const policy of LOCAL_STORAGE_DATA_POLICIES) assert.ok(ids.includes(`localStorage:${policy.pattern}`));
  for (const domain of STORAGE_DOMAIN_REGISTRY) {
    assert.ok(domain.owner && domain.physicalUnit && domain.rootType && domain.storageClass && domain.sensitivity);
    assert.equal(typeof domain.regenerable, "boolean");
    assert.ok(domain.backup.current && domain.reset.current && domain.migration.policy);
  }
});

test("known managed owners share Chromium physical unit without claiming portable credentials", () => {
  for (const owner of ["review", "knowledge", "import", "interview", "tutoring", "conversation", "automation", "appearance", "personalization", "ai-config", "vault-app-state", "extensions"]) {
    assert.ok(STORAGE_DOMAIN_REGISTRY.some((domain) => domain.owner === owner && domain.physicalUnit === "chromium-profile"));
  }
  const secure = STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === "review_workspace_secure_keys.keys")!;
  assert.equal(secure.backup.current, "excluded");
  assert.equal(secure.reset.relevant, true);
  assert.equal(secure.migration.policy, "protected-profile-unit");
  assert.equal(STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === "host.os-secrets")!.migration.policy, "excluded");
  assert.equal(STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === "review_workspace_transfer.jobs")!.migration.policy, "block-unresolved");
  for (const id of ["chromium.cache", "next.cache", "desktop.runtime-log", "external.user-files"]) {
    assert.equal(STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === id)!.migration.policy, "excluded");
  }
  assert.equal(STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === "obsidian-vault.files")!.migration.policy, "reference-only");
});

test("reset relevance is independent of backup and ephemeral lifetime never means public data", () => {
  for (const id of ["storage.bootstrap", "storage.profile-identity", "review_workspace_transfer.jobs", "workspace.session", "fenbi.session"]) {
    const domain = STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === id)!;
    assert.equal(domain.reset.relevant, true);
    assert.equal(domain.reset.current, "not-covered");
    assert.equal(domain.backup.current, "excluded");
  }
  for (const id of ["runtime.media-and-provider-events", "runtime.temporary-state", "localStorage:review-workspace:ai-quota-snapshots", "chromium.cache"]) {
    assert.equal(STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === id)!.sensitivity, "user-data");
  }
  const profiles = STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === "review_workspace.apiConnectionProfiles")!;
  assert.equal(profiles.sensitivity, "protected");
  assert.equal(profiles.backup.current, "sanitized");
  assert.equal(profiles.migration.policy, "protected-profile-unit");
});

test("diagnostic-history repository uses existing managed-files domain; backup/reset remain unimplemented", () => {
  const domain = STORAGE_DOMAIN_REGISTRY.find((item) => item.domainId === "diagnostic-history")!;
  assert.equal(domain.owner, "first-party-diagnostic");
  assert.equal(domain.storageClass, "managed-durable");
  assert.equal(domain.rootType, "managed-files");
  assert.equal(domain.implementation, "current");
  assert.deepEqual(domain.backup, { current: "not-implemented", relevant: true });
  assert.deepEqual(domain.reset, { current: "not-implemented", relevant: true });
  assert.deepEqual(domain.migration, { policy: "managed-files", relevant: true });
});

test("all repo-owned persistent localStorage writers have classified policies", () => {
  assert.deepEqual(auditLocalStoragePolicies(sources, LOCAL_STORAGE_DATA_POLICIES), []);
});

test("study-module preference omission fails the real writer guard", () => {
  const pattern = "review-workspace:study-module-preferences:v1";
  assert.ok(LOCAL_STORAGE_DATA_POLICIES.some((policy) => policy.pattern === pattern));
  const issues = auditLocalStoragePolicies(sources, LOCAL_STORAGE_DATA_POLICIES.filter((policy) => policy.pattern !== pattern));
  assert.ok(issues.some((issue) => issue.key === pattern && issue.file.endsWith("study-module-preferences-repository.ts")));
});

test("policy guard rejects new literal, aliased storage, wrapper key and unresolved dynamic key fixtures", () => {
  for (const source of [
    'window.localStorage.setItem("review-workspace:new-key", "x");',
    'const store = window["localStorage"]; store["setItem"]("review-workspace:new-key", "x");',
    'const store = (window.localStorage as Storage); store.setItem("review-workspace:new-key", "x");',
    'function store() { return window.localStorage; } store().setItem("review-workspace:new-key", "x");',
    'function save(store: Storage) { store.setItem("review-workspace:new-key", "x"); } save(window.localStorage);',
    'function save(key: string) { localStorage.setItem(key, "x"); } save("review-workspace:new-key");',
    'function emptyKey() { return; } localStorage.setItem(emptyKey(), "x");',
    'window.localStorage.setItem(getUntrustedKey(), "x");',
  ]) assert.ok(auditLocalStoragePolicies(new Map([[path.resolve("storage-policy-fixture.ts"), source]]), LOCAL_STORAGE_DATA_POLICIES).length > 0);
});
