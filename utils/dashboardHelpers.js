import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import Payroll from "../models/Payroll.js";
import { toDateOnly, isWeekend, isHoliday } from "./workingDays.js";

/* ------------------------------ Headcount ------------------------------ */

// "Headcount" = active on the end date of the range. "Attrition" = exits in
// the period ÷ average headcount × 100 (brief Section 7). The brief also
// mentions "probation" status, which this schema doesn't model — active is
// used as the closest equivalent.
export function computeHeadcountAndAttrition(employees, from, to) {
  const isActiveOn = (e, date) =>
    toDateOnly(e.dateOfJoining) <= date && (!e.dateOfLeaving || toDateOnly(e.dateOfLeaving) >= date);

  const headcount = employees.filter((e) => isActiveOn(e, to)).length;
  const headcountAtFrom = employees.filter((e) => isActiveOn(e, from)).length;
  const exits = employees.filter(
    (e) => e.dateOfLeaving && toDateOnly(e.dateOfLeaving) >= from && toDateOnly(e.dateOfLeaving) <= to
  ).length;

  const avgHeadcount = (headcountAtFrom + headcount) / 2;
  const attritionRate = avgHeadcount > 0 ? Math.round((exits / avgHeadcount) * 10000) / 100 : 0;

  return { headcount, exits, avgHeadcount, attritionRate };
}

export function groupHeadcountByDepartment(employees) {
  const out = {};
  for (const e of employees.filter((e) => e.status === "active")) {
    out[e.department] = (out[e.department] || 0) + 1;
  }
  return out;
}

export function computeAvgTenureYears(employees) {
  const now = new Date();
  const active = employees.filter((e) => e.status === "active");
  if (!active.length) return 0;
  const totalYears = active.reduce((sum, e) => {
    const end = e.dateOfLeaving || now;
    return sum + (end - e.dateOfJoining) / (1000 * 60 * 60 * 24 * 365.25);
  }, 0);
  return Math.round((totalYears / active.length) * 100) / 100;
}

/* ---------------------------- Attendance stats ---------------------------- */

