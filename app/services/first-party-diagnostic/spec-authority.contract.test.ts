import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { FirstPartyDiagnosticSpecV1 } from "../../types/domains/first-party-diagnostic.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER as owner } from "./spec-authority.ts";
import { isPublishedDiagnosticSpec, recomputeAdditionKey } from "./spec-authority-core.ts";

function canonical(): FirstPartyDiagnosticSpecV1 {
  const result = owner.resolveSpec("int-add-2-3", "r1");
  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") throw new Error("canonical spec rejected");
  return result.spec;
}

test("known spec and exact revision resolve the canonical objective content and spec-only authority", () => {
  const spec = canonical();
  assert.equal(owner.id, "recall-diagnostic");
  assert.equal(spec.content.prompt, "2 + 3 = ?");
  assert.deepEqual(spec.content.options, [{ id: "four", text: "4" }, { id: "five", text: "5" }, { id: "six", text: "6" }]);
  assert.deepEqual(spec.responseFormat, { kind: "single_option_id", schemaVersion: 1 });
  assert.equal(spec.authority.scope, "spec_only");
  assert.equal(isPublishedDiagnosticSpec(spec), true);
  const { authority, ...rest } = spec;
  assert.equal(isPublishedDiagnosticSpec({ authority, ...rest }), true, "属性插入顺序不改变 canonical semantics");
});

test("unknown spec and revision reject without fallback to labels or another revision", () => {
  for (const id of ["unknown", "2 + 3 = ?", "整数加法", "constructor", "__proto__"])
    assert.deepEqual(owner.resolveSpec(id, "r1"), { kind: "rejected", reason: "unknown_spec" });
  for (const revision of ["r2", "latest", "R1"])
    assert.deepEqual(owner.resolveSpec("int-add-2-3", revision), { kind: "rejected", reason: "spec_revision_mismatch" });
});

test("malformed locators reject; object self-assertions do not become spec authority", () => {
  for (const value of [null, {}, [], 1, "", "x".repeat(257), "\ud800"])
    assert.deepEqual(owner.resolveSpec(value, "r1"), { kind: "rejected", reason: "invalid_request" });
  assert.deepEqual(owner.resolveSpec("int-add-2-3", { revision: "r1", verified: true }),
    { kind: "rejected", reason: "invalid_request" });
});

test("caller key, target, content and revision overrides never enter canonical lookup", () => {
  const result = Reflect.apply(owner.resolveSpec, owner, ["int-add-2-3", "r1", {
    verified: true, canonicalAnswer: "four", learningTarget: { category: "skill", namespace: "caller", id: "arbitrary" },
    revision: "r2", content: { prompt: "caller" }, preparationScope: "数学", keyRule: "llm_judge",
  }]);
  assert.deepEqual(result, owner.resolveSpec("int-add-2-3", "r1"));
});

test("canonical key is independently recomputed and cannot be replaced by a different option", () => {
  const spec = canonical();
  assert.equal(recomputeAdditionKey(spec.authority.operands, spec.content.options), "five");
  assert.equal(spec.verifiedCorrectOptionId, "five");
  assert.equal(isPublishedDiagnosticSpec({ ...spec, verifiedCorrectOptionId: "four" }), false);
});

test("LearningTarget is the exact question binding owned by the immutable spec", () => {
  const spec = canonical();
  assert.deepEqual(spec.learningTarget, { category: "question", namespace: "verified_assessment_question",
    id: JSON.stringify(["source-admission/v1", owner.id, spec.id, spec.revision, spec.contentRevision,
      spec.optionIds, spec.verifiedCorrectOptionId]) });
  assert.ok(spec.learningTarget.id.length <= 256);
  for (const target of [{ ...spec.learningTarget, id: "caller" }, { ...spec.learningTarget, category: "skill" },
    { ...spec.learningTarget, namespace: "中文显示标签" }])
    assert.equal(isPublishedDiagnosticSpec({ ...spec, learningTarget: target }), false);
});

test("published r1 snapshot stays auditable; changes require a separately published revision", () => {
  // 锁定整个已发布快照（包括正文、顺序、schema、key 与 target），不能修改此 pin 来覆盖 r1。
  const result = owner.resolveSpec("int-add-2-3", "r1");
  assert.equal(createHash("sha256").update(JSON.stringify(result)).digest("hex"),
    "35d87e73c9f8f2ce9009df6ac7656d54a5082265935738f8a518673f7ad082a1");
  const spec = canonical();
  assert.equal(isPublishedDiagnosticSpec({ ...spec, revision: "r2" }), false);
  assert.equal(isPublishedDiagnosticSpec({ ...spec, contentRevision: "r2" }), false);
});

