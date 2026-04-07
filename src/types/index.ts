export type Department = "kitchen" | "bar" | "store" | "snooker" | "waitress";

export type ShiftValue = "3pm" | "6pm" | "8pm" | "off";

export type DayKey =
  | "monday" | "tuesday" | "wednesday" | "thursday"
  | "friday" | "saturday" | "sunday";

export interface Staff {
  id: string;
  name: string;
  department: Department;
  active: boolean;
  created_at?: string;
}

export interface Roster {
  id: string;
  week_start: string;
  generated_at: string;
  is_published: boolean;
}

export interface RosterEntry {
  id: string;
  roster_id: string;
  staff_id: string;
  day: DayKey;
  shift: ShiftValue;
  is_manual_override: boolean;
}

export interface SwapRequest {
  id: string;
  requester_id: string;
  target_id: string;
  requester_entry_id: string;
  target_entry_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export type RosterMap = Record<string, Record<DayKey, ShiftValue>>;

export interface DepartmentConfig {
  department: Department;
  max_off_override: number | null;
  six_pm_quota: number;
}

export const LATE_FRIDAY_DEPTS: Department[] = ["bar", "store", "snooker", "waitress"];
export const EARLY_FRIDAY_DEPTS: Department[] = ["kitchen"];

export const DEPT_LABELS: Record<Department, string> = {
  kitchen:   "Kitchen",
  bar:       "Bar",
  store:     "Store",
  snooker:   "Snooker",
  waitress:  "Waitresses",
};