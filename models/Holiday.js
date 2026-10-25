import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true }, // store as UTC midnight for the calendar day
  },
  { timestamps: true }
);

// One holiday per calendar date.
holidaySchema.index({ date: 1 }, { unique: true });

export default mongoose.model("Holiday", holidaySchema);