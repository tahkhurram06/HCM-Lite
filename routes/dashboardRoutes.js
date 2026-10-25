import express from "express";
import { getAdminDashboard, getHrDashboard, getEmployeeDashboard } from "../controllers/dashboardController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/admin", requireRole("admin"), getAdminDashboard);
router.get("/hr", requireRole("admin", "hr"), getHrDashboard);
router.get("/employee", requireRole("employee"), getEmployeeDashboard);

export default router;