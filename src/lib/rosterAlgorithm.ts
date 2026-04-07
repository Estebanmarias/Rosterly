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
  
  const roster: RosterMap = {};
  for (const s of allStaff) {
    roster[s.id] = {} as Record<DayKey, ShiftValue>;
  }
  
  const offCount: Record<DeptKey, Record<DayKey, number>> = {
    kitchen: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    bar: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    store: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    snooker: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
    waitress: { monday:0, tuesday:0, wednesday:0, thursday:0, friday:0, saturday:0, sunday:0 },
  };
  
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
  
  for (const s of allStaff) {
    if (roster[s.id]["friday"] === SHIFTS.OFF) continue;
    roster[s.id]["friday"] = LATE_FRIDAY_DEPTS.includes(s.department)
      ? SHIFTS.CLOSE
      : SHIFTS.MID;
  }
  
  const workDays = DAYS.filter(d => d !== "friday");
  
  for (const key of deptKeys) {
    const list = byDept[key];
    if (list.length === 0) continue;
    
    const isKitchen = key === "kitchen";
    
    for (const s of list) {
      const availableWorkDays = workDays.filter(d => roster[s.id][d] === undefined);
      
      if (availableWorkDays.length !== 5) {
        throw new Error(`${s.name} has ${availableWorkDays.length} work days, expected 5`);
      }
      
      const sixPmNeeded = isKitchen ? 1 : 2;
      
      const shuffled = shuffle(availableWorkDays);
      for (let i = 0; i < shuffled.length; i++) {
        roster[s.id][shuffled[i]] = i < sixPmNeeded ? SHIFTS.MID : SHIFTS.OPEN;
      }
    }
  }
  
  return roster;
}