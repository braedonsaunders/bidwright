"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  ModalBackdrop,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
} from "@/components/ui";
import type {
  CreateScheduleBaselineInput,
  CreateScheduleCalendarInput,
  CreateScheduleResourceInput,
  ScheduleBaseline,
  ScheduleCalendar,
  ScheduleCalendarPatchInput,
  ScheduleResource,
  ScheduleResourcePatchInput,
} from "@/lib/api";

interface ScheduleManagementModalProps {
  open: boolean;
  onClose: () => void;
  calendars: ScheduleCalendar[];
  resources: ScheduleResource[];
  baselines: ScheduleBaseline[];
  activeBaselineId: string;
  onActiveBaselineChange: (baselineId: string) => void;
  onCreateBaseline: (input: CreateScheduleBaselineInput) => Promise<boolean>;
  onDeleteBaseline: (baselineId: string) => Promise<boolean>;
  onCreateCalendar: (input: CreateScheduleCalendarInput) => Promise<boolean>;
  onUpdateCalendar: (calendarId: string, patch: ScheduleCalendarPatchInput) => Promise<boolean>;
  onDeleteCalendar: (calendarId: string) => Promise<boolean>;
  onCreateResource: (input: CreateScheduleResourceInput) => Promise<boolean>;
  onUpdateResource: (resourceId: string, patch: ScheduleResourcePatchInput) => Promise<boolean>;
  onDeleteResource: (resourceId: string) => Promise<boolean>;
}

type ManagementTab = "baselines" | "calendars" | "resources";

const DAY_OPTIONS = [
  { key: "1", label: "Mon" },
  { key: "2", label: "Tue" },
  { key: "3", label: "Wed" },
  { key: "4", label: "Thu" },
  { key: "5", label: "Fri" },
  { key: "6", label: "Sat" },
  { key: "0", label: "Sun" },
];

const DEFAULT_WORKING_DAYS: Record<string, boolean> = {
  "0": false,
  "1": true,
  "2": true,
  "3": true,
  "4": true,
  "5": true,
  "6": false,
};

