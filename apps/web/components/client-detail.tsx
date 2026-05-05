"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Gauge,
  Globe,
  Loader2,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  Plus,
  Trash2,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculateClientMetrics,
  getClientInitials,
  projectMatchesCustomer,
  quotedProjects,
  statusToClientStage,
  type ClientStage,
  type QuotedProject,
} from "@/lib/client-analytics";
import {
  createRateBookAssignment,
  deleteRateBookAssignment,
  listRateBookAssignments,
  listRateSchedules,
  updateCustomer,
  updateRateBookAssignment,
  type Customer,
  type CustomerWithContacts,
  type OrgDepartment,
  type OrgUser,
  type ProjectListItem,
  type RateBookAssignment,
  type RateSchedule,
} from "@/lib/api";
import { formatCompactMoney, formatDate, formatMoney, formatPercent } from "@/lib/format";
import { SearchablePicker } from "@/components/shared/searchable-picker";
import { Badge, Button, Card, EmptyState, Input, Label, ModalBackdrop } from "@/components/ui";

type EditableCustomerFields = Pick<
  Customer,
  | "name"
  | "shortName"
  | "phone"
  | "email"
  | "website"
  | "addressStreet"
  | "addressCity"
  | "addressProvince"
  | "addressPostalCode"
  | "addressCountry"
  | "notes"
>;

type ClientTab = "overview" | "quotes" | "profile" | "ratebooks";

const CLIENT_TABS: Array<{ id: ClientTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "quotes", label: "Quotes" },
  { id: "profile", label: "Profile" },
  { id: "ratebooks", label: "Ratebooks" },
];

const STAGE_LABEL: Record<ClientStage, string> = {
  active: "Active",
  won: "Awarded",
  lost: "Lost",
  other: "Other",
};

const STAGE_CLASSES: Record<ClientStage, string> = {
  active: "bg-accent",
  won: "bg-success",
  lost: "bg-danger",
  other: "bg-fg/20",
};

function statusTone(status: string) {
  switch (status.toLowerCase()) {
    case "awarded":
    case "closed":
      return "success" as const;
    case "pending":
    case "review":
      return "warning" as const;
    case "didnotget":
    case "declined":
    case "cancelled":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

function daysSince(value: string | null) {
  if (!value) return null;
  return Math.floor((Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24));
}

function KpiCell({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-fg/35">{label}</span>
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight text-fg">{value}</div>
      <div className="mt-0.5 truncate text-xs text-fg/45">{sub}</div>
    </div>
  );
}

function ClientIdentity({
  name,
  active,
}: {
  name: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold",
          active ? "border-accent/25 bg-accent/10 text-accent" : "border-line bg-panel2 text-fg/35",
        )}
      >
        {getClientInitials(name)}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{name}</h1>
          <Badge tone={active ? "success" : "default"}>{active ? "Active" : "Inactive"}</Badge>
        </div>
        <p className="mt-1 text-xs text-fg/45">Client workspace, relationship signal, and scoped quote history.</p>
      </div>
    </div>
  );
}

