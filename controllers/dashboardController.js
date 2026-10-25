import Employee from "../models/Employee.js";
import Settings from "../models/Settings.js";
import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import Attendance from "../models/Attendance.js";
import Payroll from "../models/Payroll.js";
import AuditLog from "../models/AuditLog.js";
import { toDateOnly, getHolidaySet } from "../utils/workingDays.js";
import {
  buildAttendanceStats,
  computeHeadcountAndAttrition,
  groupHeadcountByDepartment,
  computeAvgTenureYears,
  computeLeaveUtilization,
  computePayrollCost,
} from "../utils/dashboardHelpers.js";

// Defaults to month-to-date when no range is given, same as attendanceController.getMyAttendance.
function parseDateRange(query) {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = query.from ? toDateOnly(query.from) : toDateOnly(defaultFrom);
  const to = query.to ? toDateOnly(query.to) : toDateOnly(now);
  return { from, to };
}

/* --------------------------------- Admin --------------------------------- */

// GET /api/dashboard/admin?from=&to=&department= — Admin only
// KPIs: headcount, attrition YTD, payroll cost, avg salary · headcount by
// dept · payroll cost by dept · tenure · audit feed (brief Section 7).
export async function getAdminDashboard(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { department } = req.query;

  // All employees (not just active) so attrition/exits in the period are counted correctly.
  const allEmployees = await Employee.find(department ? { department } : {});

  const { headcount, exits, attritionRate } = computeHeadcountAndAttrition(allEmployees, from, to);
  const headcountByDepartment = groupHeadcountByDepartment(allEmployees);
  const payroll = await computePayrollCost(allEmployees, from, to);
  const avgTenureYears = computeAvgTenureYears(allEmployees);

  const auditFeed = await AuditLog.find({}).sort({ createdAt: -1 }).limit(10);

  res.json({
    range: { from, to },
    kpis: {
      headcount,
      exitsInPeriod: exits,
      attritionRateYTD: attritionRate,
      payrollCost: payroll.totals.netPay,
      avgSalary: payroll.avgGrossSalary,
    },
    headcountByDepartment,
    payrollCostByDepartment: payroll.byDepartment,
    avgSalaryByDepartment: payroll.avgSalaryByDept,
    avgTenureYears,
    auditFeed,
  });
}

/* ---------------------------------- HR ---------------------------------- */

// GET /api/dashboard/hr?from=&to=&department= — Admin (view), HR
// KPIs: headcount, present, on leave, late today, pending approvals ·
// attendance trend · absenteeism by dept · leave by type · top 5 late-comers.
export async function getHrDashboard(req, res) {
  const { from, to } = parseDateRange(req.query);
  const { department } = req.query;

  const employees = await Employee.find({ status: "active", ...(department ? { department } : {}) });
  const settings = await Settings.getSingleton();
  const holidaySet = await getHolidaySet(from, to);

  const stats = await buildAttendanceStats(employees, from, to, settings, holidaySet);

  const today = toDateOnly(new Date());
  const todayHolidaySet = await getHolidaySet(today, today);
  const todayStats = await buildAttendanceStats(employees, today, today, settings, todayHolidaySet);

  const [pendingLeave, pendingCorrections] = await Promise.all([
    Leave.countDocuments({ status: "pending" }),
    Attendance.countDocuments({ "correction.status": "pending" }),
  ]);

  const leaveByType = await computeLeaveUtilization(employees, from, to);

  const absenteeismByDepartment = Object.fromEntries(
    Object.entries(stats.byDepartment).map(([dept, d]) => [
      dept,
      d.workingDayRecords > 0 ? Math.round((d.absent / d.workingDayRecords) * 10000) / 100 : 0,
    ])
  );

  res.json({
    range: { from, to },
    kpis: {
      headcount: employees.length,
      presentToday: todayStats.totals.present + todayStats.totals.late,
      onLeaveToday: todayStats.totals.onLeave,
      lateToday: todayStats.totals.late,
      pendingApprovals: pendingLeave + pendingCorrections,
    },
    attendanceRate: stats.attendanceRate,
    latePct: stats.latePct,
    absenteeismByDepartment,
    leaveByType,
    topLateComers: stats.topLateComers,
  });
}

/* ------------------------------- Employee ------------------------------- */

// GET /api/dashboard/employee — Employee only, own data.
// Check-in widget · hours this week vs 40h · late count · leave balance ·
// last payslip (brief Section 7). Announcements land here once M9 Comms ships.
export async function getEmployeeDashboard(req, res) {
  const employee = await Employee.findOne({ user: req.user._id });
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const now = new Date();

  // This (Mon-Sun) week's worked hours vs. the 40h target.
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = toDateOnly(new Date(now.getTime() - mondayOffset * 86400000));
  const weekEnd = toDateOnly(now);

  const weekRecords = await Attendance.find({ employee: employee._id, date: { $gte: weekStart, $lte: weekEnd } });
  const hoursThisWeek = Math.round(weekRecords.reduce((sum, r) => sum + (r.workedHours || 0), 0) * 100) / 100;

  // Late count this month.
  const monthStart = toDateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const lateCountThisMonth = await Attendance.countDocuments({
    employee: employee._id,
    date: { $gte: monthStart, $lte: toDateOnly(now) },
    status: "late",
  });

  // Today's check-in widget.
  const today = toDateOnly(now);
  const todayRecord = await Attendance.findOne({ employee: employee._id, date: today });

  // Leave balance — same rule as leaveController.getBalance.
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const leaveTypes = await LeaveType.find({ isActive: true });
  const approvedLeaves = await Leave.find({
    employee: employee._id,
    status: "approved",
    startDate: { $gte: yearStart, $lte: yearEnd },
  });
  const leaveBalance = leaveTypes.map((lt) => {
    const used = approvedLeaves.filter((l) => l.leaveType === lt.name).reduce((sum, l) => sum + l.days, 0);
    return {
      leaveType: lt.name,
      quota: lt.yearlyQuota,
      used,
      remaining: lt.yearlyQuota === null ? null : lt.yearlyQuota - used,
    };
  });

  const lastPayslip = await Payroll.findOne({ employee: employee._id, status: "finalized" }).sort({
    year: -1,
    month: -1,
  });

  res.json({
    checkInToday: {
      checkedIn: !!todayRecord?.checkIn?.time,
      checkedOut: !!todayRecord?.checkOut?.time,
      checkInTime: todayRecord?.checkIn?.time || null,
      status: todayRecord?.status || null,
    },
    hoursThisWeek,
    weeklyTarget: 40,
    lateCountThisMonth,
    leaveBalance,
    lastPayslip: lastPayslip
      ? { id: lastPayslip._id, month: lastPayslip.month, year: lastPayslip.year, netPay: lastPayslip.netPay }
      : null,
  });
}