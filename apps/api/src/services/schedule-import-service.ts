import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { prisma, type Prisma } from "@bidwright/db";
import { resolveApiPath } from "../paths.js";
import { resolveProjectFileIngestSource } from "./file-ingest-service.js";
import type { FileIngestSourceKind } from "./file-ingest/types.js";

const execFileAsync = promisify(execFile);
const SUPPORTED_FORMATS = new Set(["mpp", "mpt", "mpx", "xml", "xer", "p6xml", "pmxml"]);
const MPXJ_BINARY_FORMATS = new Set(["mpp", "mpt"]);
const XML_FORMATS = new Set(["xml", "p6xml", "pmxml"]);

type ScheduleSourceKind = Exclude<FileIngestSourceKind, "raw_file">;

interface ParsedScheduleTask {
  externalId: string;
  parentExternalId?: string | null;
  name: string;
  description?: string;
  taskType?: "task" | "milestone" | "summary";
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  order: number;
  outlineLevel?: number;
  constraintType?: string | null;
  constraintDate?: string | null;
  deadlineDate?: string | null;
}

interface ParsedScheduleDependency {
  predecessorExternalId: string;
  successorExternalId: string;
  type?: string | null;
  lagDays?: number;
}

interface ParsedScheduleResource {
  externalId: string;
  name: string;
  role?: string;
  kind?: "labor" | "crew" | "equipment" | "subcontractor";
}

interface ParsedScheduleAssignment {
  taskExternalId: string;
  resourceExternalId: string;
  units?: number;
  role?: string;
}

interface ParsedSchedule {
  parser: "mpxj" | "mspdi" | "p6xml" | "xer";
  tasks: ParsedScheduleTask[];
  dependencies: ParsedScheduleDependency[];
  resources: ParsedScheduleResource[];
  assignments: ParsedScheduleAssignment[];
  warnings: string[];
}

export interface ScheduleImportCandidate {
  sourceKind: ScheduleSourceKind;
  sourceId: string;
  fileName: string;
  fileType?: string | null;
  format: string;
  size?: number | null;
  storagePath?: string | null;
  provider: "mpxj" | "embedded";
  status: "available" | "missing" | "unsupported" | "degraded" | "failed";
  message: string;
}

export interface ScheduleImportResult {
  imported: {
    parser: ParsedSchedule["parser"];
    sourceKind: ScheduleSourceKind;
    sourceId: string;
    fileName: string;
    taskCount: number;
    dependencyCount: number;
    resourceCount: number;
    assignmentCount: number;
    warnings: string[];
  };
}

function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function extensionOf(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tar.gz")) return "gz";
  return lower.split(".").pop() ?? "";
}

function isSupportedScheduleFile(fileName: string) {
  return SUPPORTED_FORMATS.has(extensionOf(fileName));
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function toDateOnly(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function durationDays(value: unknown, fallbackStart?: string | null, fallbackEnd?: string | null) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const amount = firstNumber(record.value, record.duration);
    const units = firstString(record.units, record.unit).toLowerCase();
    if (amount !== null) {
      if (units.includes("hour")) return Math.max(0, Math.round(amount / 8));
      if (units.includes("minute")) return Math.max(0, Math.round(amount / 480));
      if (units.includes("week")) return Math.max(0, Math.round(amount * 5));
      return Math.max(0, Math.round(amount));
    }
  }
  const text = firstString(value);
  const iso = text.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (iso) {
    const days = Number(iso[1] ?? 0);
    const hours = Number(iso[2] ?? 0);
    const minutes = Number(iso[3] ?? 0);
    return Math.max(0, Math.round(days + hours / 8 + minutes / 480));
  }
  const number = firstNumber(text);
  if (number !== null) return Math.max(0, Math.round(number));
  if (fallbackStart && fallbackEnd) {
    const start = new Date(fallbackStart);
    const end = new Date(fallbackEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    }
  }
  return 0;
}

