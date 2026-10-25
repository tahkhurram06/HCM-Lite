import mongoose from "mongoose";

const leaveTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // e.g. "annual", "sick", "casual", "unpaid"
    // null/undefined quota = unlimited (used for "unpaid")
    yearlyQuota: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Default leave types per the brief's business rules (Section 3, M5).
// Called once from first-run setup; safe to call again (upserts).
leaveTypeSchema.statics.seedDefaults = async function () {
  const defaults = [
    { name: "annual", yearlyQuota: 14 },
    { name: "sick", yearlyQuota: 8 },
    { name: "casual", yearlyQuota: 10 },
    { name: "unpaid", yearlyQuota: null },
  ];
  for (const d of defaults) {
    await this.updateOne({ name: d.name }, { $setOnInsert: d }, { upsert: true });
  }
};

export default mongoose.model("LeaveType", leaveTypeSchema);