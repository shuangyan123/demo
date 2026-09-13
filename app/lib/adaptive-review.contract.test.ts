import assert from "node:assert/strict";
import test from "node:test";
import type { LearningEvent, LearningEventOutcome } from "../types/domains/learning-event.ts";
import { resolveAdaptiveReviewDecision } from "./adaptive-review.ts";

const today = new Date("2026-08-09T08:00:00.000Z");

function event(id: string, observedAt: string, outcome: LearningEventOutcome = "correct"): LearningEvent {
  return {
    id: `review_attempt:${id}`,
    sourceType: "review_attempt",
    sourceId: id,
    subjectType: "mistake",
    subjectId: "subject-1",
    outcome,
    observedAt,
    masteryAfter: 3,
  };
}

function decide(currentMastery: number, result: "correct" | "uncertain" | "wrong", priorEvents: readonly LearningEvent[] = [], reviewDate = today) {
  return resolveAdaptiveReviewDecision({ currentMastery, result, today: reviewDate, priorEvents });
}

test("first clean correct preserves the fixed baseline interval", () => {
  assert.deepEqual(decide(2, "correct"), {
    masteryAfter: 3,
    intervalDays: 6,
    nextReviewAt: "2026-08-15",
    recentCorrectStreak: 1,
    recentLapseDays: 0,
    sameDayRetry: false,
  });
});

test("spaced correct results grow on the second and third distinct study day", () => {
  assert.equal(decide(3, "correct", [event("previous", "2026-08-08")]).intervalDays, 10);
  assert.equal(decide(4, "correct", [event("older", "2026-08-07"), event("previous", "2026-08-08")]).intervalDays, 15);
  assert.equal(decide(3, "correct", [event("previous", "2026-08-08")]).recentCorrectStreak, 2);
  assert.equal(decide(4, "correct", [event("older", "2026-08-07"), event("previous", "2026-08-08")]).recentCorrectStreak, 3);
});

test("mastery transitions remain clamped to 1..5", () => {
  assert.equal(decide(5, "correct").masteryAfter, 5);
  assert.equal(decide(1, "wrong").masteryAfter, 1);
  assert.equal(decide(4, "uncertain").masteryAfter, 4);
});

test("uncertain is always one day and wrong is always today", () => {
  const history = [event("correct", "2026-08-08"), event("wrong", "2026-08-07", "wrong")];
  assert.deepEqual(decide(4, "uncertain", history).intervalDays, 1);
  assert.deepEqual(decide(4, "uncertain", history).nextReviewAt, "2026-08-10");
  assert.deepEqual(decide(4, "wrong", history).intervalDays, 0);
  assert.deepEqual(decide(4, "wrong", history).nextReviewAt, "2026-08-09");
});

test("same-day retry is conservative and duplicate same-day events cannot inflate spacing", () => {
  const oneSameDay = [event("same-day", "2026-08-09")];
  const duplicateSameDay = [event("same-day-a", "2026-08-09T09:00:00.000Z"), event("same-day-b", "2026-08-09T12:00:00.000Z")];
  const one = decide(3, "correct", oneSameDay);
  const duplicate = decide(3, "correct", duplicateSameDay);

  assert.equal(one.intervalDays, 1);
  assert.equal(one.sameDayRetry, true);
  assert.equal(one.recentCorrectStreak, 1);
  assert.equal(duplicate.intervalDays, 1);
  assert.equal(duplicate.sameDayRetry, true);
  assert.equal(duplicate.recentCorrectStreak, 1);
});

test("distinct-date history collapses each date to its weakest outcome", () => {
  const result = decide(2, "correct", [
    event("correct-day", "2026-08-08", "correct"),
    event("uncertain-day-correct", "2026-08-07", "correct"),
    event("uncertain-day", "2026-08-07", "uncertain"),
    event("wrong-day-correct", "2026-08-06", "correct"),
    event("wrong-day", "2026-08-06", "wrong"),
  ]);

  assert.equal(result.recentCorrectStreak, 2);
  assert.equal(result.recentLapseDays, 1);
  assert.equal(result.intervalDays, 7);
});

test("recent lapses shorten an otherwise equivalent clean success", () => {
  const clean = decide(3, "correct", [event("clean", "2026-08-08")]);
  const lapsed = decide(3, "correct", [event("clean", "2026-08-08"), event("lapse", "2026-08-07", "wrong")]);

  assert.equal(clean.intervalDays, 10);
  assert.equal(lapsed.intervalDays, 9);
  assert.ok(lapsed.intervalDays < clean.intervalDays);
  assert.equal(lapsed.recentLapseDays, 1);
});

test("only the latest eight distinct dates influence history and streak caps at five", () => {
  const dates = Array.from({ length: 8 }, (_, index) => `2026-08-${String(index + 2).padStart(2, "0")}`);
  const history = [event("old-lapse", "2026-08-01", "wrong"), ...dates.map((date, index) => event(`correct-${index}`, date))];
  const result = decide(2, "correct", history, new Date("2026-08-10T08:00:00.000Z"));

  assert.equal(result.recentLapseDays, 0);
  assert.equal(result.recentCorrectStreak, 5);
  assert.equal(result.intervalDays, 12);
  assert.ok(result.intervalDays >= 2 && result.intervalDays <= 30);
});

test("lapse penalty is capped at three days", () => {
  const result = decide(2, "correct", [
    event("lapse-1", "2026-08-08", "wrong"),
    event("lapse-2", "2026-08-07", "wrong"),
    event("lapse-3", "2026-08-06", "wrong"),
    event("lapse-4", "2026-08-05", "wrong"),
  ]);

  assert.equal(result.recentLapseDays, 3);
  assert.equal(result.intervalDays, 4);
});

test("the policy is deterministic", () => {
  const history = [event("a", "2026-08-08"), event("b", "2026-08-07", "uncertain")];
  assert.deepEqual(decide(3, "correct", history), decide(3, "correct", history));
});