function normalizeProgress(value: unknown) {
  const number = firstNumber(value);
  if (number === null) return 0;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function taskStatus(progress: number) {
  if (progress >= 0.995) return "complete";
  if (progress > 0) return "in_progress";
  return "not_started";
}

function normalizeDependencyType(value: unknown) {
  const text = firstString(value).trim().toUpperCase();
  if (text === "0") return "FF";
  if (text === "2") return "SF";
  if (text === "3") return "SS";
  const raw = text.replace(/[^A-Z]/g, "");
  if (raw.includes("SS")) return "SS";
  if (raw.includes("FF")) return "FF";
  if (raw.includes("SF")) return "SF";
  return "FS";
}

function lagDays(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object") {
    return durationDays(value);
  }
  const number = firstNumber(value);
  if (number === null) return 0;
  return Math.round(number > 24 ? number / 8 : number);
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectJars(directory: string): Promise<string[]> {
  if (!await exists(directory)) return [];
  const output: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...await collectJars(fullPath));
    } else if (entry.name.endsWith(".jar")) {
      output.push(fullPath);
    }
  }
  return output;
}

function bridgeDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "schedule-import", "mpxj-bridge");
}

async function buildMpxjClasspath() {
  const jars = [
    ...await collectJars("/opt/mpxj"),
    ...await collectJars(path.resolve(process.cwd(), "vendor", "mpxj")),
  ];
  return jars.length > 0 ? [bridgeDir(), ...jars].join(path.delimiter) : "";
}

async function ensureMpxjBridge(classpath: string) {
  const classFile = path.join(bridgeDir(), "BidwrightMpxjJson.class");
  if (await exists(classFile)) return true;
  const sourceFile = path.join(bridgeDir(), "BidwrightMpxjJson.java");
  if (!await exists(sourceFile)) return false;
  try {
    await execFileAsync("javac", ["-cp", classpath, sourceFile], { timeout: 20_000 });
    return await exists(classFile);
  } catch {
    return false;
  }
}

async function getMpxjStatus() {
  try {
    await execFileAsync("java", ["-version"], { timeout: 5_000 });
  } catch {
    return { available: false, status: "missing" as const, message: "Java runtime is not available on this server." };
  }
  const classpath = await buildMpxjClasspath();
  if (!classpath) {
    return { available: false, status: "missing" as const, message: "MPXJ runtime jars are not installed on this server." };
  }
  if (!await ensureMpxjBridge(classpath)) {
    return { available: false, status: "failed" as const, message: "MPXJ bridge could not be compiled or loaded." };
  }
  return { available: true, status: "available" as const, message: "MPXJ schedule import is available.", classpath };
}

