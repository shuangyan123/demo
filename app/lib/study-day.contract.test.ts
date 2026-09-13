import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { addStudyDays, isStudyDayDue, studyDay, millisecondsUntilNextStudyDay } from "./study-day.ts";
import { watchStudyDay } from "./study-day-clock.ts";

test("equivalent offsets share a runtime-local day and date-only preserves civil meaning", () => {
  assert.equal(studyDay("2026-09-13T00:30:00+08:00"), studyDay("2026-09-12T16:30:00Z"));
  assert.equal(studyDay("2026-09-13"), "2026-09-13");
  for (const value of ["", "invalid", "2026-02-30", "2026-13-01", "2026-02-30T00:00:00Z", new Date(NaN)]) assert.equal(studyDay(value), null);
  const instant = "2026-09-13T00:00:00Z";
  assert.equal(isStudyDayDue(instant, new Date(instant)), isStudyDayDue(studyDay(instant)!, new Date(instant)));
  assert.equal(isStudyDayDue("invalid", new Date()), false);
  assert.throws(() => addStudyDays("2026-02-30", 1), RangeError);
});

test("calendar addition and local midnight survive DST in an explicit timezone", () => {
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { addStudyDays, studyDay, millisecondsUntilNextStudyDay } from ${JSON.stringify(new URL("./study-day.ts", import.meta.url).href)};
    console.log(JSON.stringify([addStudyDays("2026-03-08", 1), addStudyDays("2026-11-01", 1),
      millisecondsUntilNextStudyDay(new Date("2026-03-08T00:00:00")),
      millisecondsUntilNextStudyDay(new Date("2026-11-01T00:00:00")),
      studyDay("2026-09-13T00:30:00+08:00")]));
  `], { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), ["2026-03-09", "2026-11-02", 23 * 3600000, 25 * 3600000, "2026-09-12"]);
});

test("one midnight timer and focus/visibility correction update only on changed day and clean up", () => {
  let now = new Date(2026, 8, 12, 23, 59);
  let timer: (() => void) | undefined;
  let focus: (() => void) | undefined;
  let visible: (() => void) | undefined;
  let delay = 0;
  let activeTimers = 0;
  const changes: string[] = [];
  const stop = watchStudyDay(now, (date) => changes.push(studyDay(date)!), {
    now: () => now,
    schedule: (callback, ms) => { timer = callback; delay = ms; activeTimers++; return () => { activeTimers--; timer = undefined; }; },
    onFocus: (callback) => { focus = callback; return () => { focus = undefined; }; },
    onVisible: (callback) => { visible = callback; return () => { visible = undefined; }; },
  });
  assert.equal(delay, 60000);
  focus!();
  assert.deepEqual(changes, []);
  now = new Date(2026, 8, 13, 0, 0);
  timer!();
  assert.deepEqual(changes, ["2026-09-13"]);
  now = new Date(2026, 8, 15, 10, 0);
  focus!(); visible!();
  assert.deepEqual(changes, ["2026-09-13", "2026-09-15"]);
  assert.equal(activeTimers, 1);
  assert.equal(delay, millisecondsUntilNextStudyDay(now));
  stop();
  assert.equal(activeTimers, 0);
  assert.equal(timer, undefined); assert.equal(focus, undefined); assert.equal(visible, undefined);
});
