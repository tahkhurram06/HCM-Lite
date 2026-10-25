import express from "express";
import {
  createAnnouncement,
  listAnnouncements,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/commsController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// Announcements: Admin + HR post, everyone reads
router.post("/announcements", requireRole("admin", "hr"), createAnnouncement);
router.get("/announcements", requireRole("admin", "hr", "employee"), listAnnouncements);

// Notifications: everyone, own only
router.get("/notifications", requireRole("admin", "hr", "employee"), getMyNotifications);
router.put("/notifications/:id/read", requireRole("admin", "hr", "employee"), markNotificationRead);
router.put("/notifications/read-all", requireRole("admin", "hr", "employee"), markAllNotificationsRead);

export default router;