async function parseWithMpxj(absPath: string): Promise<ParsedSchedule> {
  const status = await getMpxjStatus();
  if (!status.available || !status.classpath) throw new Error(status.message);
  const { stdout } = await execFileAsync("java", ["-cp", status.classpath, "BidwrightMpxjJson", absPath], {
    timeout: 120_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return normalizeMpxjSchedule(JSON.parse(stdout));
}

function normalizeMpxjSchedule(raw: any): ParsedSchedule {
  const tasks = toArray(raw?.tasks).map((task: any, index) => {
    const externalId = firstString(task.uniqueId, task.uniqueID, task.uid, task.id, index + 1);
    const startDate = toDateOnly(task.start);
    const endDate = toDateOnly(task.finish ?? task.end);
    const progress = normalizeProgress(task.percentComplete ?? task.percentageComplete);
    return {
      externalId,
      parentExternalId: firstString(task.parentUniqueId, task.parentUniqueID, task.parentId) || null,
      name: firstString(task.name, task.wbs, `Task ${index + 1}`),
      description: firstString(task.notes),
      taskType: task.summary ? "summary" : task.milestone ? "milestone" : "task",
      startDate,
      endDate,
      duration: durationDays(task.duration, startDate, endDate),
      progress,
      order: index + 1,
      outlineLevel: Math.max(0, (firstNumber(task.outlineLevel) ?? 1) - 1),
      constraintType: mapConstraintType(task.constraintType),
      constraintDate: toDateOnly(task.constraintDate),
      deadlineDate: toDateOnly(task.deadline),
    } satisfies ParsedScheduleTask;
  }).filter((task) => task.name.trim());

  const dependencies = toArray(raw?.dependencies).map((dependency: any) => ({
    predecessorExternalId: firstString(dependency.predecessorUniqueId, dependency.predecessorId),
    successorExternalId: firstString(dependency.successorUniqueId, dependency.successorId),
    type: normalizeDependencyType(dependency.type),
    lagDays: lagDays(dependency.lag),
  })).filter((dependency) => dependency.predecessorExternalId && dependency.successorExternalId);

  const resources = toArray(raw?.resources).map((resource: any, index) => ({
    externalId: firstString(resource.uniqueId, resource.id, index + 1),
    name: firstString(resource.name, `Resource ${index + 1}`),
    role: firstString(resource.group, resource.type),
    kind: resourceKind(resource.type),
  }));

  const assignments = toArray(raw?.assignments).map((assignment: any) => ({
    taskExternalId: firstString(assignment.taskUniqueId, assignment.taskId),
    resourceExternalId: firstString(assignment.resourceUniqueId, assignment.resourceId),
    units: firstNumber(assignment.units) ?? 1,
    role: firstString(assignment.role),
  })).filter((assignment) => assignment.taskExternalId && assignment.resourceExternalId);

  return { parser: "mpxj", tasks, dependencies, resources, assignments, warnings: [] };
}

function mapConstraintType(value: unknown) {
  const raw = firstString(value).toUpperCase();
  if (raw.includes("AS_LATE")) return "alap";
  if (raw.includes("START_NO_EARLIER")) return "snet";
  if (raw.includes("START_NO_LATER")) return "snlt";
  if (raw.includes("FINISH_NO_EARLIER")) return "fnet";
  if (raw.includes("FINISH_NO_LATER")) return "fnlt";
  if (raw.includes("MUST_START")) return "mso";
  if (raw.includes("MUST_FINISH")) return "mfo";
  return "asap";
}

function resourceKind(value: unknown): ParsedScheduleResource["kind"] {
  const raw = firstString(value).toLowerCase();
  if (raw.includes("equipment")) return "equipment";
  if (raw.includes("sub")) return "subcontractor";
  if (raw.includes("crew")) return "crew";
  return "labor";
}

function parseMspdiXml(buffer: Buffer): ParsedSchedule {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, trimValues: true });
  const parsed = parser.parse(buffer.toString("utf8"));
  const project = parsed.Project ?? parsed["Project"] ?? parsed;
  const rawTasks = toArray(project?.Tasks?.Task);
  const rawResources = toArray(project?.Resources?.Resource);
  const rawAssignments = toArray(project?.Assignments?.Assignment);
  const idByUid = new Map<string, string>();

  const tasks = rawTasks
    .filter((task: any) => firstString(task.Name) || firstString(task.UID))
    .map((task: any, index) => {
      const externalId = firstString(task.UID, task.ID, index + 1);
      idByUid.set(externalId, externalId);
      const startDate = toDateOnly(task.Start);
      const endDate = toDateOnly(task.Finish);
      const progress = normalizeProgress(task.PercentComplete);
      return {
        externalId,
        parentExternalId: null,
        name: firstString(task.Name, `Task ${index + 1}`),
        description: firstString(task.Notes),
        taskType: String(task.Summary) === "1" || task.Summary === true ? "summary" : String(task.Milestone) === "1" || task.Milestone === true ? "milestone" : "task",
        startDate,
        endDate,
        duration: durationDays(task.Duration, startDate, endDate),
        progress,
        order: firstNumber(task.ID) ?? index + 1,
        outlineLevel: Math.max(0, (firstNumber(task.OutlineLevel) ?? 1) - 1),
        constraintType: mapMspdiConstraint(task.ConstraintType),
        constraintDate: toDateOnly(task.ConstraintDate),
        deadlineDate: toDateOnly(task.Deadline),
      } satisfies ParsedScheduleTask;
    });

  inferParentsFromOutline(tasks);

  const dependencies = rawTasks.flatMap((task: any) =>
    toArray(task.PredecessorLink).map((link: any) => ({
      predecessorExternalId: firstString(link.PredecessorUID),
      successorExternalId: firstString(task.UID),
      type: normalizeDependencyType(link.Type),
      lagDays: lagDays(link.LinkLag),
    }))
  ).filter((dependency) => dependency.predecessorExternalId && dependency.successorExternalId);

  const resources = rawResources
    .filter((resource: any) => firstString(resource.Name) || firstString(resource.UID))
    .map((resource: any, index) => ({
      externalId: firstString(resource.UID, resource.ID, index + 1),
      name: firstString(resource.Name, `Resource ${index + 1}`),
      role: firstString(resource.Group),
      kind: resourceKind(resource.Type),
    }));

  const assignments = rawAssignments.map((assignment: any) => ({
    taskExternalId: firstString(assignment.TaskUID),
    resourceExternalId: firstString(assignment.ResourceUID),
    units: firstNumber(assignment.Units) ?? 1,
    role: "",
  })).filter((assignment) => assignment.taskExternalId && assignment.resourceExternalId);

  return { parser: "mspdi", tasks, dependencies, resources, assignments, warnings: [] };
}

