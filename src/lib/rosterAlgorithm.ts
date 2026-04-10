import { Staff, ShiftValue, DayKey, RosterMap, LATE_FRIDAY_DEPTS } from "@/types";

export const DAYS: DayKey[] = [
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
];

export const OFF_ELIGIBLE_DAYS: DayKey[] = ["monday","tuesday","thursday","saturday"];

const MONDAY_WEIGHT = 0.20;
const SHIFTS = { OFF: "off", OPEN: "3pm", MID: "6pm", CLOSE: "8pm" } as const;

type DeptKey = "kitchen" | "bar" | "store" | "snooker" | "waitress";

// --- Scaling rules ---
function deptMaxOffPerDay(dept: DeptKey, count: number): number {
  if (dept === "waitress") return Math.max(1, Math.floor(count / 2.5));
  return Math.max(1, Math.floor(count / 2));
}

// Universal: floor(working / 2) get 6pm, rest get 3pm
function sixPmForWorking(working: number): number {
  return Math.floor(working / 2);
}

// --- Helpers ---
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWeightedOffDay(available: DayKey[]): DayKey {
  if (available.length === 1) return available[0];
  const hasMonday = available.includes("monday");
  const nonMonday = available.filter(d => d !== "monday");
  const weights: { day: DayKey; weight: number }[] = [];
  if (hasMonday) weights.push({ day: "monday", weight: MONDAY_WEIGHT });
  const nonMondayWeight = hasMonday
    ? (1 - MONDAY_WEIGHT) / nonMonday.length
    : 1 / nonMonday.length;
  for (const d of nonMonday) weights.push({ day: d, weight: nonMondayWeight });
  const rand = Math.random();
  let cumulative = 0;
  for (const { day, weight } of weights) {
    cumulative += weight;
    if (rand <= cumulative) return day;
  }
  return weights[weights.length - 1].day;
}

// --- Main generator ---
export function generateRoster(allStaff: Staff[]): RosterMap {
  const deptKeys: DeptKey[] = ["kitchen", "bar", "store", "snooker", "waitress"];

  const byDept: Record<DeptKey, Staff[]> = {
    kitchen: [], bar: [], store: [], snooker: [], waitress: [],
  };
  for (const s of allStaff) {
    if (byDept[s.department as DeptKey]) byDept[s.department as DeptKey].push(s);
  }

  // Validate capacity
  for (const key of deptKeys) {
    const list = byDept[key];
    if (list.length === 0) continue;
    const maxOff = deptMaxOffPerDay(key, list.length);
    const capacity = maxOff * OFF_ELIGIBLE_DAYS.length;
    if (list.length > capacity) {
      throw new Error(
        `${key} has ${list.length} staff but only ${capacity} off-slots available. ` +
        `Increase team size or contact admin.`
      );
    }
  }

  // Init roster
  const roster: RosterMap = {};
  for (const s of allStaff) {
    roster[s.id] = {} as Record<DayKey, ShiftValue>;
  }

  // Track off counts per dept per day
  const offCount: Record<DeptKey, Record<DayKey, number>> = {} as never;
  for (const key of deptKeys) {
    offCount[key] = Object.fromEntries(DAYS.map(d => [d, 0])) as Record<DayKey, number>;
  }

  // --- Step 2: Assign off days (weighted, Monday rare) ---
  for (const key of deptKeys) {
    const list = shuffle(byDept[key]);
    if (list.length === 0) continue;
    const maxOff = deptMaxOffPerDay(key, list.length);

    for (const s of list) {
      const available = OFF_ELIGIBLE_DAYS.filter(d => offCount[key][d] < maxOff);
      if (available.length === 0) {
        throw new Error(`Cannot assign off day for ${s.name} — all eligible days at capacity.`);
      }
      const day = pickWeightedOffDay(available);
      roster[s.id][day] = SHIFTS.OFF;
      offCount[key][day]++;
    }
  }

  // --- Step 3: Friday rule ---
  for (const s of allStaff) {
    if (roster[s.id]["friday"] === SHIFTS.OFF) continue;
    roster[s.id]["friday"] = LATE_FRIDAY_DEPTS.includes(s.department)
      ? SHIFTS.CLOSE  // 8pm
      : SHIFTS.MID;   // 6pm (kitchen)
  }

  // --- Steps 4 & 5: Assign 6pm and 3pm day-by-day to enforce daily cap ---
  // Process each non-Friday day per department so floor(working/2) is respected
  const workDays = DAYS.filter(d => d !== "friday");

  // For kitchen: weekly 6pm quota is 1 (Friday already gives the 2nd)
  // For others: weekly 6pm quota is 2
  const weeklyQuota: Record<DeptKey, number> = {
    kitchen: 1,
    bar: 2,
    store: 2,
    snooker: 2,
    waitress: 2,
  };

  for (const key of deptKeys) {
    const list = byDept[key];
    if (list.length === 0) continue;

    const quota = weeklyQuota[key];

    // Track how many 6pm shifts assigned per person this week
    const sixPmAssigned: Record<string, number> = {};
    for (const s of list) sixPmAssigned[s.id] = 0;

    // Process day by day
    for (const day of workDays) {
      // Who is working today (not off)
      const working = list.filter(s => roster[s.id][day] === undefined);
      if (working.length === 0) continue;

      // How many 6pm slots available today
      const sixPmSlots = sixPmForWorking(working.length);

      // Prioritize staff who still need 6pm shifts
      const needsSixPm = shuffle(working.filter(s => sixPmAssigned[s.id] < quota));
      const doesntNeed = shuffle(working.filter(s => sixPmAssigned[s.id] >= quota));

      // Fill 6pm slots from those who need it first
      const sixPmPool = [...needsSixPm, ...doesntNeed];
      let sixPmGiven = 0;

      for (const s of sixPmPool) {
        if (sixPmGiven < sixPmSlots && sixPmAssigned[s.id] < quota) {
          roster[s.id][day] = SHIFTS.MID;
          sixPmAssigned[s.id]++;
          sixPmGiven++;
        } else {
          roster[s.id][day] = SHIFTS.OPEN;
        }
      }
    }
  }

  // Verify weekly bucket for every staff member
  for (const s of allStaff) {
    const shifts = Object.values(roster[s.id]);
    const offCount   = shifts.filter(v => v === "off").length;
    const sixPmCount = shifts.filter(v => v === "6pm").length;
    const eightPm    = shifts.filter(v => v === "8pm").length;

    if (offCount !== 1)
      console.warn(`${s.name}: expected 1 off, got ${offCount}`);
    if (eightPm > 1)
      console.warn(`${s.name}: expected max 1× 8pm, got ${eightPm}`);

    // Kitchen gets 2× 6pm total (1 from Mon-Sat pool + Friday)
    // All others get 2× 6pm from Mon-Sat pool only (Friday is 8pm)
    const expected6pm = 2;
    if (sixPmCount !== expected6pm)
      console.warn(`${s.name} (${s.department}): expected ${expected6pm}× 6pm, got ${sixPmCount}`);
  }

  return roster;
}