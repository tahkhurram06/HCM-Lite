import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import Settings from "../models/Settings.js";
import { toDateOnly, countWorkingDays, getHolidaySet, isWeekend, isHoliday } from "./workingDays.js";

// Illustrative annual tax slab from the brief, applied to grossMonthly * 12:
// 0–600k: 0% | 600k–1.2M: 5% | 1.2M–2.4M: 30k + 15% | 2.4M–3.6M: 210k + 25% | 3.6M+: 510k + 35%
export function computeAnnualTax(annualGross) {
  if (annualGross <= 600000) return 0;
  if (annualGross <= 1200000) return (annualGross - 600000) * 0.05;
  if (annualGross <= 2400000) return 30000 + (annualGross - 1200000) * 0.15;
  if (annualGross <= 3600000) return 210000 + (annualGross - 2400000) * 0.25;
  return 510000 + (annualGross - 3600000) * 0.35;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Computes one employee's payroll for a given calendar month/year.
// Returns a plain object matching the Payroll schema's calculated fields.
export async function computeEmployeePayroll(employee, month, year) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0)); // last calendar day of the month

  const settings = await Settings.getSingleton();
  const holidaySet = await getHolidaySet(monthStart, monthEnd);

  // Full month's working days — this is the divisor for the per-day rate,
  // per the brief ("Per day = gross ÷ working days").
  const workingDaysInMonth = await countWorkingDays(monthStart, monthEnd, settings);

  // Employment window within this month — handles joiners/leavers (brief: "Prorate joiners/leavers").
  const joinDate = toDateOnly(employee.dateOfJoining);
  const leaveDate = employee.dateOfLeaving ? toDateOnly(employee.dateOfLeaving) : null;
  const employmentStart = joinDate > monthStart ? joinDate : monthStart;
  const employmentEnd = leaveDate && leaveDate < monthEnd ? leaveDate : monthEnd;

  let employmentWorkingDays = 0;
  if (employmentStart <= employmentEnd) {
    employmentWorkingDays = await countWorkingDays(employmentStart, employmentEnd, settings);
  }

  // Salary structure: Gross = 1.5 x basic (HRA 40% + medical 10% of basic).
  const basic = employee.salary.basic;
  const hra = round2(basic * 0.4);
  const medical = round2(basic * 0.1);
  const grossMonthly = round2(basic + hra + medical);
  const perDayRate = workingDaysInMonth > 0 ? grossMonthly / workingDaysInMonth : 0;

  if (employmentWorkingDays === 0) {
    // Not employed on any working day this month (e.g. left before it started).
    const annualGrossForTax = round2(grossMonthly * 12);
    return {
      basic, hra, medical, grossMonthly,
      workingDaysInMonth, employmentWorkingDays: 0,
      absentDays: 0, unpaidLeaveDays: 0, halfDays: 0,
      deductionDays: 0, payableDays: 0, perDayRate: round2(perDayRate),
      earnedGross: 0, annualGrossForTax, tax: 0, netPay: 0,
    };
  }

  // Attendance records within the employment window this month.
  const records = await Attendance.find({
    employee: employee._id,
    date: { $gte: employmentStart, $lte: employmentEnd },
  });
  const byDate = new Map(records.map((r) => [toDateOnly(r.date).toISOString().slice(0, 10), r]));

  // Approved leave touching the employment window this month.
  const approvedLeaves = await Leave.find({
    employee: employee._id,
    status: "approved",
    startDate: { $lte: employmentEnd },
    endDate: { $gte: employmentStart },
  });

  // Unpaid leave days (deducted at full day) — only the portion inside this month's window.
  let unpaidLeaveDays = 0;
  for (const lv of approvedLeaves.filter((l) => l.leaveType === "unpaid")) {
    const s = lv.startDate > employmentStart ? lv.startDate : employmentStart;
    const e = lv.endDate < employmentEnd ? lv.endDate : employmentEnd;
    if (s <= e) unpaidLeaveDays += await countWorkingDays(s, e, settings);
  }

  // Walk every working day in the employment window: half-day or unmarked-absent.
  // Paid leave types (annual/sick/casual) cost nothing extra — they're already
  // covered by the base pay, same as a normal present day.
  let absentDays = 0;
  let halfDays = 0;
  const cursor = new Date(employmentStart);
  while (cursor <= employmentEnd) {
    if (!isWeekend(cursor, settings.weekendDays) && !isHoliday(cursor, holidaySet)) {
      const key = toDateOnly(cursor).toISOString().slice(0, 10);
      const record = byDate.get(key);
      const onApprovedLeave = approvedLeaves.some(
        (lv) => toDateOnly(lv.startDate) <= cursor && toDateOnly(lv.endDate) >= cursor
      );
      if (record?.status === "half_day") {
        halfDays += 1;
      } else if (!record && !onApprovedLeave) {
        absentDays += 1;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const deductionDays = round2(absentDays + unpaidLeaveDays + 0.5 * halfDays);
  const payableDays = Math.max(0, round2(employmentWorkingDays - deductionDays));
  const earnedGross = round2(perDayRate * payableDays);

  // Tax bracket is based on the full (non-prorated) monthly gross annualized —
  // so a few unpaid days this month don't swing someone into a lower bracket.
  const annualGrossForTax = round2(grossMonthly * 12);
  const monthlyTax = round2(computeAnnualTax(annualGrossForTax) / 12);

  const netPay = round2(earnedGross - monthlyTax);

  return {
    basic, hra, medical, grossMonthly,
    workingDaysInMonth, employmentWorkingDays,
    absentDays, unpaidLeaveDays, halfDays,
    deductionDays, payableDays, perDayRate: round2(perDayRate),
    earnedGross, annualGrossForTax, tax: monthlyTax, netPay,
  };
}