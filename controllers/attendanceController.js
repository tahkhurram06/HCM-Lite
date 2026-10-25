import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import Settings from "../models/Settings.js";
import { toDateOnly, isWorkingDay, getHolidaySet } from "../utils/workingDays.js";
import { getApprovedLeaveEmployeeIds } from "../models/leaveLookup.js";
import { logAction } from "../utils/audit.js";

// Resolve the Employee document for the logged-in user (employee role only).
async function getSelfEmployee(req) {
  return Employee.findOne({ user: req.user._id });
}

// Build the Date cutoff for "late" on a given calendar day, from Settings.
function lateThresholdFor(dateOnly, settings) {
  const [h, m] = settings.officeStartTime.split(":").map(Number);
  const cutoff = new Date(dateOnly);
  cutoff.setUTCHours(h, m + settings.graceMinutes, 0, 0);
  return cutoff;
}

/* ------------------------------ Check-in/out ------------------------------ */

// POST /api/attendance/checkin — Employee only
export async function checkIn(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const settings = await Settings.getSingleton();
  const now = new Date();
  const dateOnly = toDateOnly(now);

  const existing = await Attendance.findOne({ employee: employee._id, date: dateOnly });
  if (existing?.checkIn?.time) {
    return res.status(409).json({ message: "Already checked in today" });
  }

  const isLate = now > lateThresholdFor(dateOnly, settings);
  const source = req.body.source === "camera" ? "camera" : "web";

  let record;
  try {
    if (existing) {
      existing.checkIn = { time: now, source, location: req.body.location };
      existing.status = isLate ? "late" : "checked_in";
      record = await existing.save();
    } else {
      record = await Attendance.create({
        employee: employee._id,
        date: dateOnly,
        checkIn: { time: now, source, location: req.body.location },
        status: isLate ? "late" : "checked_in",
      });
    }
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Already checked in today" });
    throw err;
  }

  res.status(201).json({ attendance: record, late: isLate });
}

// POST /api/attendance/checkout — Employee only
export async function checkOut(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const now = new Date();
  const dateOnly = toDateOnly(now);
  const settings = await Settings.getSingleton();

  const record = await Attendance.findOne({ employee: employee._id, date: dateOnly });
  if (!record || !record.checkIn?.time) {
    return res.status(400).json({ message: "No check-in found for today" });
  }
  if (record.checkOut?.time) {
    return res.status(409).json({ message: "Already checked out today" });
  }

  const source = req.body.source === "camera" ? "camera" : "web";
  record.checkOut = { time: now, source, location: req.body.location };

  const workedHours = (now - record.checkIn.time) / (1000 * 60 * 60);
  record.workedHours = Math.round(workedHours * 100) / 100;

  if (workedHours < settings.halfDayThresholdHours) {
    record.status = "half_day";
  } else if (record.status === "late") {
    record.status = "late"; // stays late even if full hours worked
  } else {
    record.status = "present";
  }

  await record.save();
  res.json({ attendance: record });
}

/* --------------------------- Employee's own view --------------------------- */

// GET /api/attendance/me?from=YYYY-MM-DD&to=YYYY-MM-DD — Employee only
export async function getMyAttendance(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const { from, to } = req.query;
  const start = from ? toDateOnly(from) : toDateOnly(new Date(new Date().setDate(1)));
  const end = to ? toDateOnly(to) : toDateOnly(new Date());

  const records = await buildRangeView(employee._id, start, end);
  res.json({ attendance: records });
}

/* ------------------------------- HR daily board ------------------------------- */

// GET /api/attendance/board?date=YYYY-MM-DD&department=... — Admin, HR
// Shows every active employee's status for one day. Anyone with an approved
// leave that day shows "on_leave" instead of "absent".
export async function getBoard(req, res) {
  const { date, department } = req.query;
  const dateOnly = toDateOnly(date || new Date());

  const settings = await Settings.getSingleton();
  const holidaySet = await getHolidaySet(dateOnly, dateOnly);
  const workingDay = await isWorkingDay(dateOnly, settings, holidaySet);

  const empFilter = { status: "active" };
  if (department) empFilter.department = department;
  const employees = await Employee.find(empFilter).select("code name department");
  const employeeIds = employees.map((e) => e._id);

  const [records, onLeaveIds] = await Promise.all([
    Attendance.find({ employee: { $in: employeeIds }, date: dateOnly }),
    getApprovedLeaveEmployeeIds(employeeIds, dateOnly),
  ]);
  const byEmployee = new Map(records.map((r) => [String(r.employee), r]));

  const now = new Date();
  const board = employees.map((emp) => {
    const record = byEmployee.get(String(emp._id));
    let status;
    if (onLeaveIds.has(String(emp._id)) && !record) {
      status = "on_leave";
    } else if (!record) {
      status = workingDay ? "absent" : "day_off";
    } else if (record.checkIn?.time && !record.checkOut?.time) {
      status = dateOnly < toDateOnly(now) ? "missing_checkout" : record.status;
    } else {
      status = record.status;
    }
    return {
      employee: { id: emp._id, code: emp.code, name: emp.name, department: emp.department },
      status,
      checkIn: record?.checkIn?.time || null,
      checkOut: record?.checkOut?.time || null,
      workedHours: record?.workedHours ?? null,
    };
  });

  res.json({ date: dateOnly, board });
}

