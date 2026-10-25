import mongoose from "mongoose";

// Append-only trail of every important action in the system — who did what,
// to which record, and the before/after state. Admin can view (read-only);
// nobody can edit or delete entries (brief M9 / "Cannot" list for Admin).
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true }, // snapshot, survives the user being deactivated later
    actorRole: { type: String, required: true },

    action: { type: String, required: true }, // "create" | "update" | "approve" | "reject" | "finalize" | "delete" | "setup" | "run"
    entity: { type: String, required: true }, // e.g. "Employee", "Leave", "Payroll", "Settings"
    entityId: { type: mongoose.Schema.Types.ObjectId },

    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });

export default mongoose.model("AuditLog", auditLogSchema);