import express from "express";
import {
  registerEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  dryRunImportEmployees,
  importEmployees,
  exportEmployees,
} from "../controllers/employeeController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.use(requireAuth); // every route below requires login

router.post("/", requireRole("hr", "admin"), registerEmployee);
router.get("/", requireRole("admin", "hr", "employee"), listEmployees);

// CSV import/export — HR only, per the brief's checklist (#08: Admin "—", HR "Manage").
// Declared before "/:id" so "import" and "export" are never swallowed as an :id param.
router.post("/import/dry-run", requireRole("hr"), upload.single("file"), dryRunImportEmployees);
router.post("/import", requireRole("hr"), upload.single("file"), importEmployees);
router.get("/export", requireRole("hr"), exportEmployees);

router.get("/:id", requireRole("admin", "hr", "employee"), getEmployee);
router.put("/:id", requireRole("admin", "hr", "employee"), updateEmployee);

export default router;