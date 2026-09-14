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

test("优先项文案区分所选范围与全部历史，错因证据不冒充当前事实", () => {
  assert.match(source, /本范围完成 \$\{item\.metrics\.attemptCount\} 次/);
  assert.match(source, /本范围暂无/);
  assert.match(source, /全部历史最近结果：/);
  assert.doesNotMatch(source, /`最近结果：/);
  assert.doesNotMatch(source, /当前薄弱与错因/);
  assert.match(source, /薄弱信号反映当前派生状态；错因证据可能来自近期历史失败，不证明同一错误此刻仍在发生/);
});
