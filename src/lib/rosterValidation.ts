import { RosterEntry, ShiftValue, DayKey, Staff, LATE_FRIDAY_DEPTS } from "@/types";
import { getMaxOffPerDay, getMax6pmPerDay } from "@/lib/scalingRules";

const OFF_ELIGIBLE_DAYS: DayKey[] = ["monday", "tuesday", "thursday", "saturday"];

export interface SwapValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateSwap(
  requesterEntry: RosterEntry,
  targetEntry: RosterEntry,
  allEntries: RosterEntry[],
  allStaff: Staff[],
): SwapValidationResult {

  const requester = allStaff.find(s => s.id === requesterEntry.staff_id);
  const target    = allStaff.find(s => s.id === targetEntry.staff_id);

  if (!requester || !target) return { valid: false, reason: "Staff member not found." };

  if (requester.department !== target.department) {
    return { valid: false, reason: "Cannot swap shifts across departments." };
  }

  const dept = requester.department;
  const requesterDay = requesterEntry.day;
  const targetDay    = targetEntry.day;

  // Off day constraints
  if (requesterEntry.shift === "off" || targetEntry.shift === "off") {
    if (requesterEntry.shift === "off" && !OFF_ELIGIBLE_DAYS.includes(targetDay)) {
      return { valid: false, reason: `Off days cannot fall on ${targetDay}.` };
    }
    if (targetEntry.shift === "off" && !OFF_ELIGIBLE_DAYS.includes(requesterDay)) {
      return { valid: false, reason: `Off days cannot fall on ${requesterDay}.` };
    }

    const deptStaff = allStaff.filter(s => s.department === dept);
    const maxOff = getMaxOffPerDay(deptStaff.length);

    if (requesterEntry.shift === "off") {
      const offOnTargetDay = allEntries.filter(
        e => e.shift === "off" && e.day === targetDay && e.id !== requesterEntry.id &&
          allStaff.find(s => s.id === e.staff_id)?.department === dept
      ).length;
      if (offOnTargetDay >= maxOff) {
        return { valid: false, reason: `Max off limit (${maxOff}) already reached for ${dept} on ${targetDay}.` };
      }
    }

    if (targetEntry.shift === "off") {
      const offOnRequesterDay = allEntries.filter(
        e => e.shift === "off" && e.day === requesterDay && e.id !== targetEntry.id &&
          allStaff.find(s => s.id === e.staff_id)?.department === dept
      ).length;
      if (offOnRequesterDay >= maxOff) {
        return { valid: false, reason: `Max off limit (${maxOff}) already reached for ${dept} on ${requesterDay}.` };
      }
    }
  }

  // Friday rule
  if (requesterEntry.day === "friday" || targetEntry.day === "friday") {
    const expectedFridayShift = (d: string): ShiftValue =>
      LATE_FRIDAY_DEPTS.includes(d as typeof LATE_FRIDAY_DEPTS[number]) ? "8pm" : "6pm";

    if (requesterEntry.day === "friday" && targetEntry.shift !== expectedFridayShift(requester.department)) {
      return { valid: false, reason: `Friday shifts for ${dept} must stay as ${expectedFridayShift(requester.department)}.` };
    }
    if (targetEntry.day === "friday" && requesterEntry.shift !== expectedFridayShift(target.department)) {
      return { valid: false, reason: `Friday shifts for ${dept} must stay as ${expectedFridayShift(target.department)}.` };
    }
  }

  return { valid: true };
}

export function validateOverride(
  entry: RosterEntry,
  newShift: ShiftValue,
  allEntries: RosterEntry[],
  allStaff: Staff[],
): SwapValidationResult {

  const staff = allStaff.find(s => s.id === entry.staff_id);
  if (!staff) return { valid: false, reason: "Staff member not found." };

  // Friday rule
  if (entry.day === "friday") {
    const expected: ShiftValue = LATE_FRIDAY_DEPTS.includes(staff.department) ? "8pm" : "6pm";
    if (newShift !== expected && newShift !== "off") {
      return { valid: false, reason: `Friday shifts for ${staff.department} must be ${expected} or off.` };
    }
  }

  // Off day constraints
  if (newShift === "off") {
    if (!OFF_ELIGIBLE_DAYS.includes(entry.day)) {
      return { valid: false, reason: `Off days can only fall on Monday, Tuesday, Thursday or Saturday.` };
    }
    const deptStaff = allStaff.filter(s => s.department === staff.department);
    const maxOff = getMaxOffPerDay(deptStaff.length, staff.department);
    const offCount = allEntries.filter(
      e => e.shift === "off" && e.day === entry.day && e.id !== entry.id &&
        allStaff.find(s => s.id === e.staff_id)?.department === staff.department
    ).length;
    if (offCount >= maxOff) {
      return { valid: false, reason: `Max off limit (${maxOff}) already reached for ${staff.department} on ${entry.day}.` };
    }
  }

  // 6pm daily cap
  if (newShift === "6pm" && entry.day !== "friday") {
    const deptStaff = allStaff.filter(s => s.department === staff.department);
    const max6pm = getMax6pmPerDay(deptStaff.length);
    const sixPmCount = allEntries.filter(
      e => e.shift === "6pm" && e.day === entry.day && e.id !== entry.id &&
        allStaff.find(s => s.id === e.staff_id)?.department === staff.department
    ).length;
    if (sixPmCount >= max6pm) {
      return { valid: false, reason: `Max 6pm limit (${max6pm}) already reached for ${staff.department} on ${entry.day}.` };
    }
  }

  return { valid: true };
}