export function ScheduleManagementModal({
  open,
  onClose,
  calendars,
  resources,
  baselines,
  activeBaselineId,
  onActiveBaselineChange,
  onCreateBaseline,
  onDeleteBaseline,
  onCreateCalendar,
  onUpdateCalendar,
  onDeleteCalendar,
  onCreateResource,
  onUpdateResource,
  onDeleteResource,
}: ScheduleManagementModalProps) {
  const [activeTab, setActiveTab] = useState<ManagementTab>("baselines");

  const [calendarName, setCalendarName] = useState("");
  const [calendarDescription, setCalendarDescription] = useState("");
  const [calendarStartMinutes, setCalendarStartMinutes] = useState("480");
  const [calendarEndMinutes, setCalendarEndMinutes] = useState("1020");
  const [workingDays, setWorkingDays] = useState<Record<string, boolean>>(DEFAULT_WORKING_DAYS);

  const [resourceName, setResourceName] = useState("");
  const [resourceRole, setResourceRole] = useState("");
  const [resourceKind, setResourceKind] = useState<NonNullable<CreateScheduleResourceInput["kind"]>>("labor");
  const [resourceCalendarId, setResourceCalendarId] = useState("");
  const [resourceDefaultUnits, setResourceDefaultUnits] = useState("1");
  const [resourceCapacity, setResourceCapacity] = useState("1");
  const [resourceCostRate, setResourceCostRate] = useState("0");

  const [baselineName, setBaselineName] = useState("");
  const [baselineKind, setBaselineKind] = useState<NonNullable<CreateScheduleBaselineInput["kind"]>>("snapshot");
  const [baselinePrimary, setBaselinePrimary] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab("baselines");
    }
  }, [open]);

  const sortedBaselines = useMemo(
    () => [...baselines].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [baselines]
  );
  const activeBaseline = baselines.find((baseline) => baseline.id === activeBaselineId) ?? null;
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0] ?? null;

  const handleCreateCalendar = async () => {
    const didCreate = await onCreateCalendar({
      name: calendarName || undefined,
      description: calendarDescription || undefined,
      workingDays,
      shiftStartMinutes: Number.parseInt(calendarStartMinutes || "480", 10) || 480,
      shiftEndMinutes: Number.parseInt(calendarEndMinutes || "1020", 10) || 1020,
    });
    if (didCreate) {
      setCalendarName("");
      setCalendarDescription("");
      setCalendarStartMinutes("480");
      setCalendarEndMinutes("1020");
      setWorkingDays(DEFAULT_WORKING_DAYS);
    }
  };

  const handleCreateResource = async () => {
    const didCreate = await onCreateResource({
      name: resourceName || undefined,
      role: resourceRole || undefined,
      kind: resourceKind,
      calendarId: resourceCalendarId || null,
      defaultUnits: Number.parseFloat(resourceDefaultUnits || "1") || 1,
      capacityPerDay: Number.parseFloat(resourceCapacity || "1") || 1,
      costRate: Number.parseFloat(resourceCostRate || "0") || 0,
    });
    if (didCreate) {
      setResourceName("");
      setResourceRole("");
      setResourceKind("labor");
      setResourceCalendarId("");
      setResourceDefaultUnits("1");
      setResourceCapacity("1");
      setResourceCostRate("0");
    }
  };

  const handleCreateBaseline = async () => {
    const didCreate = await onCreateBaseline({
      name: baselineName || undefined,
      kind: baselineKind,
      isPrimary: baselinePrimary,
    });
    if (didCreate) {
      setBaselineName("");
      setBaselineKind("snapshot");
      setBaselinePrimary(false);
    }
  };

  return (
    <ModalBackdrop open={open} onClose={onClose} size="2xl">
      <div
        data-testid="schedule-management-modal"
        className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        style={{ height: "min(92vh, 780px)" }}
      >
        <div className="border-b border-line px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/35">Schedule Controls</p>
              <h3 className="mt-1 text-base font-semibold text-fg">Schedule Management</h3>
              <p className="mt-1 text-sm text-fg/50">
                Manage working calendars, resource loading, and comparison baselines without leaving the schedule.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid="schedule-management-close"
              className="text-fg/35 transition-colors hover:text-fg/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-h-0 flex-col px-6 py-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ManagementTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mb-4">
                <TabsTrigger value="baselines">Baselines</TabsTrigger>
                <TabsTrigger value="calendars">Calendars</TabsTrigger>
                <TabsTrigger value="resources">Resources</TabsTrigger>
              </TabsList>

              <TabsContent value="baselines" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Saved Baselines</CardTitle>
                      <CardDescription>Keep multiple snapshots and choose the active comparison baseline.</CardDescription>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      {sortedBaselines.length === 0 ? (
                        <p className="text-xs text-fg/40">No saved baselines yet.</p>
                      ) : (
                        sortedBaselines.map((baseline) => (
                          <div key={baseline.id} className="rounded-xl border border-line bg-panel2/20 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-fg">{baseline.name}</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {baseline.isPrimary && <Badge tone="info">Primary</Badge>}
                                  <Badge tone="default">{baseline.kind}</Badge>
                                  {activeBaselineId === baseline.id && <Badge tone="success">Active</Badge>}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void onDeleteBaseline(baseline.id)}
                                className="text-fg/30 transition-colors hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-3 flex gap-2">
                              <Button
                                variant="secondary"
                                size="xs"
                                onClick={() => onActiveBaselineChange(baseline.id)}
                                data-testid={`baseline-activate-${baseline.id}`}
                              >
                                Use For Comparison
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Create Baseline</CardTitle>
                      <CardDescription>Save a new comparison snapshot from the current schedule state.</CardDescription>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      <div>
                        <Label>New Baseline</Label>
                        <Input
                          data-testid="baseline-name-input"
                          value={baselineName}
                          onChange={(event) => setBaselineName(event.target.value)}
                          placeholder="Week 14 approved plan"
                        />
                      </div>
                      <div>
                        <Label>Kind</Label>
                        <Select
                          value={baselineKind}
                          onValueChange={(v) => setBaselineKind(v as typeof baselineKind)}
                          options={[
                            { value: "snapshot", label: "Snapshot" },
                            { value: "secondary", label: "Secondary" },
                            { value: "tertiary", label: "Tertiary" },
                            { value: "custom", label: "Custom" },
                            { value: "primary", label: "Primary" },
                          ]}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-line bg-panel2/20 px-3 py-2">
                        <div>
                          <p className="text-xs font-medium text-fg/70">Set as primary</p>
                          <p className="text-[11px] text-fg/40">Use this snapshot as the default committed baseline.</p>
                        </div>
                        <Toggle checked={baselinePrimary} onChange={setBaselinePrimary} />
                      </div>
                      <Button variant="accent" size="sm" onClick={() => void handleCreateBaseline()} data-testid="baseline-create">
                        Save Snapshot
                      </Button>
                    </CardBody>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="calendars" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Project Calendars</CardTitle>
                      <CardDescription>Define working-day patterns, shift windows, and the default planning calendar.</CardDescription>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      {calendars.map((calendar) => (
                        <div key={calendar.id} className="rounded-xl border border-line bg-panel2/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-fg">{calendar.name}</p>
                              <p className="mt-1 text-[11px] text-fg/40">
                                {calendar.shiftStartMinutes} to {calendar.shiftEndMinutes} minutes
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {DAY_OPTIONS.map((day) => (
                                  <Badge key={day.key} tone={calendar.workingDays?.[day.key] === false ? "default" : "success"}>
                                    {day.label}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {calendar.isDefault && <Badge tone="info">Default</Badge>}
                              <button
                                type="button"
                                onClick={() => void onDeleteCalendar(calendar.id)}
                                className="text-fg/30 transition-colors hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          {!calendar.isDefault && (
                            <Button
                              variant="secondary"
                              size="xs"
                              className="mt-3"
                              onClick={() => void onUpdateCalendar(calendar.id, { isDefault: true })}
                            >
                              Make Default
                            </Button>
                          )}
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Create Calendar</CardTitle>
                      <CardDescription>Add a new shift pattern for alternate crews, night work, or weekend work.</CardDescription>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      <div>
                        <Label>New Calendar</Label>
                        <Input
                          data-testid="calendar-name-input"
                          value={calendarName}
                          onChange={(event) => setCalendarName(event.target.value)}
                          placeholder="Night Shift"
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input
                          value={calendarDescription}
                          onChange={(event) => setCalendarDescription(event.target.value)}
                          placeholder="Mon-Sat night work"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>Shift Start (min)</Label>
                          <Input type="number" value={calendarStartMinutes} onChange={(event) => setCalendarStartMinutes(event.target.value)} />
                        </div>
                        <div>
                          <Label>Shift End (min)</Label>
                          <Input type="number" value={calendarEndMinutes} onChange={(event) => setCalendarEndMinutes(event.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Working Days</Label>
                        <div className="grid grid-cols-4 gap-2">
                          {DAY_OPTIONS.map((day) => (
                            <button
                              key={day.key}
                              type="button"
                              onClick={() =>
                                setWorkingDays((current) => ({
                                  ...current,
                                  [day.key]: !current[day.key],
                                }))
                              }
                              className={workingDays[day.key]
                                ? "rounded-lg border border-accent/30 bg-accent/8 px-2 py-1.5 text-xs text-accent"
                                : "rounded-lg border border-line bg-panel2/20 px-2 py-1.5 text-xs text-fg/45"}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Button variant="accent" size="sm" onClick={() => void handleCreateCalendar()} data-testid="calendar-create">
                        Add Calendar
                      </Button>
                    </CardBody>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="resources" className="mt-0 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Schedule Resources</CardTitle>
                      <CardDescription>Define crews, labor, equipment, and subcontractor loading rules.</CardDescription>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      {resources.length === 0 ? (
                        <p className="text-xs text-fg/40">No schedule resources yet.</p>
                      ) : (
                        resources.map((resource) => (
                          <div key={resource.id} className="rounded-xl border border-line bg-panel2/20 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-fg">{resource.name}</p>
                                <p className="mt-1 text-[11px] text-fg/40">
                                  {resource.kind} / {resource.role || "No role"} / {resource.capacityPerDay} cap-day
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void onDeleteResource(resource.id)}
                                className="text-fg/30 transition-colors hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Create Resource</CardTitle>
                      <CardDescription>Add a new crew, labor pool, equipment unit, or subcontract resource.</CardDescription>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      <div>
                        <Label>New Resource</Label>
                        <Input
                          data-testid="resource-name-input"
                          value={resourceName}
                          onChange={(event) => setResourceName(event.target.value)}
                          placeholder="Roofing Crew A"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>Role</Label>
                          <Input value={resourceRole} onChange={(event) => setResourceRole(event.target.value)} placeholder="Install crew" />
                        </div>
                        <div>
                          <Label>Kind</Label>
                          <Select
                            value={resourceKind}
                            onValueChange={(v) => setResourceKind(v as typeof resourceKind)}
                            options={[
                              { value: "labor", label: "Labor" },
                              { value: "crew", label: "Crew" },
                              { value: "equipment", label: "Equipment" },
                              { value: "subcontractor", label: "Subcontractor" },
                            ]}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Calendar</Label>
                        <Select
                          value={resourceCalendarId || "__default__"}
                          onValueChange={(v) => setResourceCalendarId(v === "__default__" ? "" : v)}
                          options={[
                            { value: "__default__", label: "Use default" },
                            ...calendars.map((calendar) => ({ value: calendar.id, label: calendar.name })),
                          ]}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label>Units</Label>
                          <Input type="number" step="0.25" value={resourceDefaultUnits} onChange={(event) => setResourceDefaultUnits(event.target.value)} />
                        </div>
                        <div>
                          <Label>Capacity/Day</Label>
                          <Input type="number" step="0.25" value={resourceCapacity} onChange={(event) => setResourceCapacity(event.target.value)} />
                        </div>
                        <div>
                          <Label>Cost Rate</Label>
                          <Input type="number" step="0.01" value={resourceCostRate} onChange={(event) => setResourceCostRate(event.target.value)} />
                        </div>
                      </div>
                      <Button variant="accent" size="sm" onClick={() => void handleCreateResource()} data-testid="resource-create">
                        Add Resource
                      </Button>
                    </CardBody>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel2/18 px-5 py-4">
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-panel px-4 py-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/40">Control Summary</h4>
                <div className="mt-3 space-y-2 text-xs text-fg/55">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Active baseline</span>
                    <span className="truncate text-right font-medium text-fg/75">{activeBaseline?.name ?? "None"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Default calendar</span>
                    <span className="truncate text-right font-medium text-fg/75">{defaultCalendar?.name ?? "None"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Saved baselines</span>
                    <span className="font-medium text-fg/75">{baselines.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Calendars</span>
                    <span className="font-medium text-fg/75">{calendars.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Resources</span>
                    <span className="font-medium text-fg/75">{resources.length}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-panel px-4 py-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/40">Admin Notes</h4>
                <div className="mt-3 space-y-2 text-xs text-fg/55">
                  <p>Baselines are for comparison and variance tracking, not live planning edits.</p>
                  <p>Calendars define working logic for tasks and resources. Keep one default calendar current.</p>
                  <p>Resources should represent the actual loading buckets you plan and report against.</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </ModalBackdrop>
  );
}
