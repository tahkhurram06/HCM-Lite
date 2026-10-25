import Payroll from "../models/Payroll.js";
import Employee from "../models/Employee.js";
import { computeEmployeePayroll } from "../utils/payrollCalc.js";
import { generatePayslipPDF } from "../utils/payslipPdf.js";
import { logAction } from "../utils/audit.js";
import { notifyUser } from "../utils/notify.js";

async function getSelfEmployee(req) {
  return Employee.findOne({ user: req.user._id });
}

/* --------------------------------- Run --------------------------------- */

// POST /api/payroll/run — HR only. Body: { month, year }
// Computes/recomputes a DRAFT payroll record for every employee who was
// employed at some point during the month (active, or left during it).
// Re-running overwrites existing drafts; already-finalized records are
// skipped and left untouched (finalized runs are locked, per the brief).
export async function runPayroll(req, res) {
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ message: "month and year are required" });
  if (month < 1 || month > 12) return res.status(400).json({ message: "month must be between 1 and 12" });

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  // Employed at some point in the month: joined on/before month end, and
  // either still active or left on/after month start.
  const employees = await Employee.find({
    dateOfJoining: { $lte: monthEnd },
    $or: [{ dateOfLeaving: { $exists: false } }, { dateOfLeaving: null }, { dateOfLeaving: { $gte: monthStart } }],
  });

  const results = [];
  for (const employee of employees) {
    const existing = await Payroll.findOne({ employee: employee._id, month, year });
    if (existing?.status === "finalized") {
      results.push({ employee: employee._id, payrollId: existing._id, skipped: true, reason: "already finalized" });
      continue;
    }

    const calc = await computeEmployeePayroll(employee, month, year);
    const record = await Payroll.findOneAndUpdate(
      { employee: employee._id, month, year },
      { ...calc, status: "draft", generatedBy: req.user._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push({ employee: employee._id, payrollId: record._id });
  }

  await logAction({
    user: req.user,
    action: "run",
    entity: "Payroll",
    after: { month, year, processed: results.length },
  });

  res.status(201).json({ month, year, processed: results.length, results });
}

/* ------------------------------ Admin / HR ------------------------------ */

// GET /api/payroll?month=&year=&department=&status= — Admin (view), HR (manage)
export async function listPayroll(req, res) {
  const { month, year, department, status } = req.query;
  if (!month || !year) return res.status(400).json({ message: "month and year are required" });

  const filter = { month: Number(month), year: Number(year) };
  if (status) filter.status = status;

  let records = await Payroll.find(filter).populate("employee", "code name department");
  if (department) records = records.filter((r) => r.employee?.department === department);

  const totals = records.reduce(
    (acc, r) => {
      acc.grossMonthly += r.grossMonthly || 0;
      acc.netPay += r.netPay || 0;
      return acc;
    },
    { grossMonthly: 0, netPay: 0 }
  );

  res.json({ month: Number(month), year: Number(year), count: records.length, totals, payroll: records });
}

// PUT /api/payroll/finalize — Admin only. Body: { month, year }
// Locks every draft record for the period. Once finalized a record can
// never be edited again — only Admin can call this.
export async function finalizePayroll(req, res) {
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ message: "month and year are required" });

  const drafts = await Payroll.find({ month, year, status: "draft" });
  if (drafts.length === 0) {
    return res.status(400).json({ message: "No draft payroll records found for this period" });
  }

  await Payroll.updateMany(
    { month, year, status: "draft" },
    { status: "finalized", finalizedBy: req.user._id, finalizedAt: new Date() }
  );

  await logAction({
    user: req.user,
    action: "finalize",
    entity: "Payroll",
    after: { month, year, count: drafts.length },
  });

  // Notify each affected employee their payslip is ready.
  const finalizedRecords = await Payroll.find({ _id: { $in: drafts.map((d) => d._id) } }).populate(
    "employee",
    "user"
  );
  for (const record of finalizedRecords) {
    if (record.employee?.user) {
      await notifyUser({
        userId: record.employee.user,
        type: "payslip_ready",
        message: `Your payslip for ${month}/${year} is ready.`,
        relatedEntity: "Payroll",
        relatedId: record._id,
      });
    }
  }

  res.json({ message: `Finalized payroll for ${month}/${year}`, count: drafts.length });
}

/* --------------------------------- Views --------------------------------- */

// GET /api/payroll/me?year= — Employee: own payslip history (finalized only).
export async function getMyPayroll(req, res) {
  const employee = await getSelfEmployee(req);
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const filter = { employee: employee._id, status: "finalized" };
  if (req.query.year) filter.year = Number(req.query.year);

  const records = await Payroll.find(filter).sort({ year: -1, month: -1 });
  res.json({ payroll: records });
}

// GET /api/payroll/:id — Admin/HR: any record. Employee: only their own,
// and only once it's finalized (a draft isn't theirs to see yet).
export async function getPayrollById(req, res) {
  const record = await Payroll.findById(req.params.id).populate("employee", "code name department designation");
  if (!record) return res.status(404).json({ message: "Payroll record not found" });

  if (req.user.role === "employee") {
    const employee = await getSelfEmployee(req);
    if (!employee || String(record.employee._id) !== String(employee._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (record.status !== "finalized") {
      return res.status(403).json({ message: "Payslip not available until payroll is finalized" });
    }
  }

  res.json({ payroll: record });
}

// GET /api/payroll/:id/payslip — PDF download.
// Admin/HR can pull a draft or finalized PDF (for review before finalizing).
// Employee can only download their own, and only once it's finalized.
export async function downloadPayslip(req, res) {
  const record = await Payroll.findById(req.params.id).populate("employee", "code name department designation");
  if (!record) return res.status(404).json({ message: "Payroll record not found" });

  if (req.user.role === "employee") {
    const employee = await getSelfEmployee(req);
    if (!employee || String(record.employee._id) !== String(employee._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (record.status !== "finalized") {
      return res.status(403).json({ message: "Payslip not available until payroll is finalized" });
    }
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=payslip-${record.employee.code}-${record.month}-${record.year}.pdf`
  );
  generatePayslipPDF(record).pipe(res);
}