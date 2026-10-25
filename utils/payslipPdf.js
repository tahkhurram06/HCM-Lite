import PDFDocument from "pdfkit";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Builds a simple one-page payslip PDF and returns the PDFDocument stream —
// caller pipes it to the HTTP response (see payrollController.downloadPayslip).
export function generatePayslipPDF(payroll) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const emp = payroll.employee;

  doc.fontSize(20).font("Helvetica-Bold").text("Payslip", { align: "center" });
  doc.moveDown(0.3);
  doc
    .fontSize(11)
    .font("Helvetica")
    .text(`${MONTH_NAMES[payroll.month - 1]} ${payroll.year}`, { align: "center" });
  doc.moveDown(1.5);

  doc.fontSize(12).font("Helvetica-Bold").text("Employee");
  doc.fontSize(10).font("Helvetica");
  doc.text(`Name: ${emp.name}`);
  doc.text(`Employee code: ${emp.code}`);
  doc.text(`Department: ${emp.department}`);
  doc.text(`Designation: ${emp.designation}`);
  doc.moveDown(1);

  doc.fontSize(12).font("Helvetica-Bold").text("Earnings");
  doc.fontSize(10).font("Helvetica");
  doc.text(`Basic: ${payroll.basic.toLocaleString()}`);
  doc.text(`HRA (40%): ${payroll.hra.toLocaleString()}`);
  doc.text(`Medical (10%): ${payroll.medical.toLocaleString()}`);
  doc.text(`Gross (full month): ${payroll.grossMonthly.toLocaleString()}`);
  doc.moveDown(1);

  doc.fontSize(12).font("Helvetica-Bold").text("Attendance for the period");
  doc.fontSize(10).font("Helvetica");
  doc.text(`Working days in month: ${payroll.workingDaysInMonth}`);
  doc.text(`Employment working days: ${payroll.employmentWorkingDays}`);
  doc.text(`Absent days: ${payroll.absentDays}`);
  doc.text(`Unpaid leave days: ${payroll.unpaidLeaveDays}`);
  doc.text(`Half days: ${payroll.halfDays}`);
  doc.text(`Payable days: ${payroll.payableDays}`);
  doc.moveDown(1);

  doc.fontSize(12).font("Helvetica-Bold").text("Deductions & Net Pay");
  doc.fontSize(10).font("Helvetica");
  doc.text(`Earned gross: ${payroll.earnedGross.toLocaleString()}`);
  doc.text(`Tax (monthly): ${payroll.tax.toLocaleString()}`);
  doc.moveDown(0.3);
  doc.fontSize(13).font("Helvetica-Bold").text(`Net pay: ${payroll.netPay.toLocaleString()}`);

  doc.moveDown(2);
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("gray")
    .text(
      `Status: ${payroll.status.toUpperCase()} — system-generated payslip, HCM Lite.`,
      { align: "center" }
    );

  doc.end();
  return doc;
}