test("content, option ordering, option text and response schema are revision semantics", () => {
  const spec = canonical();
  const reversedIds = [...spec.optionIds].reverse();
  for (const changed of [
    { ...spec, content: { ...spec.content, prompt: "求 2 + 3" } },
    { ...spec, optionIds: reversedIds, content: { ...spec.content, options: [...spec.content.options].reverse() },
      learningTarget: { ...spec.learningTarget, id: JSON.stringify(["source-admission/v1", owner.id, spec.id,
        spec.revision, spec.contentRevision, reversedIds, spec.verifiedCorrectOptionId]) } },
    { ...spec, content: { ...spec.content, options: [{ id: "four", text: "3" }, ...spec.content.options.slice(1)] } },
    { ...spec, responseFormat: { kind: "numeric_text", schemaVersion: 1 } },
    { ...spec, responseFormat: { kind: "single_option_id", schemaVersion: 2 } },
  ]) assert.equal(isPublishedDiagnosticSpec(changed), false);
});

test("even another mathematically correct item cannot reuse this spec identity or revision", () => {
  const spec = canonical();
  const changed = { ...spec, content: { ...spec.content, prompt: "1 + 4 = ?" },
    authority: { ...spec.authority, operands: [1, 4] } };
  assert.equal(recomputeAdditionKey(changed.authority.operands, changed.content.options), "five");
  assert.equal(isPublishedDiagnosticSpec(changed), false);
});

test("malformed specs fail closed without throwing or trusting attached authority fields", () => {
  const spec = canonical();
  const getter = Object.defineProperty({}, "schemaVersion", { get() { throw new Error("PRIVATE"); } });
  for (const value of [null, [], {}, getter, { ...spec, schemaVersion: 2 }, { ...spec, verified: true },
    { ...spec, authority: undefined }, { ...spec, learningTarget: undefined },
    { ...spec, content: { ...spec.content, options: Array(3) } }, { ...spec, optionIds: Array(3) },
    { ...spec, optionIds: ["four", "five", "five"] }, { ...spec, verifiedCorrectOptionId: "absent" },
    Object.assign(Object.create({ inherited: true }), spec)])
    assert.equal(isPublishedDiagnosticSpec(value), false);
});

test("key verifier rejects invalid integer domains, ambiguous answers and loose numeric parsing", () => {
  const options = canonical().content.options;
  for (const operands of [null, [], Array(2), [2, 3.1], [-0, 5], [-1, 6], [101, 0], [NaN, 3], [Infinity, 0]])
    assert.equal(recomputeAdditionKey(operands, options), null);
  for (const candidates of [null, Array(3), [{ id: "a", text: "05" }, { id: "b", text: "6" }],
    [{ id: "a", text: "5" }, { id: "b", text: "5" }], [{ id: "a", text: "5" }, { id: "a", text: "6" }],
    [{ id: "a", text: "4" }, { id: "b", text: "6" }], [{ id: "a", text: "5 " }, { id: "b", text: "6" }]])
    assert.equal(recomputeAdditionKey([2, 3], candidates), null);
  assert.equal(recomputeAdditionKey([0, 0], [{ id: "zero", text: "0" }, { id: "one", text: "1" }]), "zero");
  assert.equal(recomputeAdditionKey([100, 100], [{ id: "sum", text: "200" }, { id: "other", text: "199" }]), "sum");
});

test("authority metadata cannot claim capture, model judgment, or a different owner", () => {
  const spec = canonical();
  for (const authority of [{ ...spec.authority, scope: "spec_and_capture" }, { ...spec.authority, keyRule: "llm_judge" },
    { ...spec.authority, sourceOwnerId: "caller" }, { ...spec.authority, rationale: "first party means trusted" }])
    assert.equal(isPublishedDiagnosticSpec({ ...spec, authority }), false);
  assert.deepEqual(Object.keys(owner).toSorted(), ["id", "resolveSpec"]);
});

test("canonical specs and owner are deeply immutable across repeated lookups", () => {
  const spec = canonical();
  for (const value of [owner, spec, spec.optionIds, spec.content, spec.content.options, ...spec.content.options,
    spec.responseFormat, spec.learningTarget, spec.authority, spec.authority.operands]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.set(spec, "verifiedCorrectOptionId", "four"), false);
  assert.equal(Reflect.set(spec.optionIds, "0", "five"), false);
  assert.equal(Reflect.set(spec.content.options[0], "text", "5"), false);
  assert.equal(Reflect.set(spec.learningTarget, "id", "caller"), false);
  assert.equal(isPublishedDiagnosticSpec(canonical()), true);
});
