import Leave from "./Leave.js";
import { toDateOnly } from "../utils/workingDays.js";

// Returns a Set of employee id strings who have an APPROVED leave covering
// the given date, for a list of candidate employee ids. Used by the
// attendance board/calendar so leave days don't show as "absent".
export async function getApprovedLeaveEmployeeIds(employeeIds, date) {
  const dateOnly = toDateOnly(date);
  const leaves = await Leave.find({
    employee: { $in: employeeIds },
    status: "approved",
    startDate: { $lte: dateOnly },
    endDate: { $gte: dateOnly },
  }).select("employee");
  return new Set(leaves.map((l) => String(l.employee)));
}