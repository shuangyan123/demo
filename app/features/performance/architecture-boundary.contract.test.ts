import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import "../review/learning-insight-model.contract.test.ts";
import "../../server/http/route-security.contract.test.ts";
import "../../services/local-runtime-diagnostics.contract.test.ts";
import "./neutral-interaction.contract.test.ts";
import "../../platform/host.contract.test.ts";
import "../../application/interview/interview-application.contract.test.ts";
import "../../application/automation/automation-application.contract.test.ts";
import "../../application/import/import-application.contract.test.ts";
import "../shared/workspace-context-registry.contract.test.ts";
import "../shared/ui-overlay-events.contract.test.ts";
import "../../services/learning-kernel/legacy-event-adapter.contract.test.ts";
import "../../services/learning-kernel/evidence.contract.test.ts";
import "../../services/learning-kernel/compatibility-snapshot.contract.test.ts";
import "../../services/learning-kernel/derive-learner-state.contract.test.ts";
import "../../services/learning-kernel/learner-state-policy.contract.test.ts";
import "../../services/learning-kernel/verified-assessment-adapter.contract.test.ts";
import "../../services/learning-kernel/verification-policy.contract.test.ts";
import "../../services/verification-source/verification-source-admission.contract.test.ts";
import "../../services/first-party-diagnostic/spec-authority.contract.test.ts";

const APP_ROOT = path.resolve(process.cwd(), "app");

/** 递归读取应用源码，用于建立不依赖第三方工具的架构守卫。 */
async function sourceFiles(directory: string, includeJavaScript = false, includeTests = false): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target, includeJavaScript, includeTests);
    const sourceExtension = includeJavaScript ? /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/ : /\.(?:ts|tsx)$/;
    return sourceExtension.test(entry.name) && (includeTests || !/\.test\.(?:ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) ? [target] : [];
  }));
  return nested.flat();
}

