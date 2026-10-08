import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("F5 resume facade is fixed, readonly and does not initialize, issue, submit, schedule or cache", () => {
  const source = readFileSync("app/server/diagnostic/resume-view.ts", "utf8");
  const ast = ts.createSourceFile("resume-view.ts", source, ts.ScriptTarget.Latest, true);
  const facade = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
    && node.name?.text === "loadDiagnosticResumeView");
  assert.equal(facade?.parameters.length, 0);
  assert.match(facade!.body!.getText(ast), /new Date\(\)\.toISOString\(\)/);
  assert.match(facade!.body!.getText(ast), /reconstructDiagnosticLearnerState\(\{ specId: "int-add-2-3", specRevision: "r1", asOf \}\)/);
  assert.doesNotMatch(source, /node:|\b(?:fetch|process|window|document|localStorage|indexedDB|setTimeout|setInterval)\b|initializeDiagnosticRuntime|composeDiagnosticRuntime|issueDiagnostic|commitDiagnosticSubmission|\.initialize\(|appendCapturedAttempt|deriveLearnerTargetStates|decideNextVerification/);
  assert.equal(ast.statements.filter(ts.isImportDeclaration).length, 2);
});

test("F5 learner surfaces keep assistance out of the diagnostic and disable navigation prefetch", () => {
  const resume = readFileSync("app/diagnostic/resume/page.tsx", "utf8");
  const form = readFileSync("app/diagnostic/page.tsx", "utf8");
  const dashboard = readFileSync("app/features/review/review-dashboard-view.tsx", "utf8");
  assert.doesNotMatch(resume, /["']use client["']|source-owner|admission|learning-history|state-reconstruction|assessment-store|runtime|AiActivityPanel|Tutor|\.target\b|\.payload\b|verifiedCorrectOption/);
  assert.match(resume, /data-kind=\{view\.kind\} data-code=\{view\.code\}/);
  assert.match(resume, /view\.kind !== "complete"/);
  for (const source of [resume, form, dashboard]) {
    const ast = ts.createSourceFile("surface.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = 0;
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const href = node.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute)
          && attribute.name.getText(ast) === "href" && Boolean(attribute.initializer && ts.isStringLiteral(attribute.initializer)
            && attribute.initializer.text.startsWith("/diagnostic")));
        if (href) {
          found++;
          const prefetch = node.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute)
            && attribute.name.getText(ast) === "prefetch");
          assert.equal(prefetch?.initializer?.getText(ast), "{false}");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast); assert.ok(found > 0);
  }
});
