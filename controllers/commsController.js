import Announcement from "../models/Announcement.js";
import Notification from "../models/Notification.js";

/* ------------------------------ Announcements ------------------------------ */

// POST /api/comms/announcements — Admin, HR
export async function createAnnouncement(req, res) {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ message: "title and body are required" });

  const announcement = await Announcement.create({
    title,
    body,
    postedBy: req.user._id,
    postedByName: req.user.name,
  });

  res.status(201).json({ announcement });
}

// GET /api/comms/announcements — All roles
export async function listAnnouncements(req, res) {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [announcements, total] = await Promise.all([
    Announcement.find({}).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Announcement.countDocuments({}),
  ]);

  res.json({ announcements, total, page: Number(page), limit: Number(limit) });
}

/* ------------------------------ Notifications ------------------------------ */

// GET /api/comms/notifications — All roles, own notifications only
export async function getMyNotifications(req, res) {
  const { unreadOnly } = req.query;
  const filter = { user: req.user._id };
  if (unreadOnly === "true") filter.read = false;

  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(50);
  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });

  res.json({ notifications, unreadCount });
}

// PUT /api/comms/notifications/:id/read — mark one as read (own only)
export async function markNotificationRead(req, res) {
  const notification = await Notification.findById(req.params.id);
  if (!notification) return res.status(404).json({ message: "Notification not found" });
  if (String(notification.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  notification.read = true;
  await notification.save();
  res.json({ notification });
}

// PUT /api/comms/notifications/read-all — mark all of the caller's as read
export async function markAllNotificationsRead(req, res) {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ message: "All notifications marked as read" });
}