function mapMspdiConstraint(value: unknown) {
  switch (firstString(value)) {
    case "1": return "alap";
    case "2": return "mso";
    case "3": return "mfo";
    case "4": return "snet";
    case "5": return "snlt";
    case "6": return "fnet";
    case "7": return "fnlt";
    default: return "asap";
  }
}

function inferParentsFromOutline(tasks: ParsedScheduleTask[]) {
  const stack: ParsedScheduleTask[] = [];
  for (const task of tasks) {
    const level = task.outlineLevel ?? 0;
    while (stack.length > level) stack.pop();
    task.parentExternalId = stack.length > 0 ? stack[stack.length - 1].externalId : null;
    stack[level] = task;
  }
}

function walkObjects(value: unknown, keyName: string, output: any[] = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, keyName, output);
    return output;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === keyName.toLowerCase()) output.push(...toArray(child as any));
    walkObjects(child, keyName, output);
  }
  return output;
}

function parseP6Xml(buffer: Buffer): ParsedSchedule {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, trimValues: true });
  const parsed = parser.parse(buffer.toString("utf8"));
  const rawActivities = walkObjects(parsed, "Activity");
  const rawRelationships = walkObjects(parsed, "Relationship");
  const tasks = rawActivities
    .filter((activity: any) => firstString(activity.ObjectId, activity.Id, activity.Code, activity.Name))
    .map((activity: any, index) => {
      const externalId = firstString(activity.ObjectId, activity.Id, activity.Code, index + 1);
      const startDate = toDateOnly(activity.StartDate ?? activity.PlannedStartDate ?? activity.EarlyStartDate);
      const endDate = toDateOnly(activity.FinishDate ?? activity.PlannedFinishDate ?? activity.EarlyFinishDate);
      const progress = normalizeProgress(activity.PercentComplete ?? activity.PhysicalPercentComplete ?? activity.DurationPercentComplete);
      return {
        externalId,
        parentExternalId: firstString(activity.WBSObjectId) || null,
        name: firstString(activity.Name, activity.Id, activity.Code, `Activity ${index + 1}`),
        description: firstString(activity.Notes),
        taskType: firstString(activity.Type).toLowerCase().includes("milestone") ? "milestone" : "task",
        startDate,
        endDate,
        duration: durationDays(activity.RemainingDuration ?? activity.PlannedDuration ?? activity.OriginalDuration, startDate, endDate),
        progress,
        order: index + 1,
        outlineLevel: 0,
      } satisfies ParsedScheduleTask;
    });

  const dependencies = rawRelationships.map((relationship: any) => ({
    predecessorExternalId: firstString(relationship.PredecessorActivityObjectId, relationship.PredecessorActivityId),
    successorExternalId: firstString(relationship.SuccessorActivityObjectId, relationship.SuccessorActivityId),
    type: normalizeDependencyType(relationship.Type),
    lagDays: lagDays(relationship.Lag),
  })).filter((dependency) => dependency.predecessorExternalId && dependency.successorExternalId);

  return { parser: "p6xml", tasks, dependencies, resources: [], assignments: [], warnings: [] };
}

