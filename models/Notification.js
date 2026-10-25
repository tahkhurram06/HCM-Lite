import mongoose from "mongoose";

// One row per user per event. Created automatically by the system
// (leave decisions, payslip finalization) — never by a direct user action.
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["leave_decision", "payslip_ready", "correction_decision"],
      required: true,
    },
    message: { type: String, required: true },
    relatedEntity: { type: String }, // "Leave" | "Payroll" | "Attendance"
    relatedId: { type: mongoose.Schema.Types.ObjectId },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);