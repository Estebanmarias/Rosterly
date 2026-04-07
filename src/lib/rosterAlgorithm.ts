import { Staff, ShiftValue, DayKey, RosterMap, LATE_FRIDAY_DEPTS } from "@/types";

export const DAYS: DayKey[] = [
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
];

export const OFF_ELIGIBLE_DAYS: DayKey[] = ["monday","tuesday","thursday","saturday"];

const MONDAY_WEIGHT = 0.20;
const SHIFTS = { OFF: "off", OPEN: "3pm", MID: "6pm", CLOSE: "8pm" } as const;

type DeptKey = "kitchen" | "bar" | "store" | "snooker" | "waitress";

function deptMaxOffPerDay(dept: DeptKey, count: number): number {
  if (dept === "waitress") return Math.max(1, Math.floor(count / 2.5));
  return Math.max(1, Math.floor(count / 2));
}

// Daily 6pm cap: Kitchen needs at least 2x 3pm, others use floor(working/2)
function getMax6pmPerDay(dept: DeptKey, working: number): number {
  if (working <= 0) return 0;
  if (dept === "kitchen") {
    // At least 2 must be on 3pm, so max 6pm = working - 2
    // But if working <= 2, we relax to allow the weekly bucket to work
    if (working === 1) return 1; // Can be 3pm or 6pm
    if (working === 2) return 0; // Both must be 3pm (prep requirement)
    return working - 2; // 3 working = 1x 6pm, 4 working = 2x 6pm, etc.
  }
  // All other departments: floor(working/2)
  return Math.floor(working / 2);
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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateRoster(allStaff: Staff[]): RosterMap {
  const deptKeys: DeptKey[] = ["kitchen", "bar", "store", "snooker", "waitress"];
  
  const byDept: Record<DeptKey, Staff[]> = {
    kitchen: [], bar: [], store: [], snooker: [], waitress: []
  };
  
  for (const s of allStaff) {
    if (byDept[s.department]) {
      byDept[s.department].push(s);
    }
  }
  
  // Validate capacity
  for (const key of deptKeys) {
    const list = byDept[key];
    if (list.length === 0) continue;
    
    const maxOff = deptMaxOffPerDay(key, list.length);
    const capacity = maxOff * OFF_ELIGIBLE_DAYS.length;
    
    if (list.length > capacity) {
      throw new Error(
        `${key} has ${list.length} staff but only ${capacity} off-slots.`
      );
    }
  }
  
  // Init roster
  const roster: RosterMap = {};
  for (const s of allStaff) {
    roster[s.id] = {} as Record<DayKey, ShiftValue>;
  }
  
  // Track off counts per dept per day
  const offCount: Record<DeptKey, Record<DayKey, number>> = {
    kitchen: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    bar: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    store: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    snooker: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    waitress: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
  };
  
  // --- Step 1: Assign Off days ---
  for (const key of deptKeys) {
    const list = shuffle(byDept[key]);
    if (list.length === 0) continue;
    
    const maxOff = deptMaxOffPerDay(key, list.length);
    
    for (const s of list) {
      const available = OFF_ELIGIBLE_DAYS.filter(d => offCount[key][d] < maxOff);
      if (available.length === 0) {
        throw new Error(`Cannot assign off day for ${s.name} — capacity exceeded.`);
      }
      const day = pickWeightedOffDay(available);
      roster[s.id][day] = SHIFTS.OFF;
      offCount[key][day]++;
    }
  }
  
  // --- Step 2: Assign Friday shifts ---
  for (const s of allStaff) {
    if (roster[s.id]["friday"] === SHIFTS.OFF) continue;
    roster[s.id]["friday"] = LATE_FRIDAY_DEPTS.includes(s.department)
      ? SHIFTS.CLOSE
      : SHIFTS.MID;
  }
  
  // Replace Step 3 in rosterAlgorithm.ts with this:

  // --- Step 3: Assign Mon-Sat (excluding Friday) with daily 6pm caps ---
  const workDays = DAYS.filter(d => d !== "friday");
  
  // Everyone needs 2× 6pm weekly. Kitchen gets 1 from Friday, 1 from pool.
  // Others get 0 from Friday (it's 8pm), so 2 from pool.
  const sixPmNeededFromPool: Record<string, number> = {};
  for (const s of allStaff) {
    sixPmNeededFromPool[s.id] = s.department === "kitchen" ? 1 : 2;
  }
  
  // Track how many 6pm assigned from pool so far
  const poolSixPmCount: Record<string, number> = {};
  for (const s of allStaff) poolSixPmCount[s.id] = 0;
  
  // First pass: calculate available 6pm slots per day and ensure feasibility
  const daySlots: { day: DayKey; dept: DeptKey; staff: Staff[]; maxSixPm: number }[] = [];
  
  for (const day of workDays) {
    for (const key of deptKeys) {
      const list = byDept[key];
      if (list.length === 0) continue;
      
      const working = list.filter(s => roster[s.id][day] === undefined);
      if (working.length === 0) continue;
      
      const maxSixPm = getMax6pmPerDay(key, working.length);
      daySlots.push({ day, dept: key, staff: working, maxSixPm });
    }
  }
  
  // Sort days by fewest slots first (hardest to fill), then assign greedily
  daySlots.sort((a, b) => a.maxSixPm - b.maxSixPm);
  
  for (const slot of daySlots) {
    const { day, dept, staff: working, maxSixPm } = slot;
    
    if (maxSixPm === 0) {
      // All must be 3pm
      for (const s of working) {
        roster[s.id][day] = SHIFTS.OPEN;
      }
      continue;
    }
    
    // Sort by who needs 6pm most (descending need), shuffle for randomness
    const shuffled = shuffle(working);
    shuffled.sort((a, b) => {
      const needA = sixPmNeededFromPool[a.id] - poolSixPmCount[a.id];
      const needB = sixPmNeededFromPool[b.id] - poolSixPmCount[b.id];
      return needB - needA; // Descending (most need first)
    });
    
    // Assign 6pm to those with highest need, up to max allowed
    let assignedSixPm = 0;
    for (const s of shuffled) {
      const stillNeeds = poolSixPmCount[s.id] < sixPmNeededFromPool[s.id];
      
      if (assignedSixPm < maxSixPm && stillNeeds) {
        roster[s.id][day] = SHIFTS.MID;
        poolSixPmCount[s.id]++;
        assignedSixPm++;
      } else {
        roster[s.id][day] = SHIFTS.OPEN;
      }
    }
  }
  
    // --- Step 4: Validate weekly buckets ---
  for (const s of allStaff) {
    let offCount = 0, sixPmCount = 0, threePmCount = 0, fridayCount = 0;
    
    for (const day of DAYS) {
      const shift = roster[s.id][day];
      if (shift === "off") offCount++;
      if (day === "friday" && shift !== "off") fridayCount++;
      if (shift === "6pm") sixPmCount++;
      if (shift === "3pm") threePmCount++;
    }
    
    // Kitchen: Fri=6pm, so 1 from pool. Others: Fri=8pm, so 2 from pool.
    const expectedSixPm = 2;
    const expectedThreePm = s.department === "kitchen" ? 4 : 3;
    
    if (offCount !== 1) throw new Error(`${s.name}: expected 1 off, got ${offCount}`);
    if (fridayCount !== 1) throw new Error(`${s.name}: expected 1 Friday shift, got ${fridayCount}`);
    if (sixPmCount !== expectedSixPm) throw new Error(`${s.name}: expected ${expectedSixPm}× 6pm, got ${sixPmCount}`);
    if (threePmCount !== expectedThreePm) throw new Error(`${s.name}: expected ${expectedThreePm}× 3pm, got ${threePmCount}`);
  }
  
  return roster;
}