// Walks every working day in [start, end] for the given employees and
// classifies each one (present/late/half_day/absent/on_leave/missing_checkout),
// the same rules used by attendanceController's board/calendar views — so
// the dashboard numbers always agree with what HR sees on the daily board.
// Fetches all records up front, then classifies in memory (no per-day queries).
export async function buildAttendanceStats(employees, start, end, settings, holidaySet) {
  const employeeIds = employees.map((e) => e._id);
  const empById = new Map(employees.map((e) => [String(e._id), e]));

  const records = await Attendance.find({ employee: { $in: employeeIds }, date: { $gte: start, $lte: end } });
  const byEmpDate = new Map(
    records.map((r) => [`${r.employee}_${toDateOnly(r.date).toISOString().slice(0, 10)}`, r])
  );

  const leaves = await Leave.find({
    employee: { $in: employeeIds },
    status: "approved",
    startDate: { $lte: end },
    endDate: { $gte: start },
  });

  const now = new Date();
  const todayOnly = toDateOnly(now);

  const totals = { present: 0, late: 0, missingCheckout: 0, halfDay: 0, absent: 0, onLeave: 0, workingDayRecords: 0 };
  const byDepartment = {};
  const lateCountByEmployee = new Map();

  const cursor = new Date(start);
  while (cursor <= end) {
    const working = !isWeekend(cursor, settings.weekendDays) && !isHoliday(cursor, holidaySet);
    if (working) {
      const dateKey = toDateOnly(cursor).toISOString().slice(0, 10);

      for (const emp of employees) {
        const dept = emp.department;
        if (!byDepartment[dept]) {
          byDepartment[dept] = { present: 0, late: 0, absent: 0, halfDay: 0, onLeave: 0, workingDayRecords: 0 };
        }

        const record = byEmpDate.get(`${emp._id}_${dateKey}`);
        const onLeave = leaves.some(
          (lv) =>
            String(lv.employee) === String(emp._id) &&
            toDateOnly(lv.startDate) <= cursor &&
            toDateOnly(lv.endDate) >= cursor
        );

        let status;
        if (onLeave && !record) status = "on_leave";
        else if (!record) status = cursor < todayOnly ? "absent" : "upcoming";
        else if (record.checkIn?.time && !record.checkOut?.time) {
          status = cursor < todayOnly ? "missing_checkout" : record.status;
        } else status = record.status;

        if (status === "upcoming") continue; // don't count days that haven't happened yet

        totals.workingDayRecords += 1;
        byDepartment[dept].workingDayRecords += 1;

        if (status === "on_leave") {
          totals.onLeave += 1;
          byDepartment[dept].onLeave += 1;
        } else if (status === "present" || status === "checked_in") {
          totals.present += 1;
          byDepartment[dept].present += 1;
        } else if (status === "late") {
          totals.late += 1;
          byDepartment[dept].late += 1;
          const key = String(emp._id);
          lateCountByEmployee.set(key, (lateCountByEmployee.get(key) || 0) + 1);
        } else if (status === "missing_checkout") {
          totals.missingCheckout += 1;
        } else if (status === "half_day") {
          totals.halfDay += 1;
          byDepartment[dept].halfDay += 1;
        } else if (status === "absent") {
          totals.absent += 1;
          byDepartment[dept].absent += 1;
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Attendance rate = (present + late + missing_checkout + 0.5*half_day) / (working-day records - on_leave)
  const denom = totals.workingDayRecords - totals.onLeave;
  const attendanceRate =
    denom > 0
      ? Math.round(
          ((totals.present + totals.late + totals.missingCheckout + 0.5 * totals.halfDay) / denom) * 10000
        ) / 100
      : null;

  const latePct =
    totals.present + totals.late > 0 ? Math.round((totals.late / (totals.present + totals.late)) * 10000) / 100 : 0;
  const absenteeismPct = denom > 0 ? Math.round((totals.absent / denom) * 10000) / 100 : 0;

  const topLateComers = [...lateCountByEmployee.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => {
      const emp = empById.get(id);
      return { employeeId: id, code: emp?.code, name: emp?.name, department: emp?.department, lateCount: count };
    });

  return { totals, attendanceRate, latePct, absenteeismPct, byDepartment, topLateComers };
}

/* ------------------------------ Leave utilization ------------------------------ */

// Approved days ÷ quota, per leave type — and broken down by department so
// HR can spot a department burning through casual leave, say.
export async function computeLeaveUtilization(employees, from, to) {
  const employeeIds = employees.map((e) => e._id);
  const empById = new Map(employees.map((e) => [String(e._id), e]));

  const leaveTypes = await LeaveType.find({ isActive: true });
  const approvedLeaves = await Leave.find({
    employee: { $in: employeeIds },
    status: "approved",
    startDate: { $lte: to },
    endDate: { $gte: from },
  });

  const byType = {};
  for (const lt of leaveTypes) {
    byType[lt.name] = { quota: lt.yearlyQuota, usedInPeriod: 0, byDepartment: {} };
  }
  for (const lv of approvedLeaves) {
    if (!byType[lv.leaveType]) continue;
    byType[lv.leaveType].usedInPeriod += lv.days;
    const dept = empById.get(String(lv.employee))?.department || "Unknown";
    byType[lv.leaveType].byDepartment[dept] = (byType[lv.leaveType].byDepartment[dept] || 0) + lv.days;
  }
  for (const t of Object.values(byType)) {
    t.utilizationPct = t.quota ? Math.round((t.usedInPeriod / t.quota) * 10000) / 100 : null; // null = unlimited type
  }
  return byType;
}

/* ------------------------------ Payroll cost ------------------------------ */

function monthYearInRange(month, year, from, to) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const fromMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const toMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return d >= fromMonth && d <= toMonth;
}

// Payroll cost comes from finalized Payroll runs within the period (so it's
// zero until payroll has actually been run — intentional, no numbers invented).
// Avg salary is computed separately from current Employee.salary.basic so it's
// meaningful even before the first payroll run.
export async function computePayrollCost(employees, from, to) {
  const employeeIds = employees.map((e) => e._id);
  const empById = new Map(employees.map((e) => [String(e._id), e]));

  const allRuns = await Payroll.find({ employee: { $in: employeeIds }, status: "finalized" });
  const runs = allRuns.filter((r) => monthYearInRange(r.month, r.year, from, to));

  const totals = { grossMonthly: 0, netPay: 0 };
  const byDepartment = {};
  for (const r of runs) {
    totals.grossMonthly += r.grossMonthly;
    totals.netPay += r.netPay;
    const dept = empById.get(String(r.employee))?.department || "Unknown";
    byDepartment[dept] = byDepartment[dept] || { grossMonthly: 0, netPay: 0 };
    byDepartment[dept].grossMonthly += r.grossMonthly;
    byDepartment[dept].netPay += r.netPay;
  }

  const active = employees.filter((e) => e.status === "active");
  const avgGrossSalary = active.length
    ? Math.round((active.reduce((s, e) => s + e.salary.basic * 1.5, 0) / active.length) * 100) / 100
    : 0;

  const deptSums = {};
  for (const e of active) {
    deptSums[e.department] = deptSums[e.department] || { sum: 0, count: 0 };
    deptSums[e.department].sum += e.salary.basic * 1.5;
    deptSums[e.department].count += 1;
  }
  const avgSalaryByDept = {};
  for (const [dept, { sum, count }] of Object.entries(deptSums)) {
    avgSalaryByDept[dept] = Math.round((sum / count) * 100) / 100;
  }

  return { totals, byDepartment, avgGrossSalary, avgSalaryByDept, runsCount: runs.length };
}