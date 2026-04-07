export function getMaxOffPerDay(staffCount: number, dept?: string): number {
  if (dept === "waitress") return Math.max(1, Math.floor(staffCount / 2.5));
  return Math.max(1, Math.floor(staffCount / 2));
}

export function getMax6pmPerDay(workingCount: number, dept?: string): number {
  if (!dept || dept === "kitchen") {
    if (workingCount <= 1) return workingCount;
    if (workingCount === 2) return 0;
    return workingCount - 2;
  }
  return Math.floor(workingCount / 2);
}