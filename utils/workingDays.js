import Holiday from "../models/Holiday.js";

// Normalize any Date to UTC midnight, so attendance/leave records and
// comparisons are always keyed on the calendar day, not a timestamp.
export function toDateOnly(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isWeekend(date, weekendDays) {
  return weekendDays.includes(new Date(date).getUTCDay());
}

// Fetch all holiday dates in [start, end] as a Set of "YYYY-MM-DD" strings
// for O(1) lookup while iterating a range.
export async function getHolidaySet(start, end) {
  const holidays = await Holiday.find({
    date: { $gte: toDateOnly(start), $lte: toDateOnly(end) },
  });
  return new Set(holidays.map((h) => toDateOnly(h.date).toISOString().slice(0, 10)));
}

export function isHoliday(date, holidaySet) {
  return holidaySet.has(toDateOnly(date).toISOString().slice(0, 10));
}

export async function isWorkingDay(date, settings, holidaySet) {
  if (isWeekend(date, settings.weekendDays)) return false;
  if (isHoliday(date, holidaySet)) return false;
  return true;
}

// Count working days (inclusive) between start and end — used by Payroll
// later for "gross ÷ working days" and here for range queries.
export async function countWorkingDays(start, end, settings) {
  const holidaySet = await getHolidaySet(start, end);
  let count = 0;
  const cursor = toDateOnly(start);
  const last = toDateOnly(end);
  while (cursor <= last) {
    if (!isWeekend(cursor, settings.weekendDays) && !isHoliday(cursor, holidaySet)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}