function parseXer(buffer: Buffer): ParsedSchedule {
  const lines = buffer.toString("utf8").split(/\r?\n/);
  const tables = new Map<string, { fields: string[]; rows: string[][] }>();
  let current = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts[0] === "%T") {
      current = parts[1] ?? "";
      tables.set(current, { fields: [], rows: [] });
    } else if (parts[0] === "%F" && current) {
      tables.get(current)!.fields = parts.slice(1);
    } else if (parts[0] === "%R" && current) {
      tables.get(current)!.rows.push(parts.slice(1));
    }
  }

  const tableRows = (name: string) => {
    const table = tables.get(name);
    if (!table) return [] as Record<string, string>[];
    return table.rows.map((row) => Object.fromEntries(table.fields.map((field, index) => [field, row[index] ?? ""])));
  };

  const wbsRows = tableRows("PROJWBS");
  const tasks: ParsedScheduleTask[] = [];
  const wbsIdToExternal = new Map<string, string>();
  wbsRows.forEach((row, index) => {
    const externalId = `wbs:${firstString(row.wbs_id, index + 1)}`;
    wbsIdToExternal.set(firstString(row.wbs_id), externalId);
    tasks.push({
      externalId,
      parentExternalId: row.parent_wbs_id ? `wbs:${row.parent_wbs_id}` : null,
      name: firstString(row.wbs_name, row.wbs_short_name, `WBS ${index + 1}`),
      taskType: "summary",
      duration: 0,
      progress: 0,
      order: index + 1,
      outlineLevel: 0,
    });
  });

  tableRows("TASK").forEach((row, index) => {
    const externalId = firstString(row.task_id, row.task_code, `task:${index + 1}`);
    const startDate = toDateOnly(row.target_start_date || row.early_start_date || row.act_start_date);
    const endDate = toDateOnly(row.target_end_date || row.early_end_date || row.act_end_date);
    const progress = normalizeProgress(row.phys_complete_pct || row.duration_pct_complete || row.units_pct_complete);
    tasks.push({
      externalId,
      parentExternalId: row.wbs_id ? wbsIdToExternal.get(row.wbs_id) ?? `wbs:${row.wbs_id}` : null,
      name: firstString(row.task_name, row.task_code, `Activity ${index + 1}`),
      description: firstString(row.task_code),
      taskType: firstString(row.task_type).toLowerCase().includes("milestone") ? "milestone" : "task",
      startDate,
      endDate,
      duration: durationDays(row.remain_drtn_hr_cnt || row.target_drtn_hr_cnt, startDate, endDate),
      progress,
      order: wbsRows.length + index + 1,
      outlineLevel: row.wbs_id ? 1 : 0,
    });
  });

  const dependencies = tableRows("TASKPRED").map((row) => ({
    predecessorExternalId: firstString(row.pred_task_id),
    successorExternalId: firstString(row.task_id),
    type: normalizeDependencyType(row.pred_type),
    lagDays: lagDays(row.lag_hr_cnt),
  })).filter((dependency) => dependency.predecessorExternalId && dependency.successorExternalId);

  return { parser: "xer", tasks, dependencies, resources: [], assignments: [], warnings: [] };
}

function parseMpxCsvLine(line: string) {
  const output: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      output.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  output.push(current.trim());
  return output;
}

function normalizeMpxHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mpxRecord(headers: string[], values: string[]) {
  return Object.fromEntries(headers.map((header, index) => [normalizeMpxHeader(header), values[index] ?? ""]));
}

function parseMpxPredecessors(value: unknown, successorExternalId: string): ParsedScheduleDependency[] {
  const text = firstString(value);
  if (!text) return [];
  return text
    .split(/[;,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry): ParsedScheduleDependency[] => {
      const match = entry.match(/^(\d+)([A-Za-z]{0,2})\s*([+-]\s*\d+)?/);
      if (!match) return [];
      return [{
        predecessorExternalId: match[1],
        successorExternalId,
        type: normalizeDependencyType(match[2] || "FS"),
        lagDays: lagDays(match[3]?.replace(/\s+/g, "")),
      }];
    });
}

