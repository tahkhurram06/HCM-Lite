import Notification from "../models/Notification.js";

// Fire-and-forget, like logAction — a notification failing should never
// fail the actual request (leave approval, payroll finalize, etc.).
export async function notifyUser({ userId, type, message, relatedEntity, relatedId }) {
  try {
    await Notification.create({ user: userId, type, message, relatedEntity, relatedId });
  } catch (err) {
    console.error("Notification failed:", err.message);
  }
}