function staticImports(source: string): string[] {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

test("Recall Phase B/C/D/E5 Kernel 只依赖纯本地逻辑与 domain types", async () => {
  const kernelRoot = path.join(APP_ROOT, "services", "learning-kernel");
  const files = [path.join(APP_ROOT, "types/domains/learning-kernel.ts"), ...await sourceFiles(kernelRoot)];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = path.resolve(path.dirname(file), node.moduleSpecifier.text);
        const isKernel = target.startsWith(`${kernelRoot}${path.sep}`);
        const isDomainType = target.startsWith(`${path.join(APP_ROOT, "types", "domains")}${path.sep}`)
          && (ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly);
        assert.ok(isKernel || isDomainType, `${file} 引入非纯 Kernel 依赖：${node.moduleSpecifier.text}`);
      }
      if (ts.isCallExpression(node)) {
        assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword, `${file} 不允许 dynamic import 绕过纯依赖边界`);
        assert.ok(!ts.isIdentifier(node.expression) || node.expression.text !== "require", `${file} 不允许 require 绕过纯依赖边界`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|indexedDB|fetch|XMLHttpRequest|WebSocket)\b|reviewDesktop|reviewFenbi|Date\.now\s*\(|Math\.random\s*\(|randomUUID\s*\(|getRandomValues\s*\(|performance\.now\s*\(|new\s+Date\s*\(\s*\)|\.localeCompare\s*\(/);
    assert.doesNotMatch(source, /["']use client["']|["']use server["']/);
  }
});

test("Recall Phase C Evidence 保持内部边界且不派生 LearnerTargetState", async () => {
  const kernelRoot = path.join(APP_ROOT, "services", "learning-kernel");
  for (const file of await sourceFiles(APP_ROOT)) {
    const source = await readFile(file, "utf8");
    if (!file.startsWith(`${kernelRoot}${path.sep}`)) {
      assert.ok(!staticImports(source).some((specifier) => /learning-kernel\/(?:derive-evidence|evidence-policy|evidence-shadow)/.test(specifier)),
        `${file} 不得在 Phase C 接入 Evidence authority`);
    } else if (!["derive-learner-state.ts", "verification-policy.ts"].some((name) => file === path.join(kernelRoot, name))) {
      assert.doesNotMatch(source, /LearnerTargetState|lastVerifiedAt|nextVerificationAt|canonicalWeakness|\b(?:console|telemetry)\s*\./);
    }
  }
});

test("Recall Phase E5 state / authority / verification policy 保持 pure shadow-only，无外层 runtime consumer", async () => {
  const kernelRoot = path.join(APP_ROOT, "services", "learning-kernel");
  const stateModule = path.join(kernelRoot, "derive-learner-state.ts");
  const policyModule = path.join(kernelRoot, "learner-state-policy.ts");
  const verificationModule = path.join(kernelRoot, "verification-policy.ts");
  const source = await readFile(stateModule, "utf8");
  assert.match(source, /export function deriveLearnerTargetStates\(/);
  assert.ok(staticImports(source).includes("./learner-state-policy.ts"), "派生器必须消费唯一状态权限策略");
  const policySource = await readFile(policyModule, "utf8");
  assert.match(policySource, /export function evaluateLearnerStatePromotionEligibility\(/);
  assert.ok(staticImports(policySource).every((specifier) => ["../../types/domains/learning-kernel.ts", "./learning-event.ts",
    "./derive-evidence.ts", "./evidence-policy.ts"].includes(specifier)),
    "权限策略只允许纯 domain、确定性 helper 与 canonical Evidence engine/version");
  assert.match(policySource, /deriveEvidence\(events\)/);
  assert.match(policySource, /sameCanonicalEvidence\(item, expected\)/);
  assert.match(policySource, /LEARNER_STATE_POLICY_VERSION = "learner-state-policy\/v3"/);
  assert.match(source, /promotionEligibility\.understanding\.effectiveSupportingEvidenceIds/,
    "维度引用必须消费当前有效支持集合，不能继续使用全部历史合格支持");
  assert.doesNotMatch(source, /promotionEligibility\.understanding\.eligibleSupportingEvidenceIds/);
  assert.doesNotMatch(policySource, /\.payload\b|\b(?:console|telemetry)\s*\./,
    "必须先核对 canonical authority，再解释 scoped outcome；不能读取原始 payload");
  assert.doesNotMatch(source, /\.payload\b|\brecordedAt\s*[=:]|\b(?:console|telemetry)\s*\./,
    "state layer 不读取 Event payload 绕过 Evidence，也不输出 telemetry");
  const verificationSource = await readFile(verificationModule, "utf8");
  assert.match(verificationSource, /export function decideNextVerification\(/);
  assert.ok(staticImports(verificationSource).every((specifier) =>
    ["../../types/domains/learning-kernel.ts", "./learning-event.ts"].includes(specifier)),
    "Verification Policy 只消费 state 摘要与纯校验 helper，不重新解释 Evidence");
  assert.doesNotMatch(verificationSource, /EvidenceRecordV1|LearningEventV1|LearnerTargetState|canonicalWeakness|deriveEvidence|deriveLearnerTargetStates|evaluateLearnerStatePromotionEligibility|\.payload\b|\b(?:console|telemetry)\s*\.|\bDate\b|nextVerificationAt/,
    "WHAT-only policy 不重算历史或 state、不评分、不调度、不输出日志");
  const verificationAst = ts.createSourceFile(verificationModule, verificationSource, ts.ScriptTarget.Latest, true);
  const decision = verificationAst.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "decideNextVerification");
  assert.ok(decision?.body);
  assert.doesNotMatch(decision.body.getText(verificationAst), /candidateEvidenceIds|candidateMeasurementGroupIds|eligibleEvidenceIds|eligibleSupportingEvidenceIds|eligibleRefutingEvidenceIds|historicalQualifiedEvidenceIds|QUALIFICATION_ID_FIELDS/,
    "candidate/eligible/history 字段仅允许纯摘要校验 helper 使用，不能直接用于 target 选择");
  for (const file of await sourceFiles(APP_ROOT)) {
    if (file === stateModule) continue;
    const fileSource = await readFile(file, "utf8");
    if (!file.startsWith(`${kernelRoot}${path.sep}`) && file !== path.join(APP_ROOT, "types/domains/learning-kernel.ts")) {
      assert.doesNotMatch(fileSource, /\b(?:LearnerTargetStateV1|LearnerStatePromotionEligibilityV1|LearnerStatePromotionBlockerV1|VerificationDecisionV1|decideNextVerification|evaluateLearnerStatePromotionEligibility|deriveLearnerTargetStates|effectiveEvidenceIds|effectiveSupportingEvidenceIds|effectiveRefutingEvidenceIds|historicalQualifiedEvidenceIds)\b/,
        `${file} 不得接入 Phase E state / eligibility（包括 Phase D service）`);
    }
    const sourceFile = ts.createSourceFile(file, fileSource, ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node) => {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier) {
        const target = (specifier.startsWith("@/") ? path.join(APP_ROOT, specifier.slice(2))
          : path.resolve(path.dirname(file), specifier)).replace(/\.ts$/, "");
        assert.ok(![stateModule, policyModule, verificationModule].some((module) => target === module.replace(/\.ts$/, "")),
          `${file} 不得在 E5 接入 state / authority / verification policy（包括 compatibility bridge）`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
  const compatibility = await readFile(path.join(kernelRoot, "compatibility-snapshot.ts"), "utf8");
  assert.doesNotMatch(compatibility, /LearnerTargetState|LearnerStatePromotion|promotionEligibility|learner-state-policy|derive-learner-state/);
});

test("Recall verified assessment adapter 无 production writer，Fenbi wrong-only ImportDraft 不获验证权限", async () => {
  const kernelRoot = path.join(APP_ROOT, "services", "learning-kernel");
  const adapter = path.join(kernelRoot, "verified-assessment-adapter.ts");
  assert.match(await readFile(adapter, "utf8"), /export function adaptVerifiedAssessment\(/);
  const runtimeFiles = [...await sourceFiles(APP_ROOT),
    ...await sourceFiles(path.resolve(process.cwd(), "desktop"), true),
    ...await sourceFiles(path.resolve(process.cwd(), "scripts"), true)];
  for (const file of runtimeFiles) {
    const source = await readFile(file, "utf8");
    if (file.startsWith(`${kernelRoot}${path.sep}`) || ["types/domains/learning-kernel.ts", "types/domains/verification-source.ts",
      "services/verification-source/verification-source-admission-core.ts", "services/verification-source/verification-source-admission.ts"]
      .some((name) => file === path.join(APP_ROOT, name))) continue;
    assert.doesNotMatch(source, /VerifiedAssessment|adaptVerifiedAssessment|verification\.assessed|recall-verified-assessment\/v1|LearnerTargetStateV1|deriveLearnerTargetStates|evaluateLearnerStatePromotionEligibility|VerificationDecisionV1|decideNextVerification/,
      `${file} 不得接入新验证来源、state authority 或产生 verified Event`);
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node) => {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier) {
        const target = (specifier.startsWith("@/") ? path.join(APP_ROOT, specifier.slice(2))
          : path.resolve(path.dirname(file), specifier)).replace(/\.ts$/, "");
        assert.ok(![adapter, path.join(kernelRoot, "derive-learner-state.ts"), path.join(kernelRoot, "learner-state-policy.ts"),
          path.join(kernelRoot, "verification-policy.ts")]
          .some((module) => target === module.replace(/\.ts$/, "")), `${file} 不得 import/re-export/dynamic import 新来源或 state authority`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
  const fenbi = await readFile(path.join(APP_ROOT, "server/import/fenbi-account-import-adapter.ts"), "utf8");
  assert.match(fenbi, /Promise<ImportDraft\[\]>/);
  assert.match(fenbi, /normalizeFenbiDraft\(toDraftInput/);
  assert.match(fenbi, /\/api\/xingce\/errors\?/);
  assert.match(await readFile(path.join(APP_ROOT, "types/domains/fenbi-import.ts"), "utf8"), /wrongOnly: true/);
  const parser = await readFile(path.join(APP_ROOT, "services/fenbi-parser.ts"), "utf8");
  assert.match(parser, /normalizeFenbiDraft\(input: FenbiDraftInput\): ImportDraft/);
  for (const name of ["compatibility-snapshot.ts", "../learner-state-service.ts"]) {
    const source = await readFile(path.join(kernelRoot, name), "utf8");
    assert.doesNotMatch(source, /VerifiedAssessment|verification\.assessed|verified-assessment|learner-state-policy|derive-learner-state/);
  }
});

const VERIFICATION_SOURCE_ROOT = path.join(APP_ROOT, "services/verification-source");
const ADMISSION_CORE = path.join(VERIFICATION_SOURCE_ROOT, "verification-source-admission-core.ts");
const ADMISSION_ENTRY = path.join(VERIFICATION_SOURCE_ROOT, "verification-source-admission.ts");
const ADMISSION_TEST = path.join(VERIFICATION_SOURCE_ROOT, "verification-source-admission.contract.test.ts");

/** AST 覆盖 alias/re-export/import type/dynamic import/require；受信 resolver 只能在窄边界与专用测试中使用。 */
function verificationSourceImportViolations(file: string, source: string): string[] {
  const kernelRoot = path.join(APP_ROOT, "services/learning-kernel");
  const isTest = /\.test\.(?:ts|mts|cts|js|mjs|cjs)$/.test(file);
  const dedicatedTest = file === ADMISSION_TEST || (file.startsWith(`${kernelRoot}${path.sep}`) && file.endsWith(".contract.test.ts"));
  const kernelInternal = file.startsWith(`${kernelRoot}${path.sep}`) && !isTest;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const inspect = (node: ts.Node) => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      specifier = node.moduleSpecifier.text;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      specifier = node.argument.literal.text;
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) specifier = node.moduleReference.expression.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
      specifier = node.arguments[0].text;
    if (specifier) {
      const target = (specifier.startsWith("@/") ? path.resolve(APP_ROOT, "..", specifier.slice(2))
        : path.resolve(path.dirname(file), specifier)).replace(/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/, "");
      if (target === path.join(kernelRoot, "verified-assessment-adapter") && !kernelInternal && !dedicatedTest && file !== ADMISSION_CORE)
        violations.push("raw_adapter_bypass");
      if (target === ADMISSION_CORE.replace(/\.ts$/, "") && file !== ADMISSION_ENTRY && file !== ADMISSION_TEST)
        violations.push("arbitrary_owner_resolver");
      if (target.endsWith(".test") && !isTest) violations.push("test_owner_in_production");
      if (target === ADMISSION_ENTRY.replace(/\.ts$/, "") && !dedicatedTest)
        violations.push("runtime_adoption_before_source_approval");
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return violations;
}

test("Recall source admission 保持纯依赖、空生产 owner 集合且无注册或外层 runtime 入口", async () => {
  const core = await readFile(ADMISSION_CORE, "utf8");
  const entry = await readFile(ADMISSION_ENTRY, "utf8");
  const allowedImports = new Map([
    [ADMISSION_CORE, ["../../types/domains/verification-source.ts", "../../types/domains/learning-kernel.ts",
      "../learning-kernel/learning-event.ts", "../learning-kernel/verified-assessment-adapter.ts"]],
    [ADMISSION_ENTRY, ["../../types/domains/verification-source.ts", "./verification-source-admission-core.ts"]],
  ]);
  for (const [file, source] of [[ADMISSION_CORE, core], [ADMISSION_ENTRY, entry]]) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.ok(allowedImports.get(file)!.includes(node.moduleSpecifier.text), `${file} 不得依赖 runtime/DB/Provider`);
        if (node.moduleSpecifier.text.includes("/types/")) assert.ok(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly);
      }
      if (ts.isCallExpression(node)) assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword
        && (!ts.isIdentifier(node.expression) || node.expression.text !== "require"), `${file} 不允许隐藏运行时依赖`);
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|indexedDB|fetch|XMLHttpRequest|WebSocket)\b|reviewDesktop|reviewFenbi|Date\.now\s*\(|Math\.random\s*\(|randomUUID\s*\(|getRandomValues\s*\(|performance\.now\s*\(|new\s+Date\s*\(\s*\)|\.localeCompare\s*\(|\b(?:console|telemetry)\s*\./);
  }
  const entryAst = ts.createSourceFile(ADMISSION_ENTRY, entry, ts.ScriptTarget.Latest, true);
  const declarations = entryAst.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
  const owners = declarations.find((node) => ts.isIdentifier(node.name) && node.name.text === "AUTHORIZED_VERIFICATION_SOURCE_OWNERS");
  assert.ok(owners?.initializer && ts.isCallExpression(owners.initializer));
  assert.equal(owners.initializer.expression.getText(entryAst), "Object.freeze");
  assert.equal(owners.initializer.arguments.length, 1);
  assert.ok(ts.isArrayLiteralExpression(owners.initializer.arguments[0]));
  assert.equal(owners.initializer.arguments[0].elements.length, 0, "不得在 E6 注册任何 production/test owner");
  assert.ok(ts.isVariableStatement(owners.parent.parent));
  assert.equal(owners.parent.parent.declarationList.flags & ts.NodeFlags.Const, ts.NodeFlags.Const);
  assert.ok(!owners.parent.parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const exports = entryAst.statements.filter((node) => ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  assert.equal(exports.length, 1, "公共入口不导出注册 API、owner 或 resolver");
  assert.ok(ts.isFunctionDeclaration(exports[0]));
  assert.equal(exports[0].name?.text, "admitVerifiedAssessment");
  assert.equal(exports[0].parameters.length, 1, "普通 caller 不能传 owner/resolver");

  const files = [...await sourceFiles(APP_ROOT, true, true), ...await sourceFiles(path.resolve(APP_ROOT, "../desktop"), true, true),
    ...await sourceFiles(path.resolve(APP_ROOT, "../scripts"), true, true)];
  for (const file of files) {
    if (file === path.resolve(process.cwd(), "app/features/performance/architecture-boundary.contract.test.ts")) continue;
    const source = await readFile(file, "utf8");
    assert.deepEqual(verificationSourceImportViolations(file, source), [], `${file} 绕过 source admission 或泄漏 test owner`);
    if (![ADMISSION_CORE, ADMISSION_ENTRY, ADMISSION_TEST].includes(file))
      assert.doesNotMatch(source, /\b(?:AuthorizedVerificationSourceOwner|admitFromAuthorizedSource|AUTHORIZED_VERIFICATION_SOURCE_OWNERS)\b/,
        `${file} 不得私建/注册 owner 或访问受信 resolver`);
  }
});

test("Recall source admission AST guard 拒绝 alias/re-export/dynamic/type/require 和 test-owner bypass", () => {
  const outside = path.join(APP_ROOT, "services/admission-bypass.ts");
  for (const source of [
    'import { adaptVerifiedAssessment as normalize } from "./learning-kernel/verified-assessment-adapter.ts";',
    'export * from "@/app/services/learning-kernel/verified-assessment-adapter";',
    'const normalize = await import("./learning-kernel/verified-assessment-adapter.ts");',
    'const normalize = require("./learning-kernel/verified-assessment-adapter.ts");',
    'type Adapter = typeof import("./learning-kernel/verified-assessment-adapter.ts");',
  ]) assert.ok(verificationSourceImportViolations(outside, source).includes("raw_adapter_bypass"));
  for (const source of [
    'import { admitFromAuthorizedSource as admit } from "./verification-source/verification-source-admission-core.ts";',
    'export * from "./verification-source/verification-source-admission-core";',
    'import core = require("./verification-source/verification-source-admission-core.ts");',
  ]) assert.ok(verificationSourceImportViolations(outside, source).includes("arbitrary_owner_resolver"));
  assert.ok(verificationSourceImportViolations(outside,
    'import "./verification-source/verification-source-admission.contract.test.ts";').includes("test_owner_in_production"));
  assert.ok(verificationSourceImportViolations(outside,
    'import { admitVerifiedAssessment } from "./verification-source/verification-source-admission.ts";').includes("runtime_adoption_before_source_approval"));
  const adapterImport = 'import { adaptVerifiedAssessment } from "../learning-kernel/verified-assessment-adapter.ts";';
  assert.deepEqual(verificationSourceImportViolations(ADMISSION_CORE, adapterImport), []);
  assert.deepEqual(verificationSourceImportViolations(ADMISSION_TEST, adapterImport), []);
  assert.ok(verificationSourceImportViolations(path.join(VERIFICATION_SOURCE_ROOT, "arbitrary.test.ts"), adapterImport).includes("raw_adapter_bypass"));
});

const DIAGNOSTIC_SPEC_ROOT = path.join(APP_ROOT, "services/first-party-diagnostic");
const DIAGNOSTIC_SPEC_TEST = path.join(DIAGNOSTIC_SPEC_ROOT, "spec-authority.contract.test.ts");
const DIAGNOSTIC_SPEC_EDGES = new Map([
  [path.join(APP_ROOT, "types/domains/first-party-diagnostic.ts"), ["./learning-kernel.ts", "./verification-source.ts"]],
  [path.join(DIAGNOSTIC_SPEC_ROOT, "spec-catalog.ts"), ["../../types/domains/first-party-diagnostic.ts"]],
  [path.join(DIAGNOSTIC_SPEC_ROOT, "spec-authority-core.ts"), ["../../types/domains/first-party-diagnostic.ts",
    "../learning-kernel/learning-event.ts", "./spec-catalog.ts"]],
  [path.join(DIAGNOSTIC_SPEC_ROOT, "spec-authority.ts"), ["./spec-authority-core.ts"]],
]);

/** Spec capability 仅限固定内部边界与专用测试；不能由 UI、插件、其他测试或 admission 偷接 capture。 */
function diagnosticSpecImportViolations(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const inspect = (node: ts.Node) => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      specifier = node.moduleSpecifier.text;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      specifier = node.argument.literal.text;
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) specifier = node.moduleReference.expression.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
      specifier = node.arguments[0].text;
    if (specifier) {
      if (DIAGNOSTIC_SPEC_EDGES.has(file) && !DIAGNOSTIC_SPEC_EDGES.get(file)!.includes(specifier))
        violations.push("non_spec_dependency");
      const target = (specifier.startsWith("@/") ? path.resolve(APP_ROOT, "..", specifier.slice(2))
        : path.resolve(path.dirname(file), specifier)).replace(/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/, "");
      if (target.startsWith(`${DIAGNOSTIC_SPEC_ROOT}${path.sep}`)) {
        if (file !== DIAGNOSTIC_SPEC_TEST && !DIAGNOSTIC_SPEC_EDGES.has(file)) violations.push("spec_capability_outside_boundary");
        if (target.endsWith(".test")) violations.push("spec_test_owner_leak");
      }
    }
    if (DIAGNOSTIC_SPEC_EDGES.has(file) && (ts.isImportTypeNode(node) || ts.isImportEqualsDeclaration(node)
      || (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))))) violations.push("hidden_spec_dependency");
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return violations;
}

test("Recall first-party spec authority 只有纯规格依赖与内部能力，没有 capture/注册/runtime consumer", async () => {
  const files = await sourceFiles(DIAGNOSTIC_SPEC_ROOT);
  assert.deepEqual(files.toSorted(), [...DIAGNOSTIC_SPEC_EDGES.keys()].filter((file) => file.startsWith(`${DIAGNOSTIC_SPEC_ROOT}${path.sep}`)).toSorted());
  const expectedExports = new Map([
    ["first-party-diagnostic.ts", ["FirstPartyDiagnosticSpecV1", "FirstPartyDiagnosticSpecResolutionV1"]],
    ["spec-catalog.ts", ["PUBLISHED_ADDITION_SPEC"]],
    ["spec-authority-core.ts", ["isPublishedDiagnosticSpec", "recomputeAdditionKey", "resolvePublishedDiagnosticSpec"]],
    ["spec-authority.ts", ["FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER"]],
  ]);
  for (const file of DIAGNOSTIC_SPEC_EDGES.keys()) {
    const source = await readFile(file, "utf8");
    assert.deepEqual(diagnosticSpecImportViolations(file, source), []);
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|process)\b|reviewDesktop|reviewFenbi|Date\.now\s*\(|Math\.random\s*\(|randomUUID|getRandomValues|performance\.now|new\s+Date|\b(?:console|telemetry)\s*\./);
    assert.doesNotMatch(source, /LearningEvent|EvidenceRecord|deriveEvidence|LearnerTargetState|deriveLearnerTargetStates|decideNextVerification|verification\.assessed|resolveAttempt|["']use (?:client|server)["']/);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier) && (file.includes(`${path.sep}types${path.sep}`)
        || node.moduleSpecifier.text.includes("/types/"))) assert.ok(node.importClause?.isTypeOnly);
    if (expectedExports.has(path.basename(file))) {
      const exports = ast.statements.filter((node) => ts.canHaveModifiers(node)
        && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
        .flatMap((node) => ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node) ? [node.name?.text]
          : ts.isVariableStatement(node) ? node.declarationList.declarations.map((declaration) => declaration.name.getText(ast)) : ["unexpected_export"]);
      assert.deepEqual(exports.toSorted(), expectedExports.get(path.basename(file))!.toSorted(), "不能导出任意注册、resolver injection 或 capture API");
    }
  }
  const runtimeFiles = [...await sourceFiles(APP_ROOT, true, true), ...await sourceFiles(path.resolve(APP_ROOT, "../desktop"), true, true),
    ...await sourceFiles(path.resolve(APP_ROOT, "../scripts"), true, true)];
  for (const file of runtimeFiles) {
    if (file === path.resolve(process.cwd(), "app/features/performance/architecture-boundary.contract.test.ts")) continue;
    const source = await readFile(file, "utf8");
    assert.deepEqual(diagnosticSpecImportViolations(file, source), [], `${file} 不得注入规格或将 spec-only 能力当 capture authority`);
    if (file !== DIAGNOSTIC_SPEC_TEST && !DIAGNOSTIC_SPEC_EDGES.has(file))
      assert.doesNotMatch(source, /\b(?:FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER|PUBLISHED_ADDITION_SPEC|isPublishedDiagnosticSpec|resolvePublishedDiagnosticSpec|recomputeAdditionKey)\b/);
  }
});

test("Recall diagnostic spec AST guard 拒绝 UI/Planning/DB/Fenbi/LLM 与外层能力泄漏", () => {
  const core = path.join(DIAGNOSTIC_SPEC_ROOT, "spec-authority-core.ts");
  for (const specifier of ["../../features/review/view", "../preparation/derive-preparation-snapshot.ts",
    "../exam-planning/exam-next-task-policy.ts", "../review-repository.ts", "../../db/review-db.ts",
    "../fenbi-import-service.ts", "../../server/ai/provider-adapter.ts", "../learning-kernel/derive-evidence.ts"])
    assert.ok(diagnosticSpecImportViolations(core, `import type { Value } from "${specifier}";`).includes("non_spec_dependency"));
  const outside = path.join(APP_ROOT, "services/spec-bypass.ts");
  for (const source of [
    'import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER as owner } from "./first-party-diagnostic/spec-authority.ts";',
    'export * from "@/app/services/first-party-diagnostic/spec-authority";',
    'const owner = await import("./first-party-diagnostic/spec-authority.ts");',
    'const owner = require("./first-party-diagnostic/spec-authority.ts");',
    'import owner = require("./first-party-diagnostic/spec-authority.ts");',
    'type Owner = typeof import("./first-party-diagnostic/spec-authority.ts");',
  ]) assert.ok(diagnosticSpecImportViolations(outside, source).includes("spec_capability_outside_boundary"));
  assert.ok(diagnosticSpecImportViolations(ADMISSION_ENTRY,
    'import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../first-party-diagnostic/spec-authority.ts";').includes("spec_capability_outside_boundary"));
  assert.ok(diagnosticSpecImportViolations(outside,
    'import "./first-party-diagnostic/spec-authority.contract.test.ts";').includes("spec_test_owner_leak"));
});

test("Recall E7 冻结 #141/#142/#143 关键 API 与 admission 语义", async () => {
  const pins = new Map([
    ["types/domains/learning-kernel.ts", "f8dd65bb031e63394c467c22977cf421e970906cde5758e9fdb42ee09d5a6bb7"],
    ["types/domains/verification-source.ts", "ff17c1dbf36495b21b941e2fb7c9a008ec3f0312ddc85830e9b515f791b31daa"],
    ["services/verification-source/verification-source-admission.ts", "57efa729226aa2fc7b48c6d6f0a81bc344b3585e5b36d49ec04fa7208ab20db2"],
    ["services/verification-source/verification-source-admission-core.ts", "98c8ff9b015bc326659de02cf5b49febe4626fbebfb82052a7a5f803b028bd55"],
    ["services/learning-kernel/verified-assessment-adapter.ts", "4bb74ded75d21c71ac46f8ae08a72cf812804bb142e58fb71dc097aaa94b3d4c"],
    ["services/learning-kernel/derive-evidence.ts", "a1295c5675ee8c0e90247f40e90cef9910703a1ddd9d39d1e38e287f39f0bfaf"],
    ["services/learning-kernel/derive-learner-state.ts", "50b901aae6913481a3d76d297fd1e59a454b90aef7d2a184a0dabaae99bac60c"],
    ["services/learning-kernel/learner-state-policy.ts", "ab1e9ccd592d8a785a8ec88c51f19b3ad56101d036e29d7e0c88df0c04b15a95"],
    ["services/learning-kernel/verification-policy.ts", "14ee81579febec9eed4e3eb3ec30c519ac5a075558553b8fe06ff4c6f6f5c009"],
  ]);
  for (const [file, expected] of pins) assert.equal(createHash("sha256").update((await readFile(path.join(APP_ROOT, file), "utf8"))
    .replace(/\r\n/g, "\n")).digest("hex"), expected, `${file} 的既有语义不属于 E7 修改范围`);
});

test("Recall Phase D compatibility bridge 只允许 learner-state-service 接入", async () => {
  const bridge = path.join(APP_ROOT, "services/learning-kernel/compatibility-snapshot.ts");
  const consumer = path.join(APP_ROOT, "services/learner-state-service.ts");
  const kernelRoot = path.join(APP_ROOT, "services/learning-kernel");
  const callers = new Set<string>();
  for (const file of await sourceFiles(APP_ROOT)) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node) => {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier) {
        const target = path.resolve(path.dirname(file), specifier).replace(/\.ts$/, "");
        if (target === bridge.replace(/\.ts$/, "")) {
          assert.equal(file, consumer, `${file} 不得直接消费 Phase D bridge`);
          callers.add(file);
        }
        if (!file.startsWith(`${kernelRoot}${path.sep}`)) {
          assert.ok(!["derive-evidence", "evidence-policy", "evidence-shadow"].some((name) => target === path.join(kernelRoot, name)),
            `${file} 不得绕过 bridge 直接接入 Evidence`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
  assert.deepEqual([...callers], [consumer]);
  const source = await readFile(consumer, "utf8");
  assert.match(source, /projectLegacyResultCompatibility\(\{ reviewAttempts: facts\.attempts, knowledgeAttempts: facts\.knowledgeAttempts \}\)/);
  assert.doesNotMatch(source, /Map<string, KnowledgeAttempt>|latestReviewAttempts|latestKnowledgeAttempts/);
  assert.equal([...source.matchAll(/\bfacts\.(?:attempts|knowledgeAttempts)\b/g)].length, 2, "raw Attempt 数组只能传入 bridge，兼容派生不得另读 raw result");
  assert.match(source, /projectLegacyTutoringCompatibility\(\{ tutoringTurns: facts\.tutoringTurns \}\)/);
  assert.equal([...source.matchAll(/\bfacts\.tutoringTurns\b/g)].length, 2, "raw Tutoring 仅可传入 bridge 和计数未提交工作流");
  assert.doesNotMatch(source, /microAssessment(?:\?|!)?\.(?:correctCount|selections)|Map<string, TutoringTurn>/);
  const workflowLine = source.split("\n").find((line) => line.includes("facts.tutoringTurns.filter"));
  assert.equal(workflowLine?.trim(), "const insufficientEvidenceCount = facts.tutoringTurns.filter((turn) => turn.microAssessment?.questions.length && !turn.microAssessment.completedAt).length");
  assert.match(source, /projectLegacyInterviewCompatibility\(\{ interviewEvaluations: facts\.interviewEvaluations, interviewSessions: facts\.interviewSessions \}\)/);
  assert.equal([...source.matchAll(/\bfacts\.interviewEvaluations\b/g)].length, 1, "raw InterviewEvaluation 只能传入 bridge，不能另读评分或 sessionId 权限");
  assert.doesNotMatch(source, /\b(?:totalScore|dimension\.comment|evaluation\.updatedAt)\b|interviewSignals\(facts\./);
  assert.match(source, /evaluatedSessionIds = new Set\(interviewCompatibility\.map/);
  const consumerFile = ts.createSourceFile(consumer, source, ts.ScriptTarget.Latest, true);
  const signals = consumerFile.statements.find((node): node is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(node) && node.name?.text === "interviewSignals"
  ));
  assert.equal(signals?.parameters[0].type?.getText(consumerFile), "EvaluatedInterviewCompatibility[]",
    "Interview weakness-style 展示只能读已校验 model-assessment compatibility");
  const inspectInterviewReads = (node: ts.Node) => {
    if ((ts.isPropertyAccessExpression(node) && node.name.text === "interviewEvaluations" && node.expression.getText(consumerFile) !== "reviewDb")
      || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        && node.argumentExpression.text === "interviewEvaluations")) {
      assert.ok(ts.isPropertyAssignment(node.parent) && ts.isObjectLiteralExpression(node.parent.parent)
        && ts.isCallExpression(node.parent.parent.parent)
        && node.parent.parent.parent.expression.getText(consumerFile) === "projectLegacyInterviewCompatibility",
      "raw Interview 数组只能作为 bridge 参数，不能通过 alias 读取模型权限");
    }
    ts.forEachChild(node, inspectInterviewReads);
  };
  inspectInterviewReads(consumerFile);
});

test("业务源码直接引用领域类型且核心 facade 保持预算", async () => {
  const files = await sourceFiles(APP_ROOT);
  const compatibilityImports: string[] = [];
  for (const file of files) {
    if (file.endsWith(path.join("types", "review.ts"))) continue;
    const source = await readFile(file, "utf8");
    if (staticImports(source).some((specifier) => /(?:^|\/)types\/review(?:\.ts)?$/.test(specifier))) {
      compatibilityImports.push(path.relative(APP_ROOT, file));
    }
  }
  assert.deepEqual(compatibilityImports, []);

  const budgets = new Map([
    ["types/review.ts", 300],
    ["server/ai/provider-adapter.ts", 500],
    ["server/ai/provider-speech-adapter.ts", 500],
    ["services/obsidian-knowledge-repository.ts", 500],
    ["services/obsidian-repository-helpers.ts", 500],
  ]);
  for (const [relativePath, budget] of budgets) {
    const lines = (await readFile(path.join(APP_ROOT, relativePath), "utf8")).split(/\r?\n/).length;
    assert.ok(lines <= budget, `${relativePath} 为 ${lines} 行，超过 ${budget} 行预算`);
  }
});

test("业务层只能通过 Host Capability 访问 Electron preload", async () => {
  const files = await sourceFiles(APP_ROOT);
  const directBridgeReferences: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(APP_ROOT, file).replace(/\\/g, "/");
    if (relativePath === "types/review-desktop.d.ts" || relativePath.startsWith("platform/desktop/")) continue;
    const source = await readFile(file, "utf8");
    if (/reviewDesktop(?:Vault|Window|CredentialProtection)|reviewFenbi(?:Session|View)/.test(source)) directBridgeReferences.push(relativePath);
  }
  assert.deepEqual(directBridgeReferences, []);

  const platformFiles = files.filter((file) => file.includes(path.join("app", "platform")));
  for (const file of platformFiles) {
    const source = await readFile(file, "utf8");
    const imports = staticImports(source);
    assert.equal(imports.some((target) => /(?:^|\/)(?:application|features|services|db|server)(?:\/|$)/.test(target)), false);
    assert.equal(imports.some((target) => target === "react" || target.startsWith("react/")), false);
  }
});

test("凭据保护保持 WebCrypto 与 Desktop Host 分离并拒绝通用 native crypto", async () => {
  const files = await sourceFiles(APP_ROOT);
  const plannerSource = await readFile(path.join(APP_ROOT, "services/credential-migration-planner.ts"), "utf8");
  const webCryptoSource = await readFile(path.join(APP_ROOT, "services/crypto-service.ts"), "utf8");
  const desktopAdapterSource = await readFile(path.join(APP_ROOT, "platform/desktop/desktop-host-adapter.ts"), "utf8");
  const platformCredentialSource = await readFile(path.join(APP_ROOT, "platform/credential-protection.ts"), "utf8");

  assert.doesNotMatch(plannerSource, /React|Electron|safeStorage|window|document|fetch\s*\(|reviewDb|decryptSecret|localStorage|ipc/i);
  assert.doesNotMatch(webCryptoSource, /from\s+["']electron["']|safeStorage/);
  assert.doesNotMatch(desktopAdapterSource, /from\s+["']electron["']|safeStorage/);
  assert.match(platformCredentialSource, /selectCredentialProtectionBackend/);

  const featureOrServiceNativeImports: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(APP_ROOT, file).replace(/\\/g, "/");
    if (relativePath.startsWith("platform/desktop/") || relativePath === "types/review-desktop.d.ts") continue;
    const source = await readFile(file, "utf8");
    if (/safeStorage|from\s+["']electron["']/.test(source)) featureOrServiceNativeImports.push(relativePath);
  }
  assert.deepEqual(featureOrServiceNativeImports, []);

  const productionCredentialConsumers: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(APP_ROOT, file).replace(/\\/g, "/");
    if (!relativePath.startsWith("features/") && !relativePath.startsWith("application/") && !relativePath.startsWith("services/")) continue;
    const source = await readFile(file, "utf8");
    if (relativePath === "services/credential-backend.ts") {
      assert.doesNotMatch(source, /reviewDesktop(?:Vault|Window|CredentialProtection)/);
      continue;
    }
    if (/credentialProtection|protectCredential|unprotectCredential/.test(source)) productionCredentialConsumers.push(relativePath);
  }
  assert.deepEqual(productionCredentialConsumers, []);
});

test("Application Layer 保持纯 TypeScript 且不反向依赖 UI 或宿主全局", async () => {
  const applicationRoot = path.join(APP_ROOT, "application");
  const files = await sourceFiles(applicationRoot);
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports = staticImports(source);
    const forbiddenImport = imports.find((target) => (
      target === "react"
      || target.startsWith("react/")
      || target === "react-dom"
      || target.startsWith("react-dom/")
      || target.startsWith("next/")
      || /(?:^|\/)features(?:\/|$)/.test(target)
      || /\.css$/i.test(target)
    ));
    if (forbiddenImport || /reviewDesktop(?:Vault|Window|CredentialProtection)|\bwindow\b|\bdocument\b/.test(source)) {
      violations.push(path.relative(APP_ROOT, file).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(violations, []);
});

test("MCP permission core 与 execution boundary 不被 Feature UI 绕过", async () => {
  const coreSource = await readFile(path.join(APP_ROOT, "services/mcp-permission.ts"), "utf8");
  const sessionStoreSource = await readFile(path.join(APP_ROOT, "services/mcp-session-permission-store.ts"), "utf8");
  const repositorySource = await readFile(path.join(APP_ROOT, "services/mcp-settings-repository.ts"), "utf8");
  const executionSource = await readFile(path.join(APP_ROOT, "services/mcp-execution.ts"), "utf8");
  const panelSource = await readFile(path.join(APP_ROOT, "features/conversation/conversation-mcp-tool-panel.tsx"), "utf8");
  const conversationFiles = (await sourceFiles(path.join(APP_ROOT, "features", "conversation")));
  const files = await sourceFiles(APP_ROOT);

  assert.doesNotMatch(coreSource, /react|next\/|Electron|Dexie|localStorage|fetch\s*\(|crypto|window|document/i);
  assert.doesNotMatch(sessionStoreSource, /export\s+(?:const|let|var)\s+\w+\s*=\s*new\s+Set/);
  assert.match(sessionStoreSource, /export function hasMcpSessionPermission/);
  assert.match(sessionStoreSource, /export function grantMcpSessionPermission/);
  assert.match(sessionStoreSource, /export function revokeMcpSessionPermission/);
  assert.match(repositorySource, /normalizeMcpPersistedPermission/);
  assert.match(repositorySource, /import\("\.\/mcp-execution\.ts"\)/);
  assert.match(executionSource, /decideMcpToolPermission/);
  assert.match(executionSource, /hasMcpSessionPermission/);
  assert.doesNotMatch(executionSource, /grantMcpSessionPermission|revokeMcpSessionPermission|clearMcpSessionPermissions|retainMcpSessionPermissions/);
  assert.match(executionSource, /decision !== "allowed"[\s\S]*?dependencies\.tokenFor\(profile\)/);
  assert.match(repositorySource, /callScheduledTool[\s\S]*?executeTool\(serverId, toolName, args/);
  assert.match(panelSource, /callTool\(server, tool\.name, args, \{ mode: "interactive", confirmed: true \}\)/);
  assert.match(panelSource, /确认并调用/);

  for (const file of conversationFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\/api\/mcp\/call|decryptSecret|tokenFor\(/, path.relative(APP_ROOT, file));
    assert.doesNotMatch(source, /permission\s*===\s*["']allow_scheduled["']/, path.relative(APP_ROOT, file));
  }

  const featureFiles = (await sourceFiles(path.join(APP_ROOT, "features"))).filter((file) => !file.endsWith(".contract.test.ts"));
  for (const file of featureFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /mcp-session-permission-store|grantMcpSessionPermission|revokeMcpSessionPermission|clearMcpSessionPermissions|retainMcpSessionPermissions/, path.relative(APP_ROOT, file));
  }

  const mutationViolations: string[] = [];
  const clearForTestViolations: string[] = [];
  const confirmedMcpCallerViolations: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(APP_ROOT, file).replace(/\\/g, "/");
    const source = await readFile(file, "utf8");
    if (/grantMcpSessionPermission|revokeMcpSessionPermission|clearMcpSessionPermissions|retainMcpSessionPermissions/.test(source) && relativePath !== "services/mcp-settings-repository.ts" && relativePath !== "services/mcp-session-permission-store.ts") {
      mutationViolations.push(relativePath);
    }
    if (/clearAllMcpSessionPermissionsForTest\s*\(/.test(source) && relativePath !== "services/mcp-session-permission-store.ts") {
      clearForTestViolations.push(relativePath);
    }
    // `confirmed` is also a valid field for the separate credential cleanup
    // facade; keep the existing MCP-specific caller allowlist explicit.
    if (/confirmed\s*:\s*true/.test(source)
      && relativePath !== "features/conversation/conversation-mcp-tool-panel.tsx"
      && relativePath !== "services/credential-cleanup-execution.ts") {
      confirmedMcpCallerViolations.push(relativePath);
    }
  }
  assert.deepEqual(mutationViolations, []);
  assert.deepEqual(clearForTestViolations, []);
  assert.deepEqual(confirmedMcpCallerViolations, []);

  const automationExecutorSource = await readFile(path.join(APP_ROOT, "services/automation-executor.ts"), "utf8");
  assert.doesNotMatch(automationExecutorSource, /\/api\/mcp\/call|\/api\/acquisition\/fetch|fetch\s*\(/);
  const acquisitionFiles = files.filter((file) => path.relative(APP_ROOT, file).replace(/\\/g, "/").startsWith("services/acquisition-"));
  for (const file of acquisitionFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\/api\/mcp\/call/);
  }
  const scheduledCallers: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/callScheduledTool\s*\(/.test(source)) scheduledCallers.push(path.relative(APP_ROOT, file).replace(/\\/g, "/"));
  }
  assert.deepEqual(scheduledCallers.sort(), [
    "services/acquisition-source-service.ts",
    "services/mcp-settings-repository.ts",
  ]);
});

test("声明式扩展和内置插件在真实执行入口复核当前状态", async () => {
  const [permissionSource, serviceSource, settingsSource, obsidianBridgeSource, obsidianRuntimeSource, importProviderSource, fenbiQuickImportSource] = await Promise.all([
    readFile(path.join(APP_ROOT, "services/declarative-extension-permissions.ts"), "utf8"),
    readFile(path.join(APP_ROOT, "services/declarative-extension-service.ts"), "utf8"),
    readFile(path.join(APP_ROOT, "features/settings/plugins/settings-plugins-view.tsx"), "utf8"),
    readFile(path.join(APP_ROOT, "features/knowledge/use-obsidian-knowledge-bridge.ts"), "utf8"),
    readFile(path.join(APP_ROOT, "services/obsidian-sync-runtime.ts"), "utf8"),
    readFile(path.join(APP_ROOT, "services/import-provider-plugins.ts"), "utf8"),
    readFile(path.join(APP_ROOT, "features/import/use-fenbi-quick-import.ts"), "utf8"),
  ]);
  assert.doesNotMatch(permissionSource, /react|next\/|reviewDb|fetch\s*\(|MCP|Electron|window|document/i);
  assert.match(permissionSource, /resolveExtensionAuthorization/);
  assert.match(serviceSource, /inspectInstalledExtensionAuthorization/);
  assert.match(serviceSource, /executeInstalledExtensionAction/);
  assert.doesNotMatch(serviceSource, /eval\s*\(|new\s+Function|<script|\.tsx/i);
  assert.match(settingsSource, /executeInstalledExtensionAction/);
  assert.match(settingsSource, /extensionAuthorizationMessage/);
  assert.doesNotMatch(settingsSource, /fetch\s*\(|\/api\/mcp|reviewDesktop(?:Vault|Window)/);
  assert.match(obsidianBridgeSource, /assertSettingsPluginEnabled\("obsidian-vault"\)/);
  assert.match(obsidianRuntimeSource, /settingsPluginPreferencesRepository\.isEnabled\("obsidian-vault"\)/);
  assert.match(importProviderSource, /assertSettingsPluginEnabled\("fenbi-import"\)/);
  assert.match(fenbiQuickImportSource, /assertSettingsPluginEnabled\("fenbi-import"\)[\s\S]*?fenbiCredentialRepository\.reveal/);
});

test("AI capability core 保持纯 TypeScript 且不反向依赖协议实现", async () => {
  const capabilityFiles = [
    "types/domains/ai-capability.ts",
    "services/ai-capability-resolution.ts",
    "services/provider-protocol-capabilities.ts",
    "services/model-runtime-descriptors.ts",
  ];
  for (const relativePath of capabilityFiles) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    const imports = staticImports(source);
    assert.equal(imports.some((target) => target === "react" || target.startsWith("react/") || target.startsWith("next/") || target.includes("/features/") || target.includes("/server/ai/")), false, relativePath);
    assert.doesNotMatch(source, /\bfetch\s*\(|reviewDb|reviewDesktop(?:Vault|Window)|apiKey|Authorization|\.tsx["']/i, relativePath);
    if (relativePath === "services/ai-capability-resolution.ts") assert.doesNotMatch(source, /provider-model-cache/, relativePath);
  }
  const adapterRegistry = await readFile(path.join(APP_ROOT, "server/ai/provider-adapter-registry.ts"), "utf8");
  assert.match(adapterRegistry, /provider-protocol-capabilities/);
});

test("AI provider normalization keeps failure data safe and vendor fields behind the adapter", async () => {
  const failureCore = await readFile(path.join(APP_ROOT, "services/ai-provider-failure.ts"), "utf8");
  const providerFailure = await readFile(path.join(APP_ROOT, "server/ai/provider-failure.ts"), "utf8");
  const registry = await readFile(path.join(APP_ROOT, "server/ai/provider-adapter-registry.ts"), "utf8");
  const route = await readFile(path.join(APP_ROOT, "api/ai/generate/route.ts"), "utf8");
  const client = await readFile(path.join(APP_ROOT, "services/api-client.ts"), "utf8");
  const clientFailure = await readFile(path.join(APP_ROOT, "services/ai-provider-failure-client.ts"), "utf8");
  const conversation = await readFile(path.join(APP_ROOT, "features/conversation/conversation-workspace.tsx"), "utf8");

  assert.doesNotMatch(failureCore, /apiKey|Authorization|prompt|raw response|hidden reasoning/i);
  assert.doesNotMatch(providerFailure, /apiKey|Authorization|prompt|raw response|hidden reasoning/i);
  assert.match(failureCore, /malformed_response/);
  assert.match(failureCore, /stream_interrupted/);
  assert.match(registry, /parseFailure/);
  assert.match(registry, /streamCompletion/);
  assert.match(route, /adapter\.parseFailure/);
  assert.match(route, /classifyProviderStreamFailure/);
  assert.match(client, /providerFailureClientModule/);
  assert.match(clientFailure, /AiProviderFailureError/);
  assert.doesNotMatch(conversation, /(?:choices|candidates|output_text|content_block_delta|usageMetadata|prompt_tokens|completion_tokens)/);
  const conversationMessageUtils = await readFile(path.join(APP_ROOT, "features/conversation/conversation-message-utils.ts"), "utf8");
  assert.match(conversationMessageUtils, /AiProviderFailureError/);
  assert.match(conversationMessageUtils, /aiProviderFailureMessage/);
  assert.doesNotMatch(conversationMessageUtils, /at capacity|overload|resource exhausted|429|503/);
  assert.doesNotMatch(conversation, /模型没有返回文本/);
  assert.match(conversation, /requireConversationAssistantContent\(finalContent\)/);
  assert.doesNotMatch(conversation, /throw new Error\(event\.message\)/);
});

test("AI consumers remain behind the unified generation and normalization boundary", async () => {
  const consumerPaths = [
    "features/conversation/conversation-workspace.tsx",
    "services/tutoring-ai-service.ts",
    "services/interview-ai-service.ts",
    "services/automation-executor.ts",
    "services/knowledge-evolution-service.ts",
    "services/acquisition-proposal-service.ts",
    "services/fenbi-import-service.ts",
  ];
  const forbiddenVendorBoundary = /parseGenerateProvider|parseProviderFailure|getProviderAdapter|response\.json\(\)|output_text|content_block_delta|usageMetadata|prompt_tokens|completion_tokens|response\.completed|message_stop|step\.delta|generationConfig|reasoning_effort|thinkingConfig|anthropic-version/;
  for (const relativePath of consumerPaths) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    const imports = staticImports(source);
    assert.equal(imports.some((target) => target.includes("/server/ai/")), false, relativePath);
    assert.match(source, /generateWithConnection/, relativePath);
    assert.doesNotMatch(source, forbiddenVendorBoundary, relativePath);
  }
  const automationFailure = await readFile(path.join(APP_ROOT, "services/automation-failure.ts"), "utf8");
  assert.match(automationFailure, /recoveryDiagnosis/);
  assert.match(automationFailure, /"recoveryDiagnosis"\s+in\s+error/);
  assert.match(automationFailure, /message: providerFailure\.message/);
  assert.doesNotMatch(automationFailure, /throw new Error\(event\.message\)/);
});

test("Connection-scoped capability resolver 独占缓存编排且 UI 不直接读取模型缓存", async () => {
  const resolverSource = await readFile(path.join(APP_ROOT, "services/ai-connection-client.ts"), "utf8");
  const conversationSource = await readFile(path.join(APP_ROOT, "features/conversation/conversation-workspace.tsx"), "utf8");
  assert.match(resolverSource, /providerModelCache/);
  assert.match(resolverSource, /resolveModelCapabilityProfile/);
  assert.match(resolverSource, /resolveConnectionModelCapabilityProfile\(connection: ApiConnectionProfile, modelId: string\)[\s\S]*?providerModelCache\.load\(connection\.id, connection\.provider, connection\.baseUrl\)[\s\S]*?resolveModelCapabilityProfile\(connection\.provider, modelId, discovered\)/);
  assert.match(conversationSource, /resolveConnectionModelCapabilityProfile/);
  assert.doesNotMatch(conversationSource, /provider-model-cache/);
});

test("学习行动队列保持只读纯派生边界", async () => {
  const source = await readFile(path.join(APP_ROOT, "services/learner-state-service.ts"), "utf8");
  const types = await readFile(path.join(APP_ROOT, "types/domains/learner-state.ts"), "utf8");
  const controller = await readFile(path.join(APP_ROOT, "features/review/use-review-workspace-controller.ts"), "utf8");
  const imports = staticImports(source);
  assert.equal(imports.some((target) => target === "react" || target.startsWith("react/") || target.includes("/features/") || target.includes("/server/ai/")), false);
  assert.doesNotMatch(source, /reviewDb\.(?:transaction|\w+\.(?:add|put|update|delete|bulkAdd|bulkPut|bulkDelete))\(/);
  assert.doesNotMatch(source, /fetch\(|generateAi|automationRepository|obsidianKnowledgeRepository|reviewDesktop(?:Vault|Window)/);
  assert.match(source, /reviewRepository\.loadSnapshot\(today\)/);
  assert.match(source, /knowledgeRepository\.loadTrainingSnapshot\(today\)/);
  assert.doesNotMatch(source, /reviewDb\.(?:mistakes|attempts|knowledgeEntries|knowledgeAttempts)\.toArray\(\)/);
  assert.match(source, /reviewDb\.interviewPracticePlans\.toArray\(\)/);
  assert.match(source, /deriveLearnerStateSnapshot/);
  assert.match(types, /semanticKey: string/);
  assert.match(types, /completionHint: string/);
  assert.doesNotMatch(types, /(?:isCompleted|completedAt|completionEvent|completionHistory):/);
  assert.match(controller, /nextView === "dashboard"[\s\S]{0,160}data\.refreshData\(\)/);
});

test("大型 workspace 保持受控预算并使用专用 controller", async () => {
  const budgets = new Map([
    ["features/review/review-workspace.tsx", 150],
    ["features/review/use-review-workspace-controller.ts", 300],
    ["features/review/use-review-learning-controller.ts", 500],
    ["features/review/use-review-knowledge-controller.ts", 500],
    ["features/review/review-workspace-view-router.tsx", 300],
    ["features/review/review-workspace-core-views.tsx", 300],
    ["features/review/review-workspace-secondary-views.tsx", 300],
    ["features/review/review-workspace-lazy-views.tsx", 120],
    ["features/review/review-workspace-shell.tsx", 500],
    ["features/review/review-dashboard-view.tsx", 320],
    ["features/knowledge/knowledge-workspace.tsx", 825],
    ["features/tutoring/tutoring-workspace.tsx", 230],
    ["features/conversation/conversation-workspace.tsx", 500],
    ["features/conversation/conversation-composer.tsx", 300],
    ["features/conversation/conversation-tutoring-experience.tsx", 300],
    ["features/interview/interview-workspace.tsx", 300],
    ["features/interview/interview-session-panel.tsx", 200],
    ["features/automation/automation-view.tsx", 220],
    ["features/automation/automation-overlays.tsx", 240],
    ["features/automation/automation-task-list.tsx", 190],
    ["features/automation/automation-inbox.tsx", 190],
    ["features/import/review-import-view.tsx", 500],
    ["features/knowledge/knowledge-training-view.tsx", 180],
    ["features/review/learning-insight-view.tsx", 180],
    ["features/settings/plugins/settings-plugins-view.tsx", 340],
    ["features/conversation/command-search-palette.tsx", 220],
    ["features/shared/learning-session-layout.tsx", 200],
    ["features/shared/workspace-shell.tsx", 240],
  ]);
  for (const [relativePath, budget] of budgets) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    assert.ok(source.split(/\r?\n/).length <= budget, `${relativePath} 超过 ${budget} 行架构预算`);
  }
  const reviewSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace.tsx"), "utf8");
  const controllerSource = await readFile(path.join(APP_ROOT, "features/review/use-review-workspace-controller.ts"), "utf8");
  const lazyViewsSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace-lazy-views.tsx"), "utf8");
  const routeSources = await Promise.all([
    "features/review/review-workspace-view-router.tsx",
    "features/review/review-workspace-core-views.tsx",
    "features/review/review-workspace-secondary-views.tsx",
  ].map((relativePath) => readFile(path.join(APP_ROOT, relativePath), "utf8")));

  assert.match(reviewSource, /useReviewWorkspaceController/);
  assert.match(reviewSource, /ReviewWorkspaceViewRouter/);
  assert.doesNotMatch(reviewSource, /useState|repository|services\//);
  assert.match(controllerSource, /useReviewConversationController/);
  assert.match(controllerSource, /useReviewLearningController/);
  assert.match(controllerSource, /useReviewKnowledgeController/);
  assert.match(lazyViewsSource, /dynamic\(\s*\(\) => import\("\.\.\/knowledge\/knowledge-training-view"\)/);
  assert.match(lazyViewsSource, /dynamic\(\s*\(\) => import\("\.\.\/conversation\/conversation-workspace"\)/);
  routeSources.forEach((source) => {
    assert.equal(staticImports(source).some((target) => target.includes("/services/") || target.includes("repository")), false);
  });
  assert.match(routeSources[1], /view === "stats"/);
});

test("所有 React 组件均不超过五百行", async () => {
  const files = (await sourceFiles(APP_ROOT)).filter((file) => file.endsWith(".tsx"));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const inspect = (node: ts.Node) => {
      let name = "";
      if (ts.isFunctionDeclaration(node)) name = node.name?.text ?? "";
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        name = node.name.text;
      }
      if (/^[A-Z]/.test(name)) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
        assert.ok(end - start + 1 <= 500, `${path.relative(APP_ROOT, file)} 中组件 ${name} 超过 500 行`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
});

test("P3 低频表面使用本地样式与真实派生模型", async () => {
  const importSource = await readFile(path.join(APP_ROOT, "features/import/review-import-view.tsx"), "utf8");
  const insightSource = await readFile(path.join(APP_ROOT, "features/review/learning-insight-model.ts"), "utf8");
  const pluginSource = await readFile(path.join(APP_ROOT, "features/settings/plugins/settings-plugins-view.tsx"), "utf8");
  const searchSource = await readFile(path.join(APP_ROOT, "features/conversation/command-search-palette.tsx"), "utf8");

  assert.match(importSource, /review-import-view\.module\.css/);
  assert.match(importSource, /type ImportMobileStep = "source" \| "draft" \| "confirm"/);
  assert.match(insightSource, /MIN_RELIABLE_ATTEMPTS = 5/);
  assert.match(insightSource, /mistakeById\.has\(attempt\.mistakeId\)/);
  assert.match(pluginSource, /buildPluginDirectory\(settingsPluginDefinitions/);
  assert.doesNotMatch(pluginSource, /download|rating|推荐插件/);
  assert.match(searchSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(searchSource, /restoreFocusRef\.current\?\.focus\(\)/);
});

test("WorkspaceShell 默认向所有宿主提供通用外层边界", async () => {
  const shellSource = await readFile(path.join(APP_ROOT, "features/shared/workspace-shell.tsx"), "utf8");
  const reviewShellSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace-shell.tsx"), "utf8");
  const settingsShellSource = await readFile(path.join(APP_ROOT, "features/settings/settings-workspace.tsx"), "utf8");
  const shellStyles = await readFile(path.join(APP_ROOT, "styles/shell.css"), "utf8");
  const baseStyles = await readFile(path.join(APP_ROOT, "styles/base.css"), "utf8");
  const uiStyles = await readFile(path.join(APP_ROOT, "styles/ui.css"), "utf8");
  const tokensStyles = await readFile(path.join(APP_ROOT, "styles/tokens.css"), "utf8");
  const appearanceSource = await readFile(path.join(APP_ROOT, "services/appearance-settings-repository.ts"), "utf8");
  const layoutSource = await readFile(path.join(APP_ROOT, "layout.tsx"), "utf8");
  const fenbiStyles = await readFile(path.join(APP_ROOT, "features/import/fenbi-quick-import-panel.module.css"), "utf8");

  assert.match(shellSource, /contentSurface = "raised-surface"/);
  assert.match(shellSource, /contentSurface\?: "plain" \| "raised-surface"/);
  assert.match(shellSource, /className="chrome-content-frame"/);
  assert.match(shellSource, /data-workspace-frame="true"/);
  assert.match(shellSource, /data-content-surface=\{contentSurface\}/);
  assert.match(shellSource, /data-sidebar=\{sidebarCollapsed \? "collapsed" : "expanded"\}/);
  assert.doesNotMatch(shellSource, /integrationMode|data-integration-mode/);
  assert.doesNotMatch(shellSource, /chrome-topbar[^"]*border-b/);
  assert.doesNotMatch(shellSource, /chrome-sidebar[^"]*border-r/);
  assert.match(reviewShellSource, /contentSurface="raised-surface"/);
  assert.doesNotMatch(settingsShellSource, /contentSurface="plain"/);
  assert.match(shellStyles, /\.chrome-content-frame\[data-content-surface="raised-surface"\]/);
  assert.match(shellStyles, /--chrome-workspace-top-inset:\s*12px/);
  assert.match(shellStyles, /\.chrome-shell \.chrome-content-frame\s*\{[\s\S]*?height: 100%;[\s\S]*?margin-top: 0;/);
  assert.match(shellStyles, /\.chrome-topbar\s*\{[\s\S]*?app-region: drag;/);
  assert.match(shellStyles, /\.chrome-topbar button,[\s\S]*?app-region: no-drag;/);
  assert.match(shellStyles, /\.chrome-shell::before\s*\{[\s\S]*?background-color: var\(--chrome-sidebar-bg\);[\s\S]*?background-image: var\(--chrome-sidebar-diffuse\);/);
  assert.match(shellStyles, /is-sidebar-expanded \.chrome-content-frame\[data-content-surface="raised-surface"\][\s\S]*?overflow: hidden;[\s\S]*?border-top-left-radius: var\(--ui-radius-workspace-shoulder\);[\s\S]*?border-top: 1px solid var\(--chrome-workspace-frame-edge\);[\s\S]*?border-left: 1px solid var\(--chrome-workspace-frame-edge\);[\s\S]*?box-shadow: var\(--chrome-workspace-frame-shadow\);/);
  assert.match(shellStyles, /is-sidebar-expanded \.chrome-sidebar-boundary\s*\{\s*background: transparent;/);
  assert.match(shellStyles, /is-sidebar-expanded \.chrome-content-frame\[data-content-surface="raised-surface"\][\s\S]*?border-top: 1px solid var\(--chrome-workspace-frame-edge\);[\s\S]*?border-left: 1px solid var\(--chrome-workspace-frame-edge\);/);
  assert.match(shellStyles, /is-sidebar-collapsed \.chrome-content-frame\[data-content-surface="raised-surface"\][\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(shellStyles, /content-frame\[data-content-surface="raised-surface"\]::after/);
  assert.match(shellStyles, /\.chrome-topbar\s*\{[\s\S]*?background-image: var\(--chrome-topbar-diffuse\);/);
  assert.match(shellStyles, /body\[data-diffuse-gradient="true"\] \.chrome-topbar\s*\{[\s\S]*?transparent calc\(100% - 12px\),[\s\S]*?var\(--chrome-topbar-bg\) 100%[\s\S]*?var\(--chrome-topbar-diffuse\);/);
  assert.match(shellStyles, /\.diffuse-sidebar::before\s*\{[\s\S]*?mask-image: linear-gradient\(180deg, transparent 0, #000 12px\);/);
  assert.doesNotMatch(shellStyles, /content-frame\[data-content-surface="raised-surface"\]::before/);
  assert.match(shellStyles, /\.chrome-topbar\s*\{[\s\S]*?border-bottom: 1px solid var\(--chrome-workspace-separator\);/);
  assert.match(shellStyles, /\.chrome-sidebar\s*\{[\s\S]*?border-right: 0;/);
  assert.match(shellStyles, /\.chrome-sidebar-boundary\s*\{[\s\S]*?width: var\(--chrome-sidebar-boundary-width\);[\s\S]*?background: var\(--chrome-sidebar-divider\);/);
  assert.match(shellSource, /className="chrome-sidebar-boundary" data-sidebar-boundary="true"/);
  assert.match(shellStyles, /grid-template-columns: var\(--chrome-sidebar-width\) var\(--chrome-sidebar-boundary-width\) minmax\(0, 1fr\)/);
  assert.doesNotMatch(shellStyles, /-1px -1px 3px -1px/);
  assert.doesNotMatch(shellStyles, /left 0 top 18px|left 18px top 0/);
  assert.match(shellStyles, /\.chrome-content\s*\{[\s\S]*?-ms-overflow-style: none;[\s\S]*?scrollbar-width: none;/);
  assert.match(shellStyles, /\.chrome-content::\-webkit-scrollbar\s*\{[\s\S]*?display: none;/);
  assert.match(shellStyles, /\.chrome-layout\s*\{[\s\S]*?background-color: var\(--chrome-window-bg\);[\s\S]*?background-image: none;/);
  assert.match(shellStyles, /\.chrome-content-frame\s*\{[\s\S]*?background: var\(--chrome-workspace-surface\);/);
  assert.match(shellStyles, /\.workspace-sidebar-shell\s*\{[\s\S]*?flex-direction: column;[\s\S]*?padding:/);
  assert.match(shellStyles, /\.workspace-sidebar-scroll\s*\{[\s\S]*?overflow-y: auto;/);
  assert.match(shellStyles, /\.workspace-sidebar-footer\s*\{[\s\S]*?border-top: 1px solid var\(--chrome-sidebar-footer-separator\);/);
  assert.match(shellStyles, /body\[data-diffuse-gradient="true"\] \.chrome-content-frame\[data-content-surface\]\s*\{[\s\S]*?background-image: var\(--chrome-window-diffuse\);/);
  assert.match(shellStyles, /body\[data-diffuse-gradient="true"\] \.chrome-layout \.chrome-content-frame\[data-content-surface\] > \.chrome-content\s*\{[\s\S]*?background-color: transparent;/);
  assert.match(tokensStyles, /--chrome-topbar-diffuse: none;/);
  for (const token of ["--chrome-sidebar-divider", "--chrome-workspace-separator", "--chrome-card-outline", "--chrome-composer-outline", "--chrome-composer-focus-outline", "--chrome-composer-focus-shadow", "--chrome-popover-outline", "--chrome-workspace-edge", "--chrome-workspace-shadow", "--chrome-workspace-frame-edge", "--chrome-workspace-frame-surface", "--chrome-workspace-frame-shadow", "--chrome-thread-surface", "--chrome-conversation-surface", "--chrome-thread-separator", "--chrome-content-separator-strong", "--chrome-content-separator-soft", "--chrome-composer-shadow", "--chrome-context-popover-surface", "--chrome-context-popover-outline", "--chrome-topic-rail-inactive", "--content-width-narrow", "--content-width-medium", "--content-width-wide", "--conversation-content-max-width", "--ui-radius-workspace-shoulder"]) {
    assert.match(tokensStyles, new RegExp(`${token}:`));
  }
  assert.match(appearanceSource, /setProperty\("--chrome-sidebar-width", "248px"\)/);
  assert.match(appearanceSource, /setProperty\("--chrome-sidebar-boundary-width", "1px"\)/);
  assert.match(appearanceSource, /dataset\.appearanceContrast/);
  assert.doesNotMatch(appearanceSource, /contrast[\s\S]{0,120}setProperty\("--chrome-sidebar-width"/);
  assert.match(appearanceSource, /setProperty\("--chrome-topbar-diffuse", topbarDiffuseBackground\)/);
  assert.match(appearanceSource, /setProperty\("--chrome-workspace-edge",/);
  assert.match(appearanceSource, /setProperty\("--chrome-workspace-frame-edge",/);
  assert.match(appearanceSource, /setProperty\("--chrome-workspace-frame-surface",/);
  assert.match(appearanceSource, /setProperty\("--chrome-workspace-frame-shadow",/);
  assert.match(appearanceSource, /setProperty\("--chrome-composer-focus-outline",/);
  assert.match(appearanceSource, /setProperty\("--chrome-composer-focus-shadow",/);
  assert.match(appearanceSource, /setProperty\("--chrome-thread-surface", threadSurface\)/);
  assert.match(appearanceSource, /setProperty\("--chrome-context-popover-surface", contextPopoverSurface\)/);
  assert.match(layoutSource, /import \{ GeistMono \} from "geist\/font\/mono"/);
  assert.match(layoutSource, /\$\{GeistMono\.variable\}/);
  assert.match(fenbiStyles, /font-family: var\(--app-code-font\)/);
  assert.doesNotMatch(fenbiStyles, /font[^;]*ui-monospace/);
  assert.match(baseStyles, /input\.font-mono,[\s\S]*?font-family: var\(--app-code-font\);/);
  assert.match(shellStyles, /@media \(min-width: 1025px\)[\s\S]*?\.chrome-layout\.is-sidebar-expanded \.chrome-sidebar[\s\S]*?border-right-width: 0;/);
  assert.match(shellStyles, /\.chrome-layout\[data-mobile-sidebar\][\s\S]*?> \.chrome-content[\s\S]*?box-shadow: none !important;/);
  assert.match(shellStyles, /\.chrome-layout\[data-mobile-sidebar\] \.chrome-content-frame,[\s\S]*?\.chrome-content-frame > \.chrome-content\s*\{\s+height: 100%;/);
  assert.doesNotMatch(shellStyles, /padding-left: 18px;/);
  assert.match(uiStyles, /\.conversation-workspace\s*\{[\s\S]*?height: 100%;/);
  assert.doesNotMatch(uiStyles, /\.conversation-workspace\s*\{[\s\S]*?height: calc\(100dvh - var\(--chrome-topbar-height\)\)/);
  assert.doesNotMatch(shellStyles, /\.conversation-shell-content\s*\{[\s\S]*?(?:margin-left|border-top-left-radius|box-shadow)/);
});

test("应用与设置侧栏共享固定头部、独立列表滚动和固定页脚", async () => {
  const appSidebar = await readFile(path.join(APP_ROOT, "features/review/review-workspace-app-sidebar.tsx"), "utf8");
  const settingsSidebar = await readFile(path.join(APP_ROOT, "features/settings/settings-workspace-navigation.tsx"), "utf8");
  const router = await readFile(path.join(APP_ROOT, "features/review/review-workspace-view-router.tsx"), "utf8");
  assert.match(appSidebar, /workspace-sidebar-shell app-sidebar-shell/);
  assert.match(appSidebar, /workspace-sidebar-header/);
  assert.match(appSidebar, /workspace-sidebar-primary-nav/);
  assert.match(appSidebar, /workspace-sidebar-scroll/);
  assert.match(appSidebar, /workspace-sidebar-footer/);
  assert.match(settingsSidebar, /workspace-sidebar-shell settings-sidebar-shell/);
  assert.match(settingsSidebar, /data-sidebar-scroll-region="true"/);
  assert.match(settingsSidebar, /workspace-sidebar-footer/);
  assert.match(router, /<SettingsWorkspaceSidebar[\s\S]*footer=\{reviewControls\}/);
  assert.doesNotMatch(appSidebar, /label: "插件与技能"/);
  assert.match(appSidebar, /label: "插件"/);
  assert.match(settingsSidebar, /label: "插件"/);
});

test("新对话导航不会把 React 点击事件误传为启动上下文", async () => {
  const source = await readFile(path.join(APP_ROOT, "features/review/review-workspace-app-sidebar.tsx"), "utf8");
  assert.match(source, /onClick:\s*\(\)\s*=>\s*onStartNewConversation\(\)/);
  assert.doesNotMatch(source, /onClick:\s*onStartNewConversation/);
});

test("公考学习链路拆分为经过节点中心的四段桌面路径", async () => {
  const flowSource = await readFile(path.join(APP_ROOT, "features/review/dashboard-study-flow.tsx"), "utf8");

  assert.match(flowSource, /data-flow-segment="top" d="M125 40 H875"/);
  assert.match(flowSource, /data-flow-segment="bend" d="M875 40 C950 40 958 190 875 190"/);
  assert.match(flowSource, /data-flow-segment="return" d="M875 190 H125"/);
  assert.match(flowSource, /data-flow-segment="tail" d="M125 190 C70 190 70 250 110 250"/);
  assert.match(flowSource, /dashboard-flow-gradient-return/);
  assert.match(flowSource, /data-flow-node=\{index \+ 1\}/);
});

test("低频功能不通过静态依赖回到主工作台", async () => {
  const source = await readFile(path.join(APP_ROOT, "features/review/review-workspace.tsx"), "utf8");
  const imports = staticImports(source);
  for (const forbidden of ["../automation/automation-view", "../import/import-workspace", "../interview/interview-workspace", "../settings/settings-workspace", "../tutoring/tutoring-workspace"]) {
    assert.ok(!imports.includes(forbidden), `检测到低频模块静态依赖：${forbidden}`);
  }
});

test("应用源码不存在相对静态 import 循环", async () => {
  const files = await sourceFiles(APP_ROOT);
  const normalized = new Set(files.map(path.normalize));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const edges = staticImports(source).filter((specifier) => specifier.startsWith(".")).flatMap((specifier) => {
      const base = path.resolve(path.dirname(file), specifier);
      return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].filter((candidate) => normalized.has(path.normalize(candidate))).slice(0, 1);
    });
    graph.set(path.normalize(file), edges.map(path.normalize));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(file: string, trail: string[]) {
    if (visiting.has(file)) assert.fail(`检测到循环依赖：${[...trail, file].map((item) => path.relative(APP_ROOT, item)).join(" -> ")}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const edge of graph.get(file) ?? []) visit(edge, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
});