function parseMpx(buffer: Buffer): ParsedSchedule {
  const lines = buffer.toString("utf8").split(/\r?\n/);
  let taskHeaders: string[] = [];
  let resourceHeaders: string[] = [];
  let assignmentHeaders: string[] = [];
  let dependencyHeaders: string[] = [];
  const dependencies: ParsedScheduleDependency[] = [];
  const resources: ParsedScheduleResource[] = [];
  const assignments: ParsedScheduleAssignment[] = [];
  const tasks: ParsedScheduleTask[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [recordType, ...values] = parseMpxCsvLine(line);
    const normalizedRecordType = recordType.toUpperCase();

    if (normalizedRecordType === "50" || normalizedRecordType === "TASK_FIELDS") {
      taskHeaders = values;
    } else if (normalizedRecordType === "51" || normalizedRecordType === "TASK") {
      const row = mpxRecord(taskHeaders, values);
      const externalId = firstString(row.unique_id, row.id, row.task_id, tasks.length + 1);
      const startDate = toDateOnly(row.start ?? row.start_date ?? row.early_start);
      const endDate = toDateOnly(row.finish ?? row.end ?? row.finish_date);
      const progress = normalizeProgress(row.percent_complete ?? row.pct_complete ?? row.physical_percent_complete);
      const outlineLevel = Math.max(0, (firstNumber(row.outline_level) ?? 1) - 1);
      tasks.push({
        externalId,
        parentExternalId: firstString(row.parent_unique_id, row.parent_id) || null,
        name: firstString(row.name, row.task_name, `Task ${tasks.length + 1}`),
        description: firstString(row.notes, row.description),
        taskType: firstString(row.summary) === "1" || firstString(row.summary).toLowerCase() === "true"
          ? "summary"
          : firstString(row.milestone) === "1" || firstString(row.milestone).toLowerCase() === "true"
            ? "milestone"
            : "task",
        startDate,
        endDate,
        duration: durationDays(row.duration ?? row.work, startDate, endDate),
        progress,
        order: firstNumber(row.id, row.order) ?? tasks.length + 1,
        outlineLevel,
        constraintType: mapConstraintType(row.constraint_type),
        constraintDate: toDateOnly(row.constraint_date),
        deadlineDate: toDateOnly(row.deadline),
      });
      dependencies.push(...parseMpxPredecessors(row.predecessors ?? row.predecessor_ids, externalId));
    } else if (normalizedRecordType === "60" || normalizedRecordType === "RESOURCE_FIELDS") {
      resourceHeaders = values;
    } else if (normalizedRecordType === "61" || normalizedRecordType === "RESOURCE") {
      const row = mpxRecord(resourceHeaders, values);
      resources.push({
        externalId: firstString(row.unique_id, row.id, row.resource_id, resources.length + 1),
        name: firstString(row.name, row.resource_name, `Resource ${resources.length + 1}`),
        role: firstString(row.group, row.role, row.type),
        kind: resourceKind(row.type ?? row.group ?? row.role),
      });
    } else if (normalizedRecordType === "70" || normalizedRecordType === "ASSIGNMENT_FIELDS") {
      assignmentHeaders = values;
    } else if (normalizedRecordType === "71" || normalizedRecordType === "ASSIGNMENT") {
      const row = mpxRecord(assignmentHeaders, values);
      assignments.push({
        taskExternalId: firstString(row.task_unique_id, row.task_id),
        resourceExternalId: firstString(row.resource_unique_id, row.resource_id),
        units: firstNumber(row.units) ?? 1,
        role: firstString(row.role),
      });
    } else if (normalizedRecordType === "75" || normalizedRecordType === "DEPENDENCY_FIELDS") {
      dependencyHeaders = values;
    } else if (normalizedRecordType === "76" || normalizedRecordType === "DEPENDENCY") {
      const row = mpxRecord(dependencyHeaders, values);
      dependencies.push({
        predecessorExternalId: firstString(row.predecessor_unique_id, row.predecessor_id, row.predecessor),
        successorExternalId: firstString(row.successor_unique_id, row.successor_id, row.successor),
        type: normalizeDependencyType(row.type),
        lagDays: lagDays(row.lag),
      });
    }
  }

  inferParentsFromOutline(tasks);
  return {
    parser: "mpxj",
    tasks,
    dependencies: dependencies.filter((dependency) => dependency.predecessorExternalId && dependency.successorExternalId),
    resources: resources.filter((resource) => resource.name),
    assignments: assignments.filter((assignment) => assignment.taskExternalId && assignment.resourceExternalId),
    warnings: [],
  };
}

async function parseScheduleFile(absPath: string, format: string): Promise<ParsedSchedule> {
  const buffer = await readFile(absPath);
  if (MPXJ_BINARY_FORMATS.has(format)) {
    return parseWithMpxj(absPath);
  }
  if (format === "mpx") {
    try {
      return await parseWithMpxj(absPath);
    } catch (error) {
      const parsed = parseMpx(buffer);
      parsed.warnings.push(`MPXJ unavailable or failed, used embedded MPX parser: ${error instanceof Error ? error.message : String(error)}`);
      return parsed;
    }
  }
  try {
    return await parseWithMpxj(absPath);
  } catch (error) {
    if (format === "xer") {
      const parsed = parseXer(buffer);
      parsed.warnings.push(`MPXJ unavailable or failed, used embedded XER parser: ${error instanceof Error ? error.message : String(error)}`);
      return parsed;
    }
    if (XML_FORMATS.has(format)) {
      const text = buffer.toString("utf8").slice(0, 5000).toLowerCase();
      const parsed = text.includes("<project") && text.includes("<tasks")
        ? parseMspdiXml(buffer)
        : parseP6Xml(buffer);
      parsed.warnings.push(`MPXJ unavailable or failed, used embedded XML parser: ${error instanceof Error ? error.message : String(error)}`);
      return parsed;
    }
    throw error;
  }
}

