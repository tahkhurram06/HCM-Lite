import mongoose from "mongoose";

// One payroll record per employee per month. Created as a "draft" by HR's
// POST /api/payroll/run, then locked to "finalized" by Admin's
// PUT /api/payroll/finalize — after that it can never be edited (brief M6).
const payrollSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: Number, required: true, min: 1, max: 12 }, // 1 = January
    year: { type: Number, required: true },

    // Salary structure snapshot at the time this run was generated
    // (Gross = 1.5 x basic: HRA 40% + medical 10%, per the brief).
    basic: { type: Number, required: true },
    hra: { type: Number, required: true },
    medical: { type: Number, required: true },
    grossMonthly: { type: Number, required: true },

    // Attendance/working-day breakdown behind the deduction, for the payslip
    // and for HR to sanity-check the draft before approving it.
    workingDaysInMonth: { type: Number, required: true }, // whole calendar month
    employmentWorkingDays: { type: Number, required: true }, // prorated for joiners/leavers
    absentDays: { type: Number, required: true },
    unpaidLeaveDays: { type: Number, required: true },
    halfDays: { type: Number, required: true },
    deductionDays: { type: Number, required: true }, // absent + unpaid + 0.5*half
    payableDays: { type: Number, required: true },
    perDayRate: { type: Number, required: true },

    earnedGross: { type: Number, required: true }, // perDayRate * payableDays
    annualGrossForTax: { type: Number, required: true }, // grossMonthly * 12, illustrative
    tax: { type: Number, required: true }, // monthly tax (annual slab / 12)
    netPay: { type: Number, required: true }, // earnedGross - tax

    status: { type: String, enum: ["draft", "finalized"], default: "draft" },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    finalizedAt: { type: Date },
  },
  { timestamps: true }
);

// One record per employee per month — re-running HR's draft overwrites this
// via upsert; a finalized record is protected at the controller level.
payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model("Payroll", payrollSchema);