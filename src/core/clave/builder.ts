import { Meter } from "../types";

export function sumGroups(groups: number[]): number {
  return groups.reduce((total, value) => total + value, 0);
}

export function remainingTicks(meter: Meter, groups: number[]): number {
  return meter.n - sumGroups(groups);
}

export function canAddGroup(meter: Meter, groups: number[], value: number): boolean {
  return remainingTicks(meter, groups) - value >= 0;
}

export function addGroup(meter: Meter, groups: number[], value: number): number[] {
  if (!canAddGroup(meter, groups, value)) return groups;
  return [...groups, value];
}

export function undoGroup(groups: number[]): number[] {
  if (groups.length === 0) return groups;
  return groups.slice(0, -1);
}

export function resetGroups(): number[] {
  return [];
}
