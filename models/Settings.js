import mongoose from "mongoose";

// Singleton document: there is exactly one Settings row per deployment.
// Created once during first-run setup (see authController.setupAdmin),
// then only ever updated by Admin via PUT /api/org/settings.
const settingsSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },

    // Attendance rules (business rules Section 3 / M2)
    officeStartTime: { type: String, default: "09:00" }, // "HH:mm", 24h
    graceMinutes: { type: Number, default: 15 }, // late after officeStartTime + grace
    halfDayThresholdHours: { type: Number, default: 5 }, // worked hours below this = half_day
    weekendDays: {
      // 0 = Sunday ... 6 = Saturday
      type: [Number],
      default: [0, 6], // Sat-Sun per brief
    },

    // Office geofence for camera/web check-in distance check (Haversine on server)
    officeLocation: {
      lat: { type: Number },
      lng: { type: Number },
      radiusMeters: { type: Number, default: 150 },
    },

    // Only one Settings doc should ever exist; this flags that setup is done.
    setupComplete: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Convenience: fetch the single settings doc (there should only ever be one).
settingsSchema.statics.getSingleton = function () {
  return this.findOne();
};

export default mongoose.model("Settings", settingsSchema);