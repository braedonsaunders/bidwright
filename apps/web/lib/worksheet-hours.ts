import {
  getExtendedWorksheetHourBreakdown as getDomainExtendedWorksheetHourBreakdown,
  getExtendedWorksheetUnitBreakdown as getDomainExtendedWorksheetUnitBreakdown,
  getWorksheetHourBreakdown as getDomainWorksheetHourBreakdown,
  getWorksheetUnitKind as getDomainWorksheetUnitKind,
  rollupWorksheetUnits as rollupDomainWorksheetUnits,
} from "@bidwright/domain";
import type { EntityCategory, RateSchedule, WorkspaceWorksheetItem } from "@/lib/api";

export type { WorksheetHourBreakdown, WorksheetHourTierBreakdown } from "@bidwright/domain";

export function getWorksheetHourBreakdown(row: WorkspaceWorksheetItem, schedules: RateSchedule[]) {
  return getDomainWorksheetHourBreakdown(row, schedules);
}

export function getExtendedWorksheetHourBreakdown(
  row: WorkspaceWorksheetItem,
  schedules: RateSchedule[],
  quantity = 1,
) {
  return getDomainExtendedWorksheetHourBreakdown(row, schedules, quantity);
}

export function getWorksheetUnitKind(row: WorkspaceWorksheetItem, categories: EntityCategory[]) {
  return getDomainWorksheetUnitKind(row, categories);
}

export function getExtendedWorksheetUnitBreakdown(
  row: WorkspaceWorksheetItem,
  schedules: RateSchedule[],
  categories: EntityCategory[],
  quantity = 1,
) {
  return getDomainExtendedWorksheetUnitBreakdown(row, schedules, categories, quantity);
}

export function rollupWorksheetUnits(
  rows: WorkspaceWorksheetItem[],
  schedules: RateSchedule[],
  categories: EntityCategory[],
) {
  return rollupDomainWorksheetUnits(rows, schedules, categories);
}
