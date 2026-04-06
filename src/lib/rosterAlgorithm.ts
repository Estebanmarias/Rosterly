import { Staff, ShiftValue, DayKey, RosterMap } from "@/types";

export const DAYS: DayKey[] = [
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
];

const SHIFTS = { OFF: "off", OPEN: "3pm", MID: "6pm", CLOSE: "8pm" } as const;

// --- Scaling rules (derived, never hardcoded) ---
export function getMaxOffPerDay(staffCount: number): number {
  return Math.max(1, Math.floor(staffCount / 3));
}

// 6pm quota stays fixed per person — it's a fairness rule
export const SIX_PM_QUOTA = 3;

// --- Helpers ---
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sample<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

// --- Main generator ---
export function generateRoster(allStaff: Staff[]): RosterMap {
  const kitchen = shuffle(allStaff.filter(s => s.department === "kitchen"));
  const waitress = shuffle(allStaff.filter(s => s.department === "waitress"));

  const kitchenMaxOff = getMaxOffPerDay(kitchen.length);
  const waitressMaxOff = getMaxOffPerDay(waitress.length);

  // Failsafe: check capacity before running
  const OFF_ELIGIBLE_DAYS = 5; // Mon, Tue, Wed, Thu, Sat — Fri and Sun excluded
  const kitchenCapacity = kitchenMaxOff * OFF_ELIGIBLE_DAYS;
  const waitressCapacity = waitressMaxOff * OFF_ELIGIBLE_DAYS;

  if (kitchen.length > kitchenCapacity) {
    throw new Error(
      `Kitchen has ${kitchen.length} staff but only ${kitchenCapacity} off-slots across the week. Increase max off days or hire fewer staff.`
    );
  }
  if (waitress.length > waitressCapacity) {
    throw new Error(
      `Waitress team has ${waitress.length} staff but only ${waitressCapacity} off-slots. Increase max off days or hire fewer staff.`
    );
  }

  // roster[staffId][day] = shift
  const roster: RosterMap = {};
  for (const s of allStaff) {
    roster[s.id] = {} as Record<DayKey, ShiftValue>;
  }

  // Track how many are off per day per department
  const offCount: Record<"kitchen" | "waitress", Record<DayKey, number>> = {
    kitchen: Object.fromEntries(DAYS.map(d => [d, 0])) as Record<DayKey, number>,
    waitress: Object.fromEntries(DAYS.map(d => [d, 0])) as Record<DayKey, number>,
  };

  // --- Step 2: Assign Off days ---
  function assignOff(staffList: Staff[], maxOff: number, dept: "kitchen" | "waitress") {
    for (const s of staffList) {
      const available = DAYS.filter(d => d !== "friday" && d !== "sunday" && offCount[dept][d] < maxOff);
      if (available.length === 0) {
        throw new Error(`Cannot assign off day for ${s.name} — all days are at max capacity.`);
      }
      const day = pickRandom(available);
      roster[s.id][day] = SHIFTS.OFF;
      offCount[dept][day]++;
    }
  }

  assignOff(kitchen, kitchenMaxOff, "kitchen");
  assignOff(waitress, waitressMaxOff, "waitress");

  // --- Step 3: Friday rule ---
  for (const s of allStaff) {
    if (roster[s.id]["friday"] === SHIFTS.OFF) continue;
    roster[s.id]["friday"] = s.department === "waitress" ? SHIFTS.CLOSE : SHIFTS.MID;
  }

  // --- Step 4: Distribute 6pm shifts (non-Friday, non-Off days) ---
  for (const s of allStaff) {
    const emptyDays = DAYS.filter(
      d => d !== "friday" && roster[s.id][d] === undefined
    );
    // emptyDays should always be exactly 5 here
    const sixPmDays = sample(emptyDays, SIX_PM_QUOTA);
    for (const d of sixPmDays) {
      roster[s.id][d] = SHIFTS.MID;
    }
  }

  // --- Step 5: Fill remaining gaps with 3pm ---
  for (const s of allStaff) {
    for (const d of DAYS) {
      if (roster[s.id][d] === undefined) {
        roster[s.id][d] = SHIFTS.OPEN;
      }
    }
  }

  return roster;
}