/* --------------------------------- Helpers --------------------------------- */

async function buildRangeView(employeeId, start, end) {
  const settings = await Settings.getSingleton();
  const holidaySet = await getHolidaySet(start, end);
  const records = await Attendance.find({
    employee: employeeId,
    date: { $gte: start, $lte: end },
  });
  const byDate = new Map(records.map((r) => [toDateOnly(r.date).toISOString().slice(0, 10), r]));

  const now = new Date();
  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = toDateOnly(cursor).toISOString().slice(0, 10);
    const record = byDate.get(key);
    const workingDay = await isWorkingDay(cursor, settings, holidaySet);
    const onLeaveIds = await getApprovedLeaveEmployeeIds([employeeId], cursor);

    let status;
    if (!workingDay) status = "day_off";
    else if (onLeaveIds.has(String(employeeId)) && !record) status = "on_leave";
    else if (!record) status = toDateOnly(cursor) < toDateOnly(now) ? "absent" : "upcoming";
    else if (record.checkIn?.time && !record.checkOut?.time) {
      status = toDateOnly(cursor) < toDateOnly(now) ? "missing_checkout" : record.status;
    } else status = record.status;

    out.push({
      date: key,
      status,
      checkIn: record?.checkIn?.time || null,
      checkOut: record?.checkOut?.time || null,
      workedHours: record?.workedHours ?? null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/* ------------------------------ Corrections ------------------------------ */

// POST /api/attendance/:id/correction — Employee requests a fix on their own record
export async function requestCorrection(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const record = await Attendance.findById(req.params.id);
  if (!record) return res.status(404).json({ message: "Attendance record not found" });
  if (String(record.employee) !== String(employee._id)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { reason, requestedCheckIn, requestedCheckOut } = req.body;
  if (!reason) return res.status(400).json({ message: "reason is required" });

  record.correction = {
    requested: true,
    reason,
    requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : undefined,
    requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : undefined,
    status: "pending",
  };
  await record.save();
  res.json({ attendance: record });
}

// PUT /api/attendance/:id/correction — HR/Admin approve or reject
export async function reviewCorrection(req, res) {
  const record = await Attendance.findById(req.params.id);
  if (!record) return res.status(404).json({ message: "Attendance record not found" });
  if (!record.correction?.requested || record.correction.status !== "pending") {
    return res.status(400).json({ message: "No pending correction on this record" });
  }

  const before = record.toObject();

  const { decision, comment } = req.body; // decision: "approved" | "rejected"
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ message: "decision must be approved or rejected" });
  }

  record.correction.status = decision;
  record.correction.reviewedBy = req.user._id;
  record.correction.reviewComment = comment;

  if (decision === "approved") {
    const settings = await Settings.getSingleton();
    if (record.correction.requestedCheckIn) record.checkIn.time = record.correction.requestedCheckIn;
    if (record.correction.requestedCheckOut) record.checkOut.time = record.correction.requestedCheckOut;

    // Recompute status from the corrected times.
    if (record.checkIn?.time && record.checkOut?.time) {
      const hours = (record.checkOut.time - record.checkIn.time) / (1000 * 60 * 60);
      record.workedHours = Math.round(hours * 100) / 100;
      const isLate = record.checkIn.time > lateThresholdFor(toDateOnly(record.date), settings);
      record.status = hours < settings.halfDayThresholdHours ? "half_day" : isLate ? "late" : "present";
    }
  }

  await record.save();

  await logAction({
    user: req.user,
    action: decision, // "approved" | "rejected"
    entity: "Attendance",
    entityId: record._id,
    before,
    after: record.toObject(),
  });

  res.json({ attendance: record });
}