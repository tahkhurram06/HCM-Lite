import Employee from "../models/Employee.js";
import User from "../models/User.js";
import { generateTempPassword } from "../utils/generatePassword.js";
import { logAction } from "../utils/audit.js";
import { parseEmployeeCsv, validateEmployeeRows } from "../utils/csvEmployees.js";

// POST /api/employees
// HR or Admin registers a new employee. This ALSO creates their login
// (User with role "employee" and a temp password they must change).
export async function registerEmployee(req, res) {
  const {
    code,
    name,
    email,
    phone,
    address,
    department,
    designation,
    dateOfJoining,
    basicSalary,
  } = req.body;

  if (!code || !name || !email || !department || !designation || !dateOfJoining || !basicSalary) {
    return res.status(400).json({
      message:
        "code, name, email, department, designation, dateOfJoining and basicSalary are required",
    });
  }
  if (Number(basicSalary) <= 0) {
    return res.status(400).json({ message: "basicSalary must be greater than 0" });
  }

  const existing = await Employee.findOne({
    $or: [{ code }, { email: email.toLowerCase() }],
  });
  if (existing) {
    return res.status(409).json({ message: "Employee code or email already exists" });
  }

  const employee = await Employee.create({
    code,
    name,
    email: email.toLowerCase(),
    phone,
    address,
    department,
    designation,
    dateOfJoining,
    salary: { basic: basicSalary },
  });

  // Create their login with a temporary password
  const tempPassword = generateTempPassword();
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: tempPassword,
    role: "employee",
    employee: employee._id,
    mustChangePassword: true,
  });

  employee.user = user._id;
  await employee.save();

  await logAction({
    user: req.user,
    action: "create",
    entity: "Employee",
    entityId: employee._id,
    after: employee.toObject(),
  });

  res.status(201).json({
    employee,
    // Returned once so HR can hand it to the employee. Never stored in plain text.
    temporaryPassword: tempPassword,
  });
}

// GET /api/employees
// Admin/HR: see all (with search, filter by department, pagination).
// Employee: only their own record.
export async function listEmployees(req, res) {
  if (req.user.role === "employee") {
    const employee = await Employee.findOne({ user: req.user._id });
    return res.json({ employees: employee ? [employee] : [], total: employee ? 1 : 0 });
  }

  const { search, department, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (department) filter.department = department;
  if (search) filter.$text = { $search: search };

  const skip = (Number(page) - 1) * Number(limit);
  const [employees, total] = await Promise.all([
    Employee.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Employee.countDocuments(filter),
  ]);

  res.json({ employees, total, page: Number(page), limit: Number(limit) });
}

// GET /api/employees/:id
// Admin/HR: any employee. Employee: only themselves (403 otherwise).
export async function getEmployee(req, res) {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ message: "Employee not found" });

  if (req.user.role === "employee" && String(employee.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({ employee });
}

// PUT /api/employees/:id
// Admin/HR: can edit job details and salary.
// Employee: can only edit their own phone and address (per the brief).
export async function updateEmployee(req, res) {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ message: "Employee not found" });

  const before = employee.toObject();

  if (req.user.role === "employee") {
    if (String(employee.user) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { phone, address } = req.body;
    if (phone !== undefined) employee.phone = phone;
    if (address !== undefined) employee.address = address;
    await employee.save();

    await logAction({
      user: req.user,
      action: "update",
      entity: "Employee",
      entityId: employee._id,
      before,
      after: employee.toObject(),
    });

    return res.json({ employee });
  }

  // HR / Admin: broader edit
  const allowedFields = [
    "name",
    "phone",
    "address",
    "department",
    "designation",
    "status",
  ];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) employee[field] = req.body[field];
  }
  if (req.body.basicSalary !== undefined) {
    if (Number(req.body.basicSalary) <= 0) {
      return res.status(400).json({ message: "basicSalary must be greater than 0" });
    }
    employee.salary.basic = req.body.basicSalary;
  }

  await employee.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "Employee",
    entityId: employee._id,
    before,
    after: employee.toObject(),
  });

  res.json({ employee });
}

/* ------------------------------ CSV import/export ------------------------------ */

// POST /api/employees/import/dry-run — HR only. multipart/form-data, field "file".
// Validates every row and returns a row+field+reason report. Never writes
// to the database — this is purely a preview (brief M3: "dry run returning
// row + field + reason").
export async function dryRunImportEmployees(req, res) {
  if (!req.file) return res.status(400).json({ message: "CSV file is required (field name: file)" });

  let rows;
  try {
    rows = parseEmployeeCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ message: `Could not parse CSV: ${err.message}` });
  }

  const { validRows, errors } = await validateEmployeeRows(rows);

  res.json({
    totalRows: rows.length,
    validCount: validRows.length,
    errorCount: errors.length,
    errors,
  });
}

// POST /api/employees/import — HR only. multipart/form-data, field "file".
// Re-validates independently of any prior dry-run (never trusts client
// state), then creates an Employee + login for every valid row, exactly
// like registerEmployee. Invalid rows are skipped and reported — nothing
// partial is created for a bad row.
export async function importEmployees(req, res) {
  if (!req.file) return res.status(400).json({ message: "CSV file is required (field name: file)" });

  let rows;
  try {
    rows = parseEmployeeCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ message: `Could not parse CSV: ${err.message}` });
  }

  const { validRows, errors } = await validateEmployeeRows(rows);

  const created = [];
  for (const { rowNumber, data } of validRows) {
    try {
      const employee = await Employee.create({
        code: data.code,
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        department: data.department,
        designation: data.designation,
        dateOfJoining: data.dateOfJoining,
        salary: { basic: data.basicSalary },
      });

      const tempPassword = generateTempPassword();
      const user = await User.create({
        name: data.name,
        email: data.email,
        password: tempPassword,
        role: "employee",
        employee: employee._id,
        mustChangePassword: true,
      });
      employee.user = user._id;
      await employee.save();

      await logAction({
        user: req.user,
        action: "create",
        entity: "Employee",
        entityId: employee._id,
        after: employee.toObject(),
      });

      created.push({ row: rowNumber, code: data.code, email: data.email, temporaryPassword: tempPassword });
    } catch (err) {
      // A row can still fail here on a DB-level race (e.g. two rows with
      // the same code that both looked valid at validation time).
      errors.push({ row: rowNumber, field: "database", reason: err.message });
    }
  }

  res.status(201).json({
    totalRows: rows.length,
    createdCount: created.length,
    errorCount: errors.length,
    created,
    errors,
  });
}

// GET /api/employees/export — HR only. Streams the full employee directory as CSV.
export async function exportEmployees(req, res) {
  const employees = await Employee.find({}).sort({ code: 1 });

  const header = [
    "code",
    "name",
    "email",
    "phone",
    "address",
    "department",
    "designation",
    "dateOfJoining",
    "basicSalary",
    "status",
  ];
  const escape = (val) => {
    if (val === undefined || val === null) return "";
    const str = String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [header.join(",")];
  for (const e of employees) {
    lines.push(
      [
        e.code,
        e.name,
        e.email,
        e.phone,
        e.address,
        e.department,
        e.designation,
        e.dateOfJoining.toISOString().slice(0, 10),
        e.salary.basic,
        e.status,
      ]
        .map(escape)
        .join(",")
    );
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=employees-${new Date().toISOString().slice(0, 10)}.csv`
  );
  res.send(lines.join("\n"));
}