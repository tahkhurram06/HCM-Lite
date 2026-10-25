import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import LeaveType from "../models/LeaveType.js";
import { generateTempPassword } from "../utils/generatePassword.js";
import { logAction } from "../utils/audit.js";

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// GET /api/auth/setup-status
// Frontend calls this first to know whether to show "create company/admin"
// or the normal login screen. Setup is only complete once BOTH the admin
// user and the company Settings exist.
export async function getSetupStatus(req, res) {
  const [adminExists, settings] = await Promise.all([
    User.exists({ role: "admin" }),
    Settings.getSingleton(),
  ]);
  res.json({ setupComplete: !!adminExists && !!settings });
}

// POST /api/auth/setup
// Only works once - creates the company Settings + the first Admin account.
// After that it 403s. Body: { companyName, name, email, password }
export async function setupAdmin(req, res) {
  const adminExists = await User.exists({ role: "admin" });
  const existingSettings = await Settings.getSingleton();
  if (adminExists || existingSettings) {
    return res.status(403).json({ message: "Setup already completed" });
  }

  const { companyName, name, email, password } = req.body;
  if (!companyName || !name || !email || !password) {
    return res
      .status(400)
      .json({ message: "companyName, name, email, password required" });
  }

  const admin = await User.create({ name, email, password, role: "admin" });

  // Company Settings is created with sensible defaults per the brief
  // (09:00 start, 15 min grace, half day < 5h, Sat-Sun weekend). Admin can
  // edit office location/radius and these later via PUT /api/org/settings.
  const settings = await Settings.create({ companyName });

  // Seed the default leave types/quotas (annual 14, sick 8, casual 10, unpaid unlimited).
  await LeaveType.seedDefaults();

  await logAction({
    user: admin,
    action: "setup",
    entity: "Settings",
    entityId: settings._id,
    after: settings.toObject(),
  });

  const token = signToken(admin);
  res.status(201).json({
    token,
    user: { id: admin._id, name: admin.name, role: admin.role },
  });
}

// POST /api/auth/login
export async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  if (!user.isActive) {
    return res.status(403).json({ message: "Account is deactivated" });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      employee: user.employee,
      mustChangePassword: user.mustChangePassword,
    },
  });
}

// GET /api/auth/me
export async function getMe(req, res) {
  res.json({ user: req.user });
}

// PUT /api/auth/change-password — Any logged-in user changes their OWN
// password. Unlike resetUserPassword (Admin-only, resets someone else's),
// this checks the caller's current password first. Also clears
// mustChangePassword, so a fresh employee/HR login only has to do this once.
export async function changeOwnPassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "currentPassword and newPassword are required" });
  }

  const user = await User.findById(req.user._id);
  if (!(await user.comparePassword(currentPassword))) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }

  user.password = newPassword; // hashed by the pre-save hook on User
  user.mustChangePassword = false;
  await user.save();

  res.json({ message: "Password changed" });
}

/* ------------------------------ Admin: user management ------------------------------ */
// Brief (Section 2, Admin column): "Create, deactivate and reset logins for
// HR and employees." Employee logins are normally created via
// employeeController.registerEmployee (which also makes the Employee
// record) — these endpoints cover HR account creation, plus
// deactivate/reset for ANY non-admin login, which has no other path.

// GET /api/auth/users — Admin only. Lists HR + Employee logins (not other
// admins), so the UI has something to deactivate/reset against.
export async function listUsers(req, res) {
  const { role } = req.query;
  const filter = { role: { $in: ["hr", "employee"] } };
  if (role && ["hr", "employee"].includes(role)) filter.role = role;

  const users = await User.find(filter).select("-password").sort({ createdAt: -1 });
  res.json({ users });
}

// POST /api/auth/hr — Admin only. Creates an HR login with a temporary
// password (brief: "Create ... logins for HR"). There is no Employee
// record for an HR user — it's a login only, same pattern as the Admin
// account created during setup.
export async function createHrUser(req, res) {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ message: "name and email are required" });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ message: "A user with that email already exists" });

  const tempPassword = generateTempPassword();
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: tempPassword,
    role: "hr",
    mustChangePassword: true,
  });

  await logAction({
    user: req.user,
    action: "create",
    entity: "User",
    entityId: user._id,
    after: { name: user.name, email: user.email, role: user.role },
  });

  res.status(201).json({
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    // Returned once so Admin can hand it to the new HR user. Never stored in plain text.
    temporaryPassword: tempPassword,
  });
}

// PUT /api/auth/users/:id/deactivate — Admin only. Blocks login without
// deleting the account or its history (attendance, leave, payroll records
// stay intact). Admins can't deactivate another admin or themselves.
export async function deactivateUser(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.role === "admin") {
    return res.status(403).json({ message: "Admin accounts cannot be deactivated here" });
  }

  const before = user.toObject();
  user.isActive = false;
  await user.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "User",
    entityId: user._id,
    before: { isActive: before.isActive },
    after: { isActive: user.isActive },
  });

  res.json({ message: "User deactivated", user: { id: user._id, isActive: user.isActive } });
}

// PUT /api/auth/users/:id/reactivate — Admin only. Re-enables a previously
// deactivated login.
export async function reactivateUser(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  const before = user.toObject();
  user.isActive = true;
  await user.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "User",
    entityId: user._id,
    before: { isActive: before.isActive },
    after: { isActive: user.isActive },
  });

  res.json({ message: "User reactivated", user: { id: user._id, isActive: user.isActive } });
}

// PUT /api/auth/users/:id/reset-password — Admin only. Issues a new
// temporary password and forces a change on next login — same shape as a
// fresh employee registration's first login.
export async function resetUserPassword(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.role === "admin") {
    return res.status(403).json({ message: "Admin passwords cannot be reset here" });
  }

  const tempPassword = generateTempPassword();
  user.password = tempPassword; // hashed by the pre-save hook on User
  user.mustChangePassword = true;
  await user.save();

  await logAction({
    user: req.user,
    action: "update",
    entity: "User",
    entityId: user._id,
    after: { passwordReset: true },
  });

  res.json({
    message: "Password reset",
    user: { id: user._id, email: user.email },
    temporaryPassword: tempPassword,
  });
}