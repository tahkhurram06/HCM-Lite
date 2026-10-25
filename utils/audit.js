import AuditLog from "../models/AuditLog.js";

// Call this from a controller right after a create/update/approve/finalize/
// delete action. Never throws into the caller — a logging hiccup should
// never fail the actual request.
//
// user:     req.user (the actor) — must have _id, name, role
// action:   "create" | "update" | "approve" | "reject" | "finalize" | "delete" | "setup" | "run"
// entity:   entity name as a string, e.g. "Employee", "Leave", "Payroll"
// entityId: the affected document's _id (optional for actions with no single record, e.g. "run")
// before:   plain object snapshot pre-change (omit for creates)
// after:    plain object snapshot post-change (omit for deletes)
export async function logAction({ user, action, entity, entityId, before, after }) {
  try {
    await AuditLog.create({
      actor: user._id,
      actorName: user.name,
      actorRole: user.role,
      action,
      entity,
      entityId,
      before: before ?? undefined,
      after: after ?? undefined,
    });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
}