import express from "express";
import {
  checkIn,
  checkOut,
  getMyAttendance,
  getBoard,
  requestCorrection,
  reviewCorrection,
} from "../controllers/attendanceController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// Employee self-service
router.post("/checkin", requireRole("employee"), checkIn);
router.post("/checkout", requireRole("employee"), checkOut);
router.get("/me", requireRole("employee"), getMyAttendance);
router.post("/:id/correction", requireRole("employee"), requestCorrection);

// HR/Admin
router.get("/board", requireRole("admin", "hr"), getBoard);
router.put("/:id/correction", requireRole("admin", "hr"), reviewCorrection);

export default router;