import Leave from "../models/Leave.js";
import LeaveType from "../models/LeaveType.js";
import Employee from "../models/Employee.js";
import Settings from "../models/Settings.js";
import { toDateOnly, countWorkingDays } from "../utils/workingDays.js";
import { logAction } from "../utils/audit.js";
import { notifyUser } from "../utils/notify.js";

async function getSelfEmployee(req) {
  return Employee.findOne({ user: req.user._id });
}

// Sum approved leave days of one type, for one employee, within a calendar year.
async function getUsedDays(employeeId, leaveType, year) {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const leaves = await Leave.find({
    employee: employeeId,
    leaveType,
    status: "approved",
    startDate: { $gte: yearStart, $lte: yearEnd },
  });
  return leaves.reduce((sum, l) => sum + l.days, 0);
}

/* --------------------------------- Balance --------------------------------- */

// GET /api/leave/balance — Employee only (own balance)
export async function getBalance(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const year = Number(req.query.year) || new Date().getFullYear();
  const leaveTypes = await LeaveType.find({ isActive: true });

  const balance = await Promise.all(
    leaveTypes.map(async (lt) => {
      const used = await getUsedDays(employee._id, lt.name, year);
      return {
        leaveType: lt.name,
        quota: lt.yearlyQuota, // null = unlimited
        used,
        remaining: lt.yearlyQuota === null ? null : lt.yearlyQuota - used,
      };
    })
  );

  res.json({ year, balance });
}

/* ---------------------------------- Apply ---------------------------------- */

// POST /api/leave — Employee only
// Body: { leaveType, startDate, endDate, reason }
export async function applyLeave(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const { leaveType, startDate, endDate, reason } = req.body;
  if (!leaveType || !startDate || !endDate) {
    return res.status(400).json({ message: "leaveType, startDate and endDate are required" });
  }

  const type = await LeaveType.findOne({ name: leaveType, isActive: true });
  if (!type) return res.status(400).json({ message: "Unknown leave type" });

  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  if (end < start) {
    return res.status(400).json({ message: "endDate cannot be before startDate" });
  }

  const settings = await Settings.getSingleton();
  const days = await countWorkingDays(start, end, settings);
  if (days === 0) {
    return res.status(422).json({ message: "Selected range has no working days" });
  }

  // Overlap check: any pending/approved leave for this employee touching the range.
  const overlap = await Leave.findOne({
    employee: employee._id,
    status: { $in: ["pending", "approved"] },
    startDate: { $lte: end },
    endDate: { $gte: start },
  });
  if (overlap) {
    return res.status(422).json({ message: "Overlaps an existing leave request" });
  }

  // Balance check (skip for unlimited types, e.g. unpaid).
  if (type.yearlyQuota !== null) {
    const used = await getUsedDays(employee._id, type.name, start.getUTCFullYear());
    if (used + days > type.yearlyQuota) {
      return res.status(422).json({
        message: `Exceeds ${type.name} leave balance: ${type.yearlyQuota - used} day(s) remaining`,
      });
    }
  }

  const leave = await Leave.create({
    employee: employee._id,
    leaveType: type.name,
    startDate: start,
    endDate: end,
    days,
    reason,
    source: req.body.source === "smart" ? "smart" : "manual",
  });

  await logAction({
    user: req.user,
    action: "create",
    entity: "Leave",
    entityId: leave._id,
    after: leave.toObject(),
  });

  res.status(201).json({ leave });
}

// DELETE /api/leave/:id — Employee cancels their own PENDING request
export async function cancelLeave(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ message: "Leave request not found" });
  if (String(leave.employee) !== String(employee._id)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (leave.status !== "pending") {
    return res.status(400).json({ message: "Only pending requests can be cancelled" });
  }

  const before = leave.toObject();
  leave.status = "cancelled";
  await leave.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "Leave",
    entityId: leave._id,
    before,
    after: leave.toObject(),
  });

  res.json({ leave });
}

// GET /api/leave/me — Employee's own history
export async function getMyLeaves(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const leaves = await Leave.find({ employee: employee._id }).sort({ startDate: -1 });
  res.json({ leaves });
}

/* ------------------------------- HR approval ------------------------------- */

// GET /api/leave/inbox — Admin, HR: all pending requests
export async function getInbox(req, res) {
  const leaves = await Leave.find({ status: "pending" })
    .populate("employee", "code name department")
    .sort({ createdAt: 1 });
  res.json({ leaves });
}

// PUT /api/leave/:id/review — Admin, HR approve or reject with a comment
export async function reviewLeave(req, res) {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ message: "Leave request not found" });
  if (leave.status !== "pending") {
    return res.status(400).json({ message: "This request has already been reviewed" });
  }

  const before = leave.toObject();

  const { decision, comment } = req.body; // "approved" | "rejected"
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ message: "decision must be approved or rejected" });
  }

  // Re-check balance at approval time in case other requests were approved since.
  if (decision === "approved") {
    const type = await LeaveType.findOne({ name: leave.leaveType });
    if (type?.yearlyQuota !== null && type?.yearlyQuota !== undefined) {
      const used = await getUsedDays(leave.employee, leave.leaveType, leave.startDate.getUTCFullYear());
      if (used + leave.days > type.yearlyQuota) {
        return res.status(422).json({ message: "Approving this would exceed the employee's balance" });
      }
    }
  }

  leave.status = decision;
  leave.reviewedBy = req.user._id;
  leave.reviewComment = comment;
  await leave.save();

  await logAction({
    user: req.user,
    action: decision, // "approved" | "rejected"
    entity: "Leave",
    entityId: leave._id,
    before,
    after: leave.toObject(),
  });

  // Notify the employee their request was decided.
  const employee = await Employee.findById(leave.employee);
  if (employee?.user) {
    await notifyUser({
      userId: employee.user,
      type: "leave_decision",
      message: `Your ${leave.leaveType} leave request (${leave.startDate.toISOString().slice(0, 10)} to ${leave.endDate.toISOString().slice(0, 10)}) was ${decision}.`,
      relatedEntity: "Leave",
      relatedId: leave._id,
    });
  }

  res.json({ leave });
}

// GET /api/leave — Admin, HR: all leave records, filterable by employee/department/status
export async function listLeaves(req, res) {
  const { status, employee } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (employee) filter.employee = employee;

  const leaves = await Leave.find(filter)
    .populate("employee", "code name department")
    .sort({ startDate: -1 });
  res.json({ leaves });
}