export async function getScheduleImportCandidates(projectId: string): Promise<{ candidates: ScheduleImportCandidate[] }> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const mpxj = await getMpxjStatus();
  const [docs, nodes] = await Promise.all([
    prisma.sourceDocument.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.fileNode.findMany({ where: { projectId, type: "file" }, orderBy: { createdAt: "desc" } }),
  ]);

  const candidates: ScheduleImportCandidate[] = [];
  for (const doc of docs) {
    if (!isSupportedScheduleFile(doc.fileName)) continue;
    const format = extensionOf(doc.fileName);
    candidates.push({
      sourceKind: "source_document",
      sourceId: doc.id,
      fileName: doc.fileName,
      fileType: doc.fileType,
      format,
      size: null,
      storagePath: doc.storagePath,
      provider: MPXJ_BINARY_FORMATS.has(format) ? "mpxj" : "embedded",
      status: MPXJ_BINARY_FORMATS.has(format) ? mpxj.status : "available",
      message: MPXJ_BINARY_FORMATS.has(format) ? mpxj.message : "Embedded parser available; MPXJ will be used when present.",
    });
  }
  for (const node of nodes) {
    if (!isSupportedScheduleFile(node.name)) continue;
    const format = extensionOf(node.name);
    candidates.push({
      sourceKind: "file_node",
      sourceId: node.id,
      fileName: node.name,
      fileType: node.fileType,
      format,
      size: node.size,
      storagePath: node.storagePath,
      provider: MPXJ_BINARY_FORMATS.has(format) ? "mpxj" : "embedded",
      status: MPXJ_BINARY_FORMATS.has(format) ? mpxj.status : "available",
      message: MPXJ_BINARY_FORMATS.has(format) ? mpxj.message : "Embedded parser available; MPXJ will be used when present.",
    });
  }
  return { candidates };
}

async function getCurrentRevision(projectId: string) {
  const quote = await prisma.quote.findFirst({ where: { projectId } });
  if (!quote) throw new Error(`Quote for project ${projectId} not found`);
  const current = quote.currentRevisionId
    ? await prisma.quoteRevision.findFirst({ where: { id: quote.currentRevisionId, quoteId: quote.id } })
    : null;
  if (current) return current;
  const fallback = await prisma.quoteRevision.findFirst({ where: { quoteId: quote.id }, orderBy: { revisionNumber: "desc" } });
  if (!fallback) throw new Error(`Current revision for project ${projectId} not found`);
  return fallback;
}

