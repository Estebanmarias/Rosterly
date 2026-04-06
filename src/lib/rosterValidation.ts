import { RosterEntry, ShiftValue, DayKey, Staff } from "@/types";

const OFF_ELIGIBLE_DAYS: DayKey[] = ["monday", "tuesday", "wednesday", "thursday", "saturday"];

export function getMaxOffPerDay(staffCount: number): number {
  return Math.max(1, Math.floor(staffCount / 3));
}

// Check if a swap between two entries is valid
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

  if (!requester || !target) {
    return { valid: false, reason: "Staff member not found." };
  }

  if (requester.department !== target.department) {
    return { valid: false, reason: "Cannot swap shifts across departments." };
  }

  const requesterDay = requesterEntry.day;
  const targetDay    = targetEntry.day;

  // If either shift being swapped is "off", validate the off-day constraints
  if (requesterEntry.shift === "off" || targetEntry.shift === "off") {

    // Off days cannot land on Friday or Sunday
    if (requesterEntry.shift === "off" && !OFF_ELIGIBLE_DAYS.includes(targetDay)) {
      return {
        valid: false,
        reason: `Off days cannot fall on ${targetDay}.`,
      };
    }
    if (targetEntry.shift === "off" && !OFF_ELIGIBLE_DAYS.includes(requesterDay)) {
      return {
        valid: false,
        reason: `Off days cannot fall on ${requesterDay}.`,
      };
    }

    // Check off-day cap on the receiving day
    const dept = requester.department;
    const deptStaff = allStaff.filter(s => s.department === dept);
    const maxOff = getMaxOffPerDay(deptStaff.length);

    // If requester's "off" moves to targetDay, check cap on targetDay
    if (requesterEntry.shift === "off") {
      const offOnTargetDay = allEntries.filter(
        e =>
          e.shift === "off" &&
          e.day === targetDay &&
          e.id !== requesterEntry.id &&
          allStaff.find(s => s.id === e.staff_id)?.department === dept
      ).length;

      if (offOnTargetDay >= maxOff) {
        return {
          valid: false,
          reason: `Max off limit (${maxOff}) already reached for ${dept} on ${targetDay}.`,
        };
      }
    }

    // If target's "off" moves to requesterDay, check cap on requesterDay
    if (targetEntry.shift === "off") {
      const offOnRequesterDay = allEntries.filter(
        e =>
          e.shift === "off" &&
          e.day === requesterDay &&
          e.id !== targetEntry.id &&
          allStaff.find(s => s.id === e.staff_id)?.department === dept
      ).length;

      if (offOnRequesterDay >= maxOff) {
        return {
          valid: false,
          reason: `Max off limit (${maxOff}) already reached for ${dept} on ${requesterDay}.`,
        };
      }
    }
  }

  // Friday rule — can't swap away a correctly assigned Friday shift
  if (requesterEntry.day === "friday" || targetEntry.day === "friday") {
    const expectedFridayShift = (dept: string): ShiftValue =>
      dept === "waitress" ? "8pm" : "6pm";

    if (requesterEntry.day === "friday" && targetEntry.shift !== expectedFridayShift(requester.department)) {
      return {
        valid: false,
        reason: `Friday shifts for ${requester.department} must stay as ${expectedFridayShift(requester.department)}.`,
      };
    }
    if (targetEntry.day === "friday" && requesterEntry.shift !== expectedFridayShift(target.department)) {
      return {
        valid: false,
        reason: `Friday shifts for ${target.department} must stay as ${expectedFridayShift(target.department)}.`,
      };
    }
  }

  return { valid: true };
}

// Check if a manual override on a single cell is valid
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
    const expected: ShiftValue = staff.department === "waitress" ? "8pm" : "6pm";
    if (newShift !== expected && newShift !== "off") {
      return {
        valid: false,
        reason: `Friday shifts for ${staff.department} must be ${expected} or off.`,
      };
    }
  }

  // Off day constraints
  if (newShift === "off") {
    if (!OFF_ELIGIBLE_DAYS.includes(entry.day)) {
      return { valid: false, reason: `Off days cannot fall on ${entry.day}.` };
    }

    const deptStaff = allStaff.filter(s => s.department === staff.department);
    const maxOff = getMaxOffPerDay(deptStaff.length);
    const offCount = allEntries.filter(
      e =>
        e.shift === "off" &&
        e.day === entry.day &&
        e.id !== entry.id &&
        allStaff.find(s => s.id === e.staff_id)?.department === staff.department
    ).length;

    if (offCount >= maxOff) {
      return {
        valid: false,
        reason: `Max off limit (${maxOff}) already reached for ${staff.department} on ${entry.day}.`,
      };
    }
  }

  return { valid: true };
}