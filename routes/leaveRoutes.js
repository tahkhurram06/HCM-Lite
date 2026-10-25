import express from "express";
import {
  getBalance,
  applyLeave,
  cancelLeave,
  getMyLeaves,
  getInbox,
  reviewLeave,
  listLeaves,
} from "../controllers/leaveController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// Employee self-service
router.get("/balance", requireRole("employee"), getBalance);
router.get("/me", requireRole("employee"), getMyLeaves);
router.post("/", requireRole("employee"), applyLeave);
router.delete("/:id", requireRole("employee"), cancelLeave);

// HR/Admin
router.get("/inbox", requireRole("admin", "hr"), getInbox);
router.put("/:id/review", requireRole("admin", "hr"), reviewLeave);
router.get("/", requireRole("admin", "hr"), listLeaves);

export default router;