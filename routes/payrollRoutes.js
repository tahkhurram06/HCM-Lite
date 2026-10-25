import express from "express";
import {
  runPayroll,
  listPayroll,
  finalizePayroll,
  getMyPayroll,
  getPayrollById,
  downloadPayslip,
} from "../controllers/payrollController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// Employee self-service
router.get("/me", requireRole("employee"), getMyPayroll);

// HR: create/recompute the monthly draft
router.post("/run", requireRole("hr"), runPayroll);

// Admin (view) + HR (manage): list a period's payroll
router.get("/", requireRole("admin", "hr"), listPayroll);

// Admin only: lock a period
router.put("/finalize", requireRole("admin"), finalizePayroll);

// Single record + payslip — scope (own vs. all) is enforced inside the controller
router.get("/:id", requireRole("admin", "hr", "employee"), getPayrollById);
router.get("/:id/payslip", requireRole("admin", "hr", "employee"), downloadPayslip);

export default router;