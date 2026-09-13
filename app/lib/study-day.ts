/** 日期字符串是民用日；时间戳和 Date 则按运行时本地时区解释。 */
export function studyDay(value: string | Date | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") {
    const civil = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(value);
    if (civil) {
      const [, year, month, day] = civil;
      const check = new Date(0);
      check.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
      if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return null;
      if (value.length === 10) return value;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function requireStudyDay(value: string | Date): string {
  const day = studyDay(value);
  if (day === null) throw new RangeError("Invalid study day");
  return day;
}

/** 只在日历坐标上加天数；UTC 在此用于计算民用日，不用于解释用户时间戳。 */
export function addStudyDays(day: string, amount: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || studyDay(day) === null || !Number.isInteger(amount)) throw new RangeError("Invalid calendar addition");
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 0 || year > 9999) throw new RangeError("Invalid calendar addition");
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isStudyDayDue(value: string | undefined, today: string | Date): boolean {
  const due = studyDay(value);
  const current = studyDay(today);
  return due !== null && current !== null && due <= current;
}

export function millisecondsUntilNextStudyDay(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}
