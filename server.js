import "dotenv/config";
import "express-async-errors";
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import orgRoutes from "./routes/orgRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import commsRoutes from "./routes/commsRoutes.js";

import User from "./models/User.js";
import Settings from "./models/Settings.js";
import LeaveType from "./models/LeaveType.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/comms", commsRoutes);

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Centralized error handler — catches anything thrown or rejected
// anywhere in the async route handlers above (via express-async-errors).
app.use((err, req, res, next) => {
  console.error(err.stack || err.message);

  // Mongoose bad ObjectId (e.g. GET /api/employees/not-a-valid-id)
  if (err.name === "CastError") {
    return res.status(400).json({ message: `Invalid ${err.path}: ${err.value}` });
  }

  // Mongoose validation errors
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ message: messages.join(", ") });
  }

  // Mongo duplicate key (in case a controller doesn't already catch code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(409).json({ message: `Duplicate value for ${field}` });
  }

  res.status(err.statusCode || 500).json({
    message: err.message || "Something went wrong on the server",
  });
});

const PORT = process.env.PORT || 5000;

// Seeds a demo Admin login (and company Settings) on a fresh database so the
// hosted demo always has a working login — never overwrites an existing
// setup. Controlled via ADMIN_EMAIL / ADMIN_PASSWORD / COMPANY_NAME env vars,
// falling back to fixed demo values if those aren't set.
async function ensureDemoAdmin() {
  try {
    const adminExists = await User.exists({ role: "admin" });
    const settingsExist = await Settings.getSingleton();
    if (adminExists && settingsExist) return; // already set up, don't touch it

    if (!adminExists) {
      const email = process.env.ADMIN_EMAIL || "admin@demo.com";
      const password = process.env.ADMIN_PASSWORD || "demo1234";
      await User.create({ name: "Demo Admin", email, password, role: "admin" });
      console.log(`Seeded default admin login: ${email}`);
    }
    if (!settingsExist) {
      await Settings.create({ companyName: process.env.COMPANY_NAME || "Demo Company" });
      await LeaveType.seedDefaults();
      console.log("Seeded default company settings and leave types.");
    }
  } catch (err) {
    // Never let seeding crash the server — worst case, Setup page still works manually.
    console.error("Demo admin seeding failed:", err.message);
  }
}

connectDB().then(async () => {
  await ensureDemoAdmin();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});