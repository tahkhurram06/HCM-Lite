import mongoose from "mongoose";

const designationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true, trim: true },
    // Optional: scope a designation to a department (e.g. "Backend Engineer" under Engineering)
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Designation", designationSchema);