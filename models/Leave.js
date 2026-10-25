import mongoose from "mongoose";

const leaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    leaveType: { type: String, required: true }, // matches LeaveType.name, e.g. "annual"

    startDate: { type: Date, required: true }, // stored as UTC midnight
    endDate: { type: Date, required: true },

    // Working days in [startDate, endDate], excluding weekends/holidays —
    // this is what counts against the yearly quota, not the raw calendar span.
    days: { type: Number, required: true },

    reason: { type: String },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewComment: { type: String },

    // Set when the request was parsed from the AI "smart leave" feature (M8),
    // so the UI/AI can label it. Not required for manual applications.
    source: { type: String, enum: ["manual", "smart"], default: "manual" },
  },
  { timestamps: true }
);

leaveSchema.index({ employee: 1, startDate: 1, endDate: 1 });

export default mongoose.model("Leave", leaveSchema);