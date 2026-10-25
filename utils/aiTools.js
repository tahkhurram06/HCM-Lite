import Employee from "../models/Employee.js";
import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import Settings from "../models/Settings.js";
import { toDateOnly, getHolidaySet } from "./workingDays.js";
import { buildAttendanceStats, groupHeadcountByDepartment, computeLeaveUtilization, computePayrollCost } from "./dashboardHelpers.js";

// Every tool below reuses the exact same helper functions as the REST API
// (dashboardHelpers, workingDays) and the exact same models — so an AI
// answer can never drift from what the dashboards or other endpoints show.
// Role scoping is enforced HERE, not trusted to the model: an employee
// calling an HR-only tool gets a forbidden error, not company data.

function forbidden(message = "You don't have access to that.") {
  const err = new Error(message);
  err.isToolForbidden = true;
  return err;
}

function resolveRange(args) {
  const now = new Date();
  const from = args.from ? toDateOnly(args.from) : toDateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = args.to ? toDateOnly(args.to) : toDateOnly(now);
  return { from, to };
}

/* ---------------------------- Tool executors ---------------------------- */

async function getHeadcount(args, user) {
  if (!["admin", "hr"].includes(user.role)) throw forbidden();
  const filter = { status: "active", ...(args.department ? { department: args.department } : {}) };
  const employees = await Employee.find(filter);
  return { total: employees.length, byDepartment: groupHeadcountByDepartment(employees) };
}

async function getAttendanceSummary(args, user) {
  if (!["admin", "hr"].includes(user.role)) throw forbidden();
  const { from, to } = resolveRange(args);
  const settings = await Settings.getSingleton();
  const holidaySet = await getHolidaySet(from, to);
  const filter = { status: "active", ...(args.department ? { department: args.department } : {}) };
  const employees = await Employee.find(filter);
  const stats = await buildAttendanceStats(employees, from, to, settings, holidaySet);
  return {
    range: { from, to },
    attendanceRatePct: stats.attendanceRate,
    latePct: stats.latePct,
    absenteeismPct: stats.absenteeismPct,
    totals: stats.totals,
  };
}

async function getLateComers(args, user) {
  if (!["admin", "hr"].includes(user.role)) throw forbidden();
  const { from, to } = resolveRange(args);
  const settings = await Settings.getSingleton();
  const holidaySet = await getHolidaySet(from, to);
  const filter = { status: "active", ...(args.department ? { department: args.department } : {}) };
  const employees = await Employee.find(filter);
  const stats = await buildAttendanceStats(employees, from, to, settings, holidaySet);
  return { range: { from, to }, lateComers: stats.topLateComers.slice(0, args.limit || 5) };
}

async function getLeaveSummary(args, user) {
  if (!["admin", "hr"].includes(user.role)) throw forbidden();
  const { from, to } = resolveRange(args);
  const filter = { status: "active", ...(args.department ? { department: args.department } : {}) };
  const employees = await Employee.find(filter);
  const leaveByType = await computeLeaveUtilization(employees, from, to);
  return { range: { from, to }, leaveByType };
}

async function getMyLeaveBalance(args, user) {
  if (user.role !== "employee") throw forbidden("This tool only returns the caller's own balance.");
  const employee = await Employee.findOne({ user: user._id });
  if (!employee) throw forbidden("No employee record found for this account.");

  const year = args.year || new Date().getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const leaveTypes = await LeaveType.find({ isActive: true });
  const approved = await Leave.find({
    employee: employee._id,
    status: "approved",
    startDate: { $gte: yearStart, $lte: yearEnd },
  });
  const balance = leaveTypes.map((lt) => {
    const used = approved.filter((l) => l.leaveType === lt.name).reduce((s, l) => s + l.days, 0);
    return { leaveType: lt.name, quota: lt.yearlyQuota, used, remaining: lt.yearlyQuota === null ? null : lt.yearlyQuota - used };
  });
  return { year, balance };
}

async function getPayrollSummary(args, user) {
  if (!["admin", "hr"].includes(user.role)) throw forbidden();
  if (!args.month || !args.year) throw forbidden("month and year are required.");
  const filter = args.department ? { department: args.department } : {};
  const employees = await Employee.find(filter);
  const from = toDateOnly(new Date(Date.UTC(args.year, args.month - 1, 1)));
  const to = toDateOnly(new Date(Date.UTC(args.year, args.month, 0)));
  const payroll = await computePayrollCost(employees, from, to);
  // Aggregate only — this tool never returns any individual employee's salary.
  return {
    month: args.month,
    year: args.year,
    totalGross: payroll.totals.grossMonthly,
    totalNet: payroll.totals.netPay,
    byDepartment: payroll.byDepartment,
    avgSalary: payroll.avgGrossSalary,
  };
}

async function searchEmployees(args, user) {
  if (user.role === "employee") {
    // An employee can only ever get their OWN record back through this tool,
    // regardless of what they searched for — this is what makes "what is
    // {colleague}'s salary?" come back as a refusal rather than real data.
    const employee = await Employee.findOne({ user: user._id }).select("code name department designation status");
    return { employees: employee ? [employee] : [] };
  }

  const filter = {};
  if (args.department) filter.department = args.department;
  if (args.query) filter.$text = { $search: args.query };
  const employees = await Employee.find(filter).select("code name department designation status").limit(10);
  return { employees };
}

/* ------------------------------ Tool schemas ------------------------------ */

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "get_headcount",
      description: "Active employee headcount, overall or filtered by department.",
      parameters: { type: "object", properties: { department: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attendance_summary",
      description: "Attendance rate, late %, and absenteeism % for a date range and optional department.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD, defaults to start of this month" },
          to: { type: "string", description: "YYYY-MM-DD, defaults to today" },
          department: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_late_comers",
      description: "Top employees by number of late check-ins in a date range.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          department: { type: "string" },
          limit: { type: "number", description: "Defaults to 5" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_leave_summary",
      description: "Approved leave days used vs. quota, grouped by leave type, for a date range and optional department.",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, department: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_leave_balance",
      description: "The CALLER's own leave balance for a year. Employee role only — never returns another employee's balance.",
      parameters: { type: "object", properties: { year: { type: "number", description: "Defaults to the current year" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payroll_summary",
      description: "Aggregate payroll cost and average salary for one month, optionally by department. Never returns an individual employee's salary.",
      parameters: {
        type: "object",
        properties: {
          month: { type: "number", description: "1-12, required" },
          year: { type: "number", description: "required" },
          department: { type: "string" },
        },
        required: ["month", "year"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_employees",
      description: "Search the employee directory by name/code or department. An employee caller only ever gets their own record back, never a colleague's.",
      parameters: { type: "object", properties: { query: { type: "string" }, department: { type: "string" } } },
    },
  },
];

export const TOOL_EXECUTORS = {
  get_headcount: getHeadcount,
  get_attendance_summary: getAttendanceSummary,
  get_late_comers: getLateComers,
  get_leave_summary: getLeaveSummary,
  get_my_leave_balance: getMyLeaveBalance,
  get_payroll_summary: getPayrollSummary,
  search_employees: searchEmployees,
};