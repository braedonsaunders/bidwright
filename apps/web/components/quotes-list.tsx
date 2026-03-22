"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowUpDown,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, formatDate } from "@/lib/format";
import type { ProjectListItem } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Select,
} from "@/components/ui";

type SortKey =
  | "quoteNumber"
  | "title"
  | "client"
  | "status"
  | "subtotal"
  | "margin"
  | "updated";

type SortDir = "asc" | "desc";

const STATUS_OPTIONS = [
  "All",
  "Open",
  "Pending",
  "Awarded",
  "DidNotGet",
  "Declined",
  "Cancelled",
  "Closed",
  "Other",
] as const;

function statusTone(status: string) {
  switch (status) {
    case "Open":
      return "info" as const;
    case "Pending":
      return "warning" as const;
    case "Awarded":
      return "success" as const;
    case "DidNotGet":
    case "Declined":
    case "Cancelled":
      return "danger" as const;
    case "Closed":
      return "default" as const;
    default:
      return "default" as const;
  }
}

export function QuotesList({ projects }: { projects: ProjectListItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let list = [...projects];

    if (statusFilter !== "All") {
      list = list.filter(
        (p) => p.quote.status === statusFilter
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.quote.quoteNumber.toLowerCase().includes(q) ||
          p.quote.title.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "quoteNumber":
          cmp = a.quote.quoteNumber.localeCompare(b.quote.quoteNumber);
          break;
        case "title":
          cmp = a.quote.title.localeCompare(b.quote.title);
          break;
        case "client":
          cmp = a.clientName.localeCompare(b.clientName);
          break;
        case "status":
          cmp = a.quote.status.localeCompare(b.quote.status);
          break;
        case "subtotal":
          cmp = a.latestRevision.subtotal - b.latestRevision.subtotal;
          break;
        case "margin":
          cmp =
            a.latestRevision.estimatedMargin -
            b.latestRevision.estimatedMargin;
          break;
        case "updated":
          cmp =
            new Date(a.updatedAt).getTime() -
            new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [projects, search, statusFilter, sortKey, sortDir]);

  const totalValue = projects.reduce(
    (sum, p) => sum + p.latestRevision.subtotal,
    0
  );
  const avgMargin =
    projects.length > 0
      ? projects.reduce(
          (sum, p) => sum + p.latestRevision.estimatedMargin,
          0
        ) / projects.length
      : 0;

  const headers: { key: SortKey; label: string; className?: string }[] = [
    { key: "quoteNumber", label: "Quote #", className: "w-28" },
    { key: "title", label: "Title" },
    { key: "client", label: "Client", className: "w-40" },
    { key: "status", label: "Status", className: "w-28" },
    { key: "subtotal", label: "Subtotal", className: "w-32 text-right" },
    { key: "margin", label: "Margin", className: "w-24 text-right" },
    { key: "updated", label: "Updated", className: "w-32" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Quotes</h1>
            <p className="text-xs text-fg/50">
              Manage and track all your quotes
            </p>
          </div>
          <Link href="/intake">
            <Button variant="accent" size="sm">
              <Plus className="h-3.5 w-3.5" />
              New Quote
            </Button>
          </Link>
        </div>
      </FadeIn>

      {/* Summary stats */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <div className="px-5 py-4">
              <p className="text-xs text-fg/50">Total Quotes</p>
              <p className="mt-1 text-xl font-semibold text-fg">
                {projects.length}
              </p>
            </div>
          </Card>
          <Card>
            <div className="px-5 py-4">
              <p className="text-xs text-fg/50">Total Value</p>
              <p className="mt-1 text-xl font-semibold text-fg">
                {formatMoney(totalValue)}
              </p>
            </div>
          </Card>
          <Card>
            <div className="px-5 py-4">
              <p className="text-xs text-fg/50">Avg Margin</p>
              <p className="mt-1 text-xl font-semibold text-fg">
                {formatPercent(avgMargin)}
              </p>
            </div>
          </Card>
        </div>
      </FadeIn>

      {/* Filter bar */}
      <FadeIn delay={0.1}>
        <Card>
          <div className="flex items-center gap-3 px-5 py-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Search quotes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              className="h-8 w-40 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "DidNotGet" ? "Did Not Get" : s}
                </option>
              ))}
            </Select>
          </div>
        </Card>
      </FadeIn>

      {/* Table */}
      <FadeIn delay={0.15}>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {headers.map((h) => (
                    <th
                      key={h.key}
                      className={cn(
                        "px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 cursor-pointer select-none hover:text-fg/70 transition-colors",
                        h.className
                      )}
                      onClick={() => handleSort(h.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {h.label}
                        <ArrowUpDown
                          className={cn(
                            "h-3 w-3",
                            sortKey === h.key
                              ? "text-accent"
                              : "text-fg/20"
                          )}
                        />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={headers.length}
                      className="px-5 py-12 text-center text-sm text-fg/40"
                    >
                      <FileText className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                      No quotes found
                    </td>
                  </tr>
                )}
                {filtered.map((project, i) => (
                  <motion.tr
                    key={project.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.2,
                      delay: i * 0.02,
                      ease: "easeOut",
                    }}
                    className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors"
                  >
                    <td className="px-5 py-3 text-xs font-medium text-accent">
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:underline"
                      >
                        {project.quote.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-xs text-fg/80">
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:underline"
                      >
                        {project.quote.title || project.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-xs text-fg/60">
                      {project.clientName || "\u2014"}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(project.quote.status)}>
                        {project.quote.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right text-xs font-medium text-fg/80">
                      {formatMoney(project.latestRevision.subtotal)}
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-fg/60">
                      {formatPercent(
                        project.latestRevision.estimatedMargin
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-fg/50">
                      {formatDate(project.updatedAt)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