export async function importProjectSchedule(args: {
  projectId: string;
  sourceKind: ScheduleSourceKind;
  sourceId: string;
  mode?: "replace";
}): Promise<ScheduleImportResult> {
  const source = await resolveProjectFileIngestSource(args.projectId, args.sourceKind, args.sourceId);
  const format = extensionOf(source.fileName);
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new Error(`.${format} is not a supported schedule import format.`);
  }
  if (!source.storagePath) throw new Error(`${source.fileName} has no stored file path.`);
  const absPath = resolveApiPath(source.storagePath);
  await stat(absPath);
  const parsed = await parseScheduleFile(absPath, format);
  if (parsed.tasks.length === 0) {
    throw new Error(`No schedule tasks were found in ${source.fileName}.`);
  }

  const revision = await getCurrentRevision(args.projectId);
  const defaultCalendarId = createId("schcal");
  const taskIdByExternal = new Map<string, string>();
  const resourceIdByExternal = new Map<string, string>();

  const sortedTasks = [...parsed.tasks].sort((a, b) => a.order - b.order);
  for (const task of sortedTasks) {
    taskIdByExternal.set(task.externalId, createId("schtask"));
  }
  for (const resource of parsed.resources) {
    resourceIdByExternal.set(resource.externalId, createId("schres"));
  }

  await prisma.$transaction(async (tx) => {
    const existingTasks = await tx.scheduleTask.findMany({
      where: { projectId: args.projectId, revisionId: revision.id },
      select: { id: true },
    });
    await tx.scheduleBaseline.deleteMany({ where: { projectId: args.projectId, revisionId: revision.id } });
    await tx.scheduleDependency.deleteMany({
      where: {
        OR: [
          { predecessorId: { in: existingTasks.map((task) => task.id) } },
          { successorId: { in: existingTasks.map((task) => task.id) } },
        ],
      },
    });
    await tx.scheduleTask.deleteMany({ where: { projectId: args.projectId, revisionId: revision.id } });
    await tx.scheduleResource.deleteMany({ where: { projectId: args.projectId, revisionId: revision.id } });
    await tx.scheduleCalendar.deleteMany({ where: { projectId: args.projectId, revisionId: revision.id } });

    await tx.scheduleCalendar.create({
      data: {
        id: defaultCalendarId,
        projectId: args.projectId,
        revisionId: revision.id,
        name: `Imported: ${path.basename(source.fileName)}`,
        description: "Default calendar created by schedule import",
        isDefault: true,
        workingDays: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
          "0": false,
          "1": true,
          "2": true,
          "3": true,
          "4": true,
          "5": true,
          "6": false,
        } as Prisma.InputJsonValue,
        shiftStartMinutes: 480,
        shiftEndMinutes: 1020,
      },
    });

    for (const resource of parsed.resources) {
      await tx.scheduleResource.create({
        data: {
          id: resourceIdByExternal.get(resource.externalId)!,
          projectId: args.projectId,
          revisionId: revision.id,
          calendarId: defaultCalendarId,
          name: resource.name,
          role: resource.role ?? "",
          kind: resource.kind ?? "labor",
          color: "",
          defaultUnits: 1,
          capacityPerDay: 1,
          costRate: 0,
        },
      });
    }

    for (const task of sortedTasks) {
      const progress = task.progress ?? 0;
      const parentTaskId = task.parentExternalId ? taskIdByExternal.get(task.parentExternalId) ?? null : null;
      await tx.scheduleTask.create({
        data: {
          id: taskIdByExternal.get(task.externalId)!,
          projectId: args.projectId,
          revisionId: revision.id,
          phaseId: null,
          calendarId: defaultCalendarId,
          parentTaskId,
          outlineLevel: Math.max(0, Math.min(12, task.outlineLevel ?? (parentTaskId ? 1 : 0))),
          name: task.name,
          description: task.description ?? "",
          taskType: task.taskType ?? "task",
          status: taskStatus(progress),
          startDate: task.startDate ?? null,
          endDate: task.endDate ?? null,
          duration: task.duration ?? 0,
          progress,
          assignee: "",
          order: task.order,
          constraintType: task.constraintType ?? "asap",
          constraintDate: task.constraintDate ?? null,
          deadlineDate: task.deadlineDate ?? null,
          actualStart: null,
          actualEnd: null,
        },
      });
    }

    const seenDependencies = new Set<string>();
    for (const dependency of parsed.dependencies) {
      const predecessorId = taskIdByExternal.get(dependency.predecessorExternalId);
      const successorId = taskIdByExternal.get(dependency.successorExternalId);
      if (!predecessorId || !successorId || predecessorId === successorId) continue;
      const dependencyKey = `${predecessorId}:${successorId}`;
      if (seenDependencies.has(dependencyKey)) continue;
      seenDependencies.add(dependencyKey);
      await tx.scheduleDependency.create({
        data: {
          id: createId("dep"),
          predecessorId,
          successorId,
          type: normalizeDependencyType(dependency.type),
          lagDays: dependency.lagDays ?? 0,
        },
      });
    }

    const seenAssignments = new Set<string>();
    for (const assignment of parsed.assignments) {
      const taskId = taskIdByExternal.get(assignment.taskExternalId);
      const resourceId = resourceIdByExternal.get(assignment.resourceExternalId);
      if (!taskId || !resourceId) continue;
      const assignmentKey = `${taskId}:${resourceId}`;
      if (seenAssignments.has(assignmentKey)) continue;
      seenAssignments.add(assignmentKey);
      await tx.scheduleTaskAssignment.create({
        data: {
          id: createId("schassign"),
          taskId,
          resourceId,
          units: assignment.units ?? 1,
          role: assignment.role ?? "",
        },
      });
    }

    await tx.project.update({ where: { id: args.projectId }, data: { updatedAt: new Date() } });
  }, { timeout: 60_000 });

  return {
    imported: {
      parser: parsed.parser,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      fileName: source.fileName,
      taskCount: parsed.tasks.length,
      dependencyCount: parsed.dependencies.length,
      resourceCount: parsed.resources.length,
      assignmentCount: parsed.assignments.length,
      warnings: parsed.warnings,
    },
  };
}
