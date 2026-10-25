import Settings from "../models/Settings.js";
import Department from "../models/Department.js";
import Designation from "../models/Designation.js";
import LeaveType from "../models/LeaveType.js";
import Holiday from "../models/Holiday.js";
import { logAction } from "../utils/audit.js";

/* ---------------------------- Settings ---------------------------- */

// GET /api/org/settings
// Admin + HR can view (brief: HR has "View" on company settings).
export async function getSettings(req, res) {
  const settings = await Settings.getSingleton();
  if (!settings) return res.status(404).json({ message: "Company not set up yet" });
  res.json({ settings });
}

// PUT /api/org/settings
// Admin only. Changes apply to new records only (per brief) — we don't
// retroactively recompute past attendance/leave when settings change.
export async function updateSettings(req, res) {
  const settings = await Settings.getSingleton();
  if (!settings) return res.status(404).json({ message: "Company not set up yet" });

  const before = settings.toObject();

  const allowed = [
    "companyName",
    "officeStartTime",
    "graceMinutes",
    "halfDayThresholdHours",
    "weekendDays",
  ];
  for (const field of allowed) {
    if (req.body[field] !== undefined) settings[field] = req.body[field];
  }

  if (req.body.officeLocation) {
    const { lat, lng, radiusMeters } = req.body.officeLocation;
    if (lat !== undefined) settings.officeLocation.lat = lat;
    if (lng !== undefined) settings.officeLocation.lng = lng;
    if (radiusMeters !== undefined) settings.officeLocation.radiusMeters = radiusMeters;
  }

  await settings.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "Settings",
    entityId: settings._id,
    before,
    after: settings.toObject(),
  });

  res.json({ settings });
}

/* --------------------------- Departments --------------------------- */

// GET /api/org/departments — Admin, HR, Employee (view only for HR/Employee; enforced via routes)
export async function listDepartments(req, res) {
  const departments = await Department.find({ isActive: true }).sort({ name: 1 });
  res.json({ departments });
}

// POST /api/org/departments — Admin only
export async function createDepartment(req, res) {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: "name is required" });

  const existing = await Department.findOne({ name });
  if (existing) return res.status(409).json({ message: "Department already exists" });

  const department = await Department.create({ name, description });

  await logAction({
    user: req.user,
    action: "create",
    entity: "Department",
    entityId: department._id,
    after: department.toObject(),
  });

  res.status(201).json({ department });
}

// PUT /api/org/departments/:id — Admin only
export async function updateDepartment(req, res) {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ message: "Department not found" });

  const before = department.toObject();

  const { name, description, isActive } = req.body;
  if (name !== undefined) department.name = name;
  if (description !== undefined) department.description = description;
  if (isActive !== undefined) department.isActive = isActive;

  await department.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "Department",
    entityId: department._id,
    before,
    after: department.toObject(),
  });

  res.json({ department });
}

/* --------------------------- Designations --------------------------- */

// GET /api/org/designations
export async function listDesignations(req, res) {
  const designations = await Designation.find({ isActive: true })
    .populate("department", "name")
    .sort({ title: 1 });
  res.json({ designations });
}

// POST /api/org/designations — Admin only
export async function createDesignation(req, res) {
  const { title, department } = req.body;
  if (!title) return res.status(400).json({ message: "title is required" });

  const existing = await Designation.findOne({ title });
  if (existing) return res.status(409).json({ message: "Designation already exists" });

  const designation = await Designation.create({ title, department });

  await logAction({
    user: req.user,
    action: "create",
    entity: "Designation",
    entityId: designation._id,
    after: designation.toObject(),
  });

  res.status(201).json({ designation });
}

// PUT /api/org/designations/:id — Admin only
export async function updateDesignation(req, res) {
  const designation = await Designation.findById(req.params.id);
  if (!designation) return res.status(404).json({ message: "Designation not found" });

  const before = designation.toObject();

  const { title, department, isActive } = req.body;
  if (title !== undefined) designation.title = title;
  if (department !== undefined) designation.department = department;
  if (isActive !== undefined) designation.isActive = isActive;

  await designation.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "Designation",
    entityId: designation._id,
    before,
    after: designation.toObject(),
  });

  res.json({ designation });
}

/* ---------------------------- Leave types ---------------------------- */

// GET /api/org/leave-types
export async function listLeaveTypes(req, res) {
  const leaveTypes = await LeaveType.find({ isActive: true }).sort({ name: 1 });
  res.json({ leaveTypes });
}

// PUT /api/org/leave-types/:id — Admin only. Edits an existing type's quota.
// (Creation beyond the seeded defaults is also allowed, for flexibility.)
export async function upsertLeaveType(req, res) {
  const { name, yearlyQuota } = req.body;
  if (!name) return res.status(400).json({ message: "name is required" });

  const existing = await LeaveType.findOne({ name });
  const before = existing ? existing.toObject() : undefined;

  const leaveType = await LeaveType.findOneAndUpdate(
    { name },
    { name, yearlyQuota: yearlyQuota === undefined ? null : yearlyQuota },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await logAction({
    user: req.user,
    action: before ? "update" : "create",
    entity: "LeaveType",
    entityId: leaveType._id,
    before,
    after: leaveType.toObject(),
  });

  res.json({ leaveType });
}

/* ------------------------------ Holidays ------------------------------ */

// GET /api/org/holidays?year=2026
export async function listHolidays(req, res) {
  const { year } = req.query;
  const filter = {};
  if (year) {
    filter.date = {
      $gte: new Date(`${year}-01-01T00:00:00.000Z`),
      $lt: new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`),
    };
  }
  const holidays = await Holiday.find(filter).sort({ date: 1 });
  res.json({ holidays });
}

// POST /api/org/holidays — Admin only
export async function createHoliday(req, res) {
  const { name, date } = req.body;
  if (!name || !date) return res.status(400).json({ message: "name and date are required" });

  try {
    const holiday = await Holiday.create({ name, date: new Date(date) });

    await logAction({
      user: req.user,
      action: "create",
      entity: "Holiday",
      entityId: holiday._id,
      after: holiday.toObject(),
    });

    res.status(201).json({ holiday });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A holiday already exists on that date" });
    }
    throw err;
  }
}

// DELETE /api/org/holidays/:id — Admin only
export async function deleteHoliday(req, res) {
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) return res.status(404).json({ message: "Holiday not found" });

  await logAction({
    user: req.user,
    action: "delete",
    entity: "Holiday",
    entityId: holiday._id,
    before: holiday.toObject(),
  });

  res.json({ message: "Holiday deleted" });
}