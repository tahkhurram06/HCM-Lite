import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // employee ID, e.g. EMP001
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String },
    address: { type: String },

    department: { type: String, required: true },
    designation: { type: String, required: true },
    dateOfJoining: { type: Date, required: true },
    dateOfLeaving: { type: Date }, // set when offboarded

    // Salary structure (used by M6 Payroll)
    salary: {
      basic: { type: Number, required: true, min: 0 },
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    // Link back to their login account
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

employeeSchema.index({ name: "text", email: "text", code: "text" });

export default mongoose.model("Employee", employeeSchema);
