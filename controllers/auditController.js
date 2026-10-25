import AuditLog from "../models/AuditLog.js";

// GET /api/audit?entity=&action=&actor=&from=&to=&page=&limit= — Admin only.
// Read-only: there is no edit/delete endpoint, by design (brief: "Delete or
// change audit log entries" is in Admin's own "Cannot" list).
export async function listAuditLog(req, res) {
  const { entity, action, actor, from, to, page = 1, limit = 50 } = req.query;

  const filter = {};
  if (entity) filter.entity = entity;
  if (action) filter.action = action;
  if (actor) filter.actor = actor;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ entries, total, page: Number(page), limit: Number(limit) });
}