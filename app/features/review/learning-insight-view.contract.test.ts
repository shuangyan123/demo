import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./learning-insight-view.tsx", import.meta.url), "utf8");

test("薄弱分析不生成虚假样本或 mastery 百分比，并使用 canonical 掌握分", () => {
  assert.doesNotMatch(source, /Math\.max\(4\s*,\s*snapshot\.attemptsCount\s*-\s*index\s*\*\s*7/);
  assert.doesNotMatch(source, /snapshot\.attemptsCount\s*-\s*index\s*\*\s*7/);
  assert.doesNotMatch(source, /mastery\s*\*\s*20/);
  assert.match(source, /masteryLevelToScore\(item\.mastery\)/);
  assert.match(source, /item\.mastery}\/5/);
  assert.match(source, /暂无.*训练.*记录/);
});

test("薄弱分析只呈现 L4 薄弱/错因信号及真实证据引用数", () => {
  assert.match(source, /selectLearningInsightSignals\(learnerState\)/);
  assert.match(source, /证据 \{signal\.evidence\.length\} 条/);
  assert.doesNotMatch(source, /signal\.score/);
  assert.doesNotMatch(source, /学习效率提升|记忆率|掌握概率|遗忘概率|retention probability/i);
});