function StageDistribution({ projects }: { projects: QuotedProject[] }) {
  const distribution = useMemo(() => {
    const base: Record<ClientStage, { count: number; value: number }> = {
      active: { count: 0, value: 0 },
      won: { count: 0, value: 0 },
      lost: { count: 0, value: 0 },
      other: { count: 0, value: 0 },
    };
    for (const project of projects) {
      const stage = statusToClientStage(project.quote.status);
      base[stage].count += 1;
      base[stage].value += project.latestRevision?.subtotal ?? 0;
    }
    return base;
  }, [projects]);
  const total = Math.max(projects.length, 1);

  return (
    <Card className="rounded-lg">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Quote mix</h2>
        <p className="mt-0.5 text-xs text-fg/45">Status distribution by count and value.</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-panel2">
          {(["active", "won", "lost", "other"] as ClientStage[]).map((stage) => (
            <span
              key={stage}
              className={STAGE_CLASSES[stage]}
              style={{ width: `${(distribution[stage].count / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["active", "won", "lost", "other"] as ClientStage[]).map((stage) => (
            <div key={stage} className="rounded-lg border border-line bg-bg/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-fg/65">
                  <span className={cn("h-2 w-2 rounded-full", STAGE_CLASSES[stage])} />
                  {STAGE_LABEL[stage]}
                </span>
                <span className="text-xs tabular-nums text-fg/45">{distribution[stage].count}</span>
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-fg">{formatCompactMoney(distribution[stage].value)}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SignalPanel({ projects }: { projects: QuotedProject[] }) {
  const metrics = calculateClientMetrics(projects);
  const lastAge = daysSince(metrics.lastActivityAt);
  const lowMargin = projects.filter((project) => {
    const margin = project.latestRevision?.estimatedMargin ?? 0;
    return margin > 0 && margin < 0.12;
  }).length;
  const activeHighValue = projects
    .filter((project) => statusToClientStage(project.quote.status) === "active")
    .sort((a, b) => (b.latestRevision?.subtotal ?? 0) - (a.latestRevision?.subtotal ?? 0))[0];

  const signals = [
    {
      label: "Relationship state",
      value: metrics.activeCount > 0 ? "Active pursuit" : metrics.wonCount > 0 ? "Awarded history" : "Prospect",
      tone: metrics.activeCount > 0 ? "text-accent" : metrics.wonCount > 0 ? "text-success" : "text-fg/60",
    },
    {
      label: "Recency",
      value: lastAge == null ? "No quote activity" : lastAge === 0 ? "Updated today" : `${lastAge} days since touch`,
      tone: lastAge != null && lastAge > 45 ? "text-warning" : "text-fg/70",
    },
    {
      label: "Margin watch",
      value: lowMargin > 0 ? `${lowMargin} low-margin quote${lowMargin === 1 ? "" : "s"}` : "No low-margin flags",
      tone: lowMargin > 0 ? "text-danger" : "text-success",
    },
    {
      label: "Largest live quote",
      value: activeHighValue ? `${activeHighValue.quote.quoteNumber} / ${formatCompactMoney(activeHighValue.latestRevision?.subtotal ?? 0)}` : "No active quote",
      tone: activeHighValue ? "text-accent" : "text-fg/55",
    },
  ];

  return (
    <Card className="rounded-lg">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Client signals</h2>
        <p className="mt-0.5 text-xs text-fg/45">Fast read for follow-up and account posture.</p>
      </div>
      <div className="divide-y divide-line">
        {signals.map((signal) => (
          <div key={signal.label} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-xs text-fg/45">{signal.label}</span>
            <span className={cn("text-right text-xs font-medium", signal.tone)}>{signal.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function QuoteList({
  projects,
  users,
  departments,
  className,
}: {
  projects: QuotedProject[];
  users: OrgUser[];
  departments: OrgDepartment[];
  className?: string;
}) {
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const departmentMap = useMemo(() => new Map(departments.map((department) => [department.id, department])), [departments]);
  const sorted = useMemo(
    () => projects.slice().sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()),
    [projects],
  );

  return (
    <Card className={cn("flex min-h-0 flex-col rounded-lg", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Scoped quotes</h2>
          <p className="mt-0.5 text-xs text-fg/45">Every quote currently attached to this client.</p>
        </div>
        <Badge>{sorted.length} quote{sorted.length === 1 ? "" : "s"}</Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line">
              <th className="w-28 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Quote #</th>
              <th className="min-w-[220px] px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Title</th>
              <th className="w-24 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Status</th>
              <th className="w-28 px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Subtotal</th>
              <th className="w-20 px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Margin</th>
              <th className="w-24 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Owner</th>
              <th className="w-24 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-fg/40">
                  <FileText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                  No quotes are attached to this client yet.
                </td>
              </tr>
            )}
            {sorted.map((project, index) => (
              <motion.tr
                key={project.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: index * 0.015, ease: "easeOut" }}
                className="border-b border-line transition-colors last:border-0 hover:bg-panel2/40"
              >
                <td className="px-4 py-2.5 text-xs font-medium text-accent whitespace-nowrap">
                  <Link href={`/projects/${project.id}`} className="hover:underline">
                    {project.quote.quoteNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs text-fg/80">
                  <Link href={`/projects/${project.id}`} className="hover:underline">
                    {project.quote.title || project.name}
                  </Link>
                  <div className="mt-0.5 truncate text-[11px] text-fg/35">{project.location || "No location"}</div>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={statusTone(project.quote.status)}>
                    {project.quote.status === "DidNotGet" ? "Did Not Get" : project.quote.status}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-medium tabular-nums text-fg/80">
                  {formatMoney(project.latestRevision?.subtotal ?? 0)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs tabular-nums text-fg/60">
                  {formatPercent(project.latestRevision?.estimatedMargin ?? 0)}
                </td>
                <td className="px-4 py-2.5 text-xs text-fg/60">
                  {(project.quote.userId && userMap.get(project.quote.userId)?.name) ||
                    project.quote.userName ||
                    (project.quote.departmentId && departmentMap.get(project.quote.departmentId)?.name) ||
                    "-"}
                </td>
                <td className="px-4 py-2.5 text-xs text-fg/50">{formatDate(project.updatedAt)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ProfilePanel({
  customer,
  onEdit,
  className,
}: {
  customer: CustomerWithContacts | null;
  onEdit: () => void;
  className?: string;
}) {
  const address = customer
    ? [
        customer.addressStreet,
        [customer.addressCity, customer.addressProvince].filter(Boolean).join(", "),
        customer.addressPostalCode,
        customer.addressCountry,
      ].filter(Boolean)
    : [];

  return (
    <Card className={cn("flex min-h-0 flex-col rounded-lg", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Profile</h2>
          <p className="mt-0.5 text-xs text-fg/45">Customer master data</p>
        </div>
        {customer && (
          <Button variant="ghost" size="xs" onClick={onEdit}>
            <PencilLine className="h-3 w-3" />
            Edit
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-xs">
        <div className="flex items-start gap-2 text-fg/65">
          <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/30" />
          <span>{customer?.shortName || "No short name"}</span>
        </div>
        <div className="flex items-start gap-2 text-fg/65">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/30" />
          <span className="break-all">{customer?.email || "No email"}</span>
        </div>
        <div className="flex items-start gap-2 text-fg/65">
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/30" />
          <span>{customer?.phone || "No phone"}</span>
        </div>
        <div className="flex items-start gap-2 text-fg/65">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/30" />
          {customer?.website ? (
            <a href={customer.website} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
              {customer.website}
            </a>
          ) : (
            <span>No website</span>
          )}
        </div>
        <div className="flex items-start gap-2 text-fg/65">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/30" />
          <span>{address.length > 0 ? address.join(" / ") : "No address"}</span>
        </div>
        {customer?.notes && (
          <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-fg/60">
            {customer.notes}
          </div>
        )}
      </div>
    </Card>
  );
}

function ContactsPanel({ customer, className }: { customer: CustomerWithContacts | null; className?: string }) {
  const contacts = customer?.contacts ?? [];

  return (
    <Card className={cn("flex min-h-0 flex-col rounded-lg", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Contacts</h2>
          <p className="mt-0.5 text-xs text-fg/45">People attached to the account.</p>
        </div>
        <Badge>{contacts.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line overflow-auto">
        {contacts.length === 0 && (
          <div className="px-4 py-8">
            <EmptyState className="py-6">No contacts on this client yet.</EmptyState>
          </div>
        )}
        {contacts.map((contact) => (
          <div key={contact.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <UserRound className="h-3.5 w-3.5 text-accent" />
                  <span className="truncate text-xs font-semibold text-fg">{contact.name || "Unnamed contact"}</span>
                </div>
                <div className="mt-1 text-[11px] text-fg/40">{contact.title || "No title"}</div>
              </div>
              {contact.isPrimary && <Badge tone="info">Primary</Badge>}
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-fg/50">
              <span className="flex items-center gap-1.5 truncate">
                <Mail className="h-3 w-3 text-fg/25" />
                <span className="truncate">{contact.email || "No email"}</span>
              </span>
              <span className="flex items-center gap-1.5 truncate">
                <Phone className="h-3 w-3 text-fg/25" />
                <span>{contact.phone || "No phone"}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function scheduleDateRange(schedule: RateSchedule) {
  if (schedule.effectiveDate && schedule.expiryDate) return `${formatDate(schedule.effectiveDate)} - ${formatDate(schedule.expiryDate)}`;
  if (schedule.effectiveDate) return `From ${formatDate(schedule.effectiveDate)}`;
  if (schedule.expiryDate) return `Until ${formatDate(schedule.expiryDate)}`;
  return "";
}

function ClientRatebooksPanel({ customer }: { customer: CustomerWithContacts }) {
  const [schedules, setSchedules] = useState<RateSchedule[]>([]);
  const [assignments, setAssignments] = useState<RateBookAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      listRateSchedules(),
      listRateBookAssignments({ customerId: customer.id }),
    ])
      .then(([nextSchedules, nextAssignments]) => {
        if (cancelled) return;
        setSchedules(nextSchedules);
        setAssignments(nextAssignments);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load ratebooks.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  const scheduleById = useMemo(() => new Map(schedules.map((schedule) => [schedule.id, schedule])), [schedules]);
  const activeAssignments = useMemo(
    () => assignments
      .filter((assignment) => assignment.active)
      .slice()
      .sort((left, right) => {
        if (left.priority !== right.priority) return right.priority - left.priority;
        return (scheduleById.get(left.rateScheduleId)?.name ?? "").localeCompare(scheduleById.get(right.rateScheduleId)?.name ?? "");
      }),
    [assignments, scheduleById],
  );
  const assignedScheduleIds = useMemo(
    () => new Set(activeAssignments.map((assignment) => assignment.rateScheduleId)),
    [activeAssignments],
  );
  const pickerOptions = useMemo(
    () => schedules
      .filter((schedule) => !assignedScheduleIds.has(schedule.id))
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((schedule) => ({
        id: schedule.id,
        label: schedule.name,
        secondary: schedule.category || undefined,
      })),
    [assignedScheduleIds, schedules],
  );

  async function addRatebook(scheduleId: string) {
    const schedule = scheduleById.get(scheduleId);
    if (!schedule || saving) return;

    setSaving(true);
    setError("");
    try {
      const existing = assignments.find((assignment) => assignment.rateScheduleId === scheduleId);
      const saved = existing
        ? await updateRateBookAssignment(existing.id, {
            active: true,
            category: schedule.category,
            priority: Math.max(0, activeAssignments.length),
          })
        : await createRateBookAssignment({
            rateScheduleId: schedule.id,
            customerId: customer.id,
            category: schedule.category,
            priority: Math.max(0, activeAssignments.length),
            active: true,
          });
      setAssignments((prev) => {
        const withoutExisting = prev.filter((assignment) => assignment.id !== saved.id);
        return [...withoutExisting, saved];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add ratebook.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRatebook(assignmentId: string) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await deleteRateBookAssignment(assignmentId);
      setAssignments((prev) => prev.filter((assignment) => assignment.id !== assignmentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove ratebook.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex h-full min-h-0 flex-col rounded-lg">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Default ratebooks</h2>
          <p className="mt-0.5 text-xs text-fg/45">Applied to new Snap quotes for this client.</p>
        </div>
        <Badge tone={activeAssignments.length > 0 ? "info" : "default"}>
          {activeAssignments.length} default{activeAssignments.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="shrink-0 border-b border-line px-4 py-3">
        <SearchablePicker
          value={null}
          onSelect={addRatebook}
          options={pickerOptions}
          placeholder={loading ? "Loading ratebooks..." : "Add default ratebook..."}
          searchPlaceholder="Search ratebooks..."
          emptyMessage="No more ratebooks available"
          disabled={loading || saving || pickerOptions.length === 0}
          triggerClassName="h-9 rounded-lg bg-bg/50 px-3 text-sm"
          width={420}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-fg/40">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading ratebooks...
          </div>
        ) : activeAssignments.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState className="py-8">
              <BookOpen className="mx-auto mb-2 h-8 w-8 text-fg/20" />
              No default ratebooks on this client.
            </EmptyState>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {activeAssignments.map((assignment) => {
              const schedule = scheduleById.get(assignment.rateScheduleId);
              const range = schedule ? scheduleDateRange(schedule) : "";
              return (
                <div key={assignment.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/8 text-accent">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{schedule?.name ?? "Missing ratebook"}</span>
                      {schedule?.category && <Badge className="shrink-0 text-[10px]">{schedule.category}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg/40">
                      <span>{schedule?.items?.length ?? 0} items</span>
                      <span>{schedule?.tiers?.length ?? 0} tiers</span>
                      {range && <span>{range}</span>}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => removeRatebook(assignment.id)}
                    disabled={saving}
                    title="Remove default ratebook"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-danger/20 bg-danger/8 px-4 py-2 text-xs text-danger">
          {error}
        </div>
      )}
    </Card>
  );
}

export function ClientDetail({
  customer: initialCustomer,
  projects,
  users = [],
  departments = [],
}: {
  customer: CustomerWithContacts | null;
  projects: ProjectListItem[];
  users?: OrgUser[];
  departments?: OrgDepartment[];
}) {
  const [customer, setCustomer] = useState<CustomerWithContacts | null>(initialCustomer);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [activeTab, setActiveTab] = useState<ClientTab>("overview");
  const [editForm, setEditForm] = useState<EditableCustomerFields>(() => ({
    name: initialCustomer?.name ?? "",
    shortName: initialCustomer?.shortName ?? "",
    phone: initialCustomer?.phone ?? "",
    email: initialCustomer?.email ?? "",
    website: initialCustomer?.website ?? "",
    addressStreet: initialCustomer?.addressStreet ?? "",
    addressCity: initialCustomer?.addressCity ?? "",
    addressProvince: initialCustomer?.addressProvince ?? "",
    addressPostalCode: initialCustomer?.addressPostalCode ?? "",
    addressCountry: initialCustomer?.addressCountry ?? "",
    notes: initialCustomer?.notes ?? "",
  }));

  useEffect(() => {
    setCustomer(initialCustomer);
    setEditForm({
      name: initialCustomer?.name ?? "",
      shortName: initialCustomer?.shortName ?? "",
      phone: initialCustomer?.phone ?? "",
      email: initialCustomer?.email ?? "",
      website: initialCustomer?.website ?? "",
      addressStreet: initialCustomer?.addressStreet ?? "",
      addressCity: initialCustomer?.addressCity ?? "",
      addressProvince: initialCustomer?.addressProvince ?? "",
      addressPostalCode: initialCustomer?.addressPostalCode ?? "",
      addressCountry: initialCustomer?.addressCountry ?? "",
      notes: initialCustomer?.notes ?? "",
    });
  }, [initialCustomer]);

  const scopedProjects = useMemo(() => {
    const quotes = quotedProjects(projects);
    if (customer) return quotes.filter((project) => projectMatchesCustomer(project, customer));
    return [];
  }, [customer, projects]);

  const metrics = useMemo(() => calculateClientMetrics(scopedProjects), [scopedProjects]);
  const displayName = customer?.name || "Client not found";
  const active = customer?.active ?? true;

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return;
    if (!editForm.name.trim()) {
      setEditError("Client name is required.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await updateCustomer(customer.id, editForm);
      setCustomer({ ...customer, ...updated });
      setEditOpen(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not update client.");
    } finally {
      setEditSaving(false);
    }
  }

  if (!customer) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState className="max-w-lg px-8">
          <Building2 className="mx-auto mb-2 h-8 w-8 text-fg/20" />
          Client not found.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/clients" className="mb-3 inline-flex items-center gap-1.5 text-xs text-fg/45 transition-colors hover:text-accent">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to clients
          </Link>
          <ClientIdentity name={displayName} active={active} />
        </div>
        <div className="flex items-center gap-2">
          {customer && (
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              <PencilLine className="h-3.5 w-3.5" />
              Edit Profile
            </Button>
          )}
          <Button variant="accent" size="sm" asChild>
            <Link href="/quotes">
              <Plus className="h-3.5 w-3.5" />
              New Quote
            </Link>
          </Button>
        </div>
      </div>
      </div>

      <div className="grid shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCell
          icon={CircleDollarSign}
          label="Quoted"
          value={formatCompactMoney(metrics.totalValue)}
          sub={`${metrics.quoteCount} quote${metrics.quoteCount === 1 ? "" : "s"}`}
        />
        <KpiCell
          icon={TrendingUp}
          label="Active"
          value={formatCompactMoney(metrics.activeValue)}
          sub={`${metrics.activeCount} active pursuit${metrics.activeCount === 1 ? "" : "s"}`}
        />
        <KpiCell
          icon={CheckCircle2}
          label="Awarded"
          value={formatCompactMoney(metrics.wonValue)}
          sub={`${metrics.wonCount} awarded`}
        />
        <KpiCell
          icon={Gauge}
          label="Win Rate"
          value={metrics.wonCount + metrics.lostCount > 0 ? formatPercent(metrics.winRate) : "-"}
          sub={`${metrics.wonCount + metrics.lostCount} decided`}
        />
        <KpiCell
          icon={ClipboardList}
          label="Avg Margin"
          value={metrics.quoteCount > 0 ? formatPercent(metrics.avgMargin) : "-"}
          sub={`${formatCompactMoney(metrics.totalProfit)} est. profit`}
        />
        <KpiCell
          icon={CalendarClock}
          label="Last Touch"
          value={formatDate(metrics.lastActivityAt)}
          sub={daysSince(metrics.lastActivityAt) == null ? "No quote activity" : `${daysSince(metrics.lastActivityAt)} days ago`}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-panel p-1">
        {CLIENT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "bg-accent text-accent-fg"
                : "text-fg/55 hover:bg-panel2 hover:text-fg",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "overview" && (
          <div className="h-full min-h-0 overflow-auto xl:overflow-hidden">
            <div className="grid min-h-full gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-h-[320px] min-w-0 xl:min-h-0">
                <QuoteList className="h-full" projects={scopedProjects} users={users} departments={departments} />
              </div>
              <div className="min-h-0 space-y-4 xl:overflow-auto xl:pr-1">
                <StageDistribution projects={scopedProjects} />
                <SignalPanel projects={scopedProjects} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "quotes" && (
          <QuoteList className="h-full" projects={scopedProjects} users={users} departments={departments} />
        )}

        {activeTab === "profile" && (
          <div className="h-full min-h-0 overflow-auto xl:overflow-hidden">
            <div className="grid min-h-full gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_420px]">
              <ProfilePanel className="min-h-[320px] xl:min-h-0" customer={customer} onEdit={() => setEditOpen(true)} />
              <ContactsPanel className="min-h-[320px] xl:min-h-0" customer={customer} />
            </div>
          </div>
        )}

        {activeTab === "ratebooks" && (
          <ClientRatebooksPanel customer={customer} />
        )}
      </div>

      <ModalBackdrop open={editOpen} onClose={() => !editSaving && setEditOpen(false)} size="xl">
        <form onSubmit={handleProfileSubmit} className="rounded-lg border border-line bg-panel shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-fg">Edit client profile</h2>
              <p className="mt-0.5 text-xs text-fg/50">Updates the customer record used across quotes.</p>
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={editSaving}
              className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
              aria-label="Close edit client dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Name</Label>
              <Input autoFocus value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Short Name</Label>
              <Input value={editForm.shortName} onChange={(event) => setEditForm((form) => ({ ...form, shortName: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Website</Label>
              <Input value={editForm.website} onChange={(event) => setEditForm((form) => ({ ...form, website: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={editForm.email} onChange={(event) => setEditForm((form) => ({ ...form, email: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={(event) => setEditForm((form) => ({ ...form, phone: event.target.value }))} disabled={editSaving} />
            </div>
            <div className="sm:col-span-2">
              <Label>Street</Label>
              <Input value={editForm.addressStreet} onChange={(event) => setEditForm((form) => ({ ...form, addressStreet: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={editForm.addressCity} onChange={(event) => setEditForm((form) => ({ ...form, addressCity: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Province / State</Label>
              <Input value={editForm.addressProvince} onChange={(event) => setEditForm((form) => ({ ...form, addressProvince: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Postal / Zip</Label>
              <Input value={editForm.addressPostalCode} onChange={(event) => setEditForm((form) => ({ ...form, addressPostalCode: event.target.value }))} disabled={editSaving} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={editForm.addressCountry} onChange={(event) => setEditForm((form) => ({ ...form, addressCountry: event.target.value }))} disabled={editSaving} />
            </div>
            <div className="sm:col-span-2">
              <Label>Notes</Label>
              <Input value={editForm.notes} onChange={(event) => setEditForm((form) => ({ ...form, notes: event.target.value }))} disabled={editSaving} />
            </div>
            {editError && (
              <div className="sm:col-span-2 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-xs text-danger">
                {editError}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="accent" size="sm" disabled={editSaving}>
              {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save Profile
            </Button>
          </div>
        </form>
      </ModalBackdrop>
    </div>
  );
}
