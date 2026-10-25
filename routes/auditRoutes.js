import express from "express";
import { listAuditLog } from "../controllers/auditController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// Admin only — "View" is in Admin's column for the audit log; HR and
// Employee have no access at all (brief Section 2).
router.get("/", requireRole("admin"), listAuditLog);

export default router;