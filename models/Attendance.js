import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: { type: Date, required: true }, // calendar day, stored as UTC midnight

    checkIn: {
      time: { type: Date },
      source: { type: String, enum: ["web", "camera"], default: "web" },
      location: {
        lat: Number,
        lng: Number,
      },
    },
    checkOut: {
      time: { type: Date },
      source: { type: String, enum: ["web", "camera"], default: "web" },
      location: {
        lat: Number,
        lng: Number,
      },
    },

    // Set at check-in (late arrival) and finalized at check-out (half_day vs present).
    // "absent" and "missing_checkout" are NOT stored here — they're computed at
    // read time for dates with no record / no checkout (see attendanceController).
    status: {
      type: String,
      enum: ["checked_in", "late", "present", "half_day"],
      default: "checked_in",
    },
    workedHours: { type: Number }, // set at checkout

    correction: {
      requested: { type: Boolean, default: false },
      reason: { type: String },
      requestedCheckIn: { type: Date },
      requestedCheckOut: { type: Date },
      status: { type: String, enum: ["pending", "approved", "rejected"] },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewComment: { type: String },
    },
  },
  { timestamps: true }
);

// One record per employee per day — this is what makes a second check-in
// on the same day a clean duplicate-key error (we turn that into a 409).
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", attendanceSchema);