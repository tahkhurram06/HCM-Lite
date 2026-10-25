import { parse } from "csv-parse/sync";
import Department from "../models/Department.js";
import Employee from "../models/Employee.js";

const REQUIRED_FIELDS = ["code", "name", "email", "department", "designation", "dateOfJoining", "basicSalary"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parses the raw CSV buffer into an array of row objects, keyed by the
// header column names (trimmed). Expected columns: code, name, email,
// phone, address, department, designation, dateOfJoining, basicSalary.
export function parseEmployeeCsv(buffer) {
  return parse(buffer, {
    columns: (header) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
  });
}

// Validates every row per the brief's rules (M3): required fields, unique
// code/email (both against the DB and within the file itself), a known
// department, an ISO date, and salary > 0. Returns:
//   validRows: [{ rowNumber, data }]   — ready to create
//   errors:    [{ row, field, reason }] — the dry-run report
// rowNumber is 1-indexed and accounts for the header row, so it matches
// what the person sees if they open the CSV in a spreadsheet editor.
export async function validateEmployeeRows(rows) {
  const errors = [];
  const validRows = [];

  const departments = await Department.find({ isActive: true }).select("name");
  const knownDepartments = new Set(departments.map((d) => d.name));

  const existingEmployees = await Employee.find({}).select("code email");
  const existingCodes = new Set(existingEmployees.map((e) => e.code));
  const existingEmails = new Set(existingEmployees.map((e) => e.email.toLowerCase()));

  const seenCodesInFile = new Set();
  const seenEmailsInFile = new Set();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // +1 for 0-index, +1 for the header row
    let rowValid = true;

    for (const field of REQUIRED_FIELDS) {
      if (!row[field] || String(row[field]).trim() === "") {
        errors.push({ row: rowNumber, field, reason: "Required field is missing" });
        rowValid = false;
      }
    }
    if (!rowValid) return; // can't safely validate the rest without required fields

    const code = row.code.trim();
    const email = row.email.trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
      errors.push({ row: rowNumber, field: "email", reason: "Not a valid email address" });
      rowValid = false;
    }
    if (existingEmails.has(email) || seenEmailsInFile.has(email)) {
      errors.push({ row: rowNumber, field: "email", reason: "Email already exists" });
      rowValid = false;
    }
    if (existingCodes.has(code) || seenCodesInFile.has(code)) {
      errors.push({ row: rowNumber, field: "code", reason: "Employee code already exists" });
      rowValid = false;
    }
    if (!knownDepartments.has(row.department.trim())) {
      errors.push({ row: rowNumber, field: "department", reason: `Unknown department: "${row.department}"` });
      rowValid = false;
    }
    if (!ISO_DATE_RE.test(row.dateOfJoining.trim()) || isNaN(new Date(row.dateOfJoining).getTime())) {
      errors.push({ row: rowNumber, field: "dateOfJoining", reason: "Must be a valid ISO date (YYYY-MM-DD)" });
      rowValid = false;
    }
    const salary = Number(row.basicSalary);
    if (isNaN(salary) || salary <= 0) {
      errors.push({ row: rowNumber, field: "basicSalary", reason: "Must be a number greater than 0" });
      rowValid = false;
    }

    if (rowValid) {
      seenCodesInFile.add(code);
      seenEmailsInFile.add(email);
      validRows.push({
        rowNumber,
        data: {
          code,
          name: row.name.trim(),
          email,
          phone: row.phone ? row.phone.trim() : undefined,
          address: row.address ? row.address.trim() : undefined,
          department: row.department.trim(),
          designation: row.designation.trim(),
          dateOfJoining: row.dateOfJoining.trim(),
          basicSalary: salary,
        },
      });
    }
  });

  return { validRows, errors };
}