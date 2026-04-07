// Max off per day — used by validation
export function getMaxOffPerDay(staffCount: number, dept?: string): number {
  if (dept === "waitress") return Math.max(1, Math.floor(staffCount / 2.5));
  return Math.max(1, Math.floor(staffCount / 2));
}

// Max 6pm per day — floor(working / 2), universal rule
export function getMax6pmPerDay(workingCount: number): number {
  return Math.floor(workingCount / 2);
}