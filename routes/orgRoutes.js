import express from "express";
import {
  getSettings,
  updateSettings,
  listDepartments,
  createDepartment,
  updateDepartment,
  listDesignations,
  createDesignation,
  updateDesignation,
  listLeaveTypes,
  upsertLeaveType,
  listHolidays,
  createHoliday,
  deleteHoliday,
} from "../controllers/orgController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth); // every org route requires login

// Settings: Admin manages, HR views
router.get("/settings", requireRole("admin", "hr"), getSettings);
router.put("/settings", requireRole("admin"), updateSettings);

// Departments: Admin manages, HR + Employee view (directory/filters need this)
router.get("/departments", requireRole("admin", "hr", "employee"), listDepartments);
router.post("/departments", requireRole("admin"), createDepartment);
router.put("/departments/:id", requireRole("admin"), updateDepartment);

// Designations: Admin manages, HR + Employee view
router.get("/designations", requireRole("admin", "hr", "employee"), listDesignations);
router.post("/designations", requireRole("admin"), createDesignation);
router.put("/designations/:id", requireRole("admin"), updateDesignation);

// Leave types: Admin manages, everyone can view (needed for the leave form/quota display)
router.get("/leave-types", requireRole("admin", "hr", "employee"), listLeaveTypes);
router.put("/leave-types", requireRole("admin"), upsertLeaveType);

// Holidays: Admin manages, everyone can view (needed for leave/attendance day counting)
router.get("/holidays", requireRole("admin", "hr", "employee"), listHolidays);
router.post("/holidays", requireRole("admin"), createHoliday);
router.delete("/holidays/:id", requireRole("admin"), deleteHoliday);

export default router;