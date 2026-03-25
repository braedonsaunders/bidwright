"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronRight,
  DollarSign,
  Edit3,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LabourCostTableWithEntries, LabourCostEntry } from "@/lib/api";
import {
  listLabourCostTables,
  getLabourCostTable,
  createLabourCostTable,
  updateLabourCostTable,
  deleteLabourCostTable,
  createLabourCostEntry,
  updateLabourCostEntry,
  deleteLabourCostEntry,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FadeIn,
  Input,
  Label,
  Select,
} from "@/components/ui";

/* ─── Constants ─── */

const GROUPS = ["MECH", "ELEC", "INST", "PIPE", "CIVIL", "STRUCT", "GENERAL"] as const;
const RATE_KEYS = ["regular", "ot", "dt"] as const;
const RATE_LABELS: Record<string, string> = { regular: "Regular", ot: "OT", dt: "DT" };

/* ─── Component ─── */

export function LabourCostManager() {
  const [tables, setTables] = useState<LabourCostTableWithEntries[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LabourCostTableWithEntries | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");

  // Create table form
  const [showCreate, setShowCreate] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", description: "", effectiveDate: "", expiryDate: "" });

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ entryId: string; rateKey: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Editing entry fields
  const [editingField, setEditingField] = useState<{ entryId: string; field: "code" | "name" | "group" } | null>(null);
  const [editFieldValue, setEditFieldValue] = useState("");

  // New entry form
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [newEntry, setNewEntry] = useState({ code: "", name: "", group: "MECH" });

  // Edit table header
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState({ name: "", description: "" });

  // Confirm delete
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ─── Load tables ─── */

  useEffect(() => {
    setLoading(true);
    listLabourCostTables()
      .then((data) => setTables(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ─── Filtered entries ─── */

  const filteredEntries = useMemo(() => {
    if (!detail) return [];
    let entries = detail.entries;
    if (search.trim()) {
      const q = search.toLowerCase();
      entries = entries.filter(
        (e) => e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
      );
    }
    if (groupFilter) {
      entries = entries.filter((e) => e.group === groupFilter);
    }
    return entries.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [detail, search, groupFilter]);

  /* ─── Load detail ─── */

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setEditingCell(null);
    setEditingField(null);
    setShowAddEntry(false);
    setEditingHeader(false);
    try {
      const full = await getLabourCostTable(id);
      setDetail(full);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  /* ─── Table CRUD ─── */

  const handleCreate = useCallback(async () => {
    if (!newForm.name.trim()) return;
    try {
      const created = await createLabourCostTable({
        name: newForm.name.trim(),
        description: newForm.description,
        effectiveDate: newForm.effectiveDate || undefined,
        expiryDate: newForm.expiryDate || undefined,
      });
      setTables((prev) => [...prev, created]);
      setNewForm({ name: "", description: "", effectiveDate: "", expiryDate: "" });
      setShowCreate(false);
      loadDetail(created.id);
    } catch (err) {
      console.error("Failed to create labour cost table:", err);
    }
  }, [newForm, loadDetail]);

  const handleDeleteTable = useCallback(async (id: string) => {
    try {
      await deleteLabourCostTable(id);
      setTables((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete table:", err);
    }
  }, [selectedId]);

  const handleUpdateHeader = useCallback(async () => {
    if (!detail) return;
    try {
      const updated = await updateLabourCostTable(detail.id, {
        name: headerForm.name,
        description: headerForm.description,
      });
      setDetail({ ...detail, ...updated });
      setTables((prev) => prev.map((t) => (t.id === detail.id ? { ...t, ...updated } : t)));
      setEditingHeader(false);
    } catch (err) {
      console.error("Failed to update table:", err);
    }
  }, [detail, headerForm]);

  /* ─── Entry CRUD ─── */

  const handleAddEntry = useCallback(async () => {
    if (!detail || !newEntry.code.trim() || !newEntry.name.trim()) return;
    try {
      const updated = await createLabourCostEntry(detail.id, {
        code: newEntry.code.trim(),
        name: newEntry.name.trim(),
        group: newEntry.group,
        costRates: { regular: 0, ot: 0, dt: 0 },
        sortOrder: detail.entries.length,
      });
      setDetail(updated);
      setNewEntry({ code: "", name: "", group: "MECH" });
      setShowAddEntry(false);
    } catch (err) {
      console.error("Failed to add entry:", err);
    }
  }, [detail, newEntry]);

  const handleDeleteEntry = useCallback(async (entryId: string) => {
    if (!detail) return;
    try {
      const updated = await deleteLabourCostEntry(detail.id, entryId);
      setDetail(updated);
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  }, [detail]);

  const handleSaveRate = useCallback(async (entryId: string, rateKey: string) => {
    if (!detail) return;
    const entry = detail.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const newRates = { ...entry.costRates, [rateKey]: parseFloat(editValue) || 0 };
    try {
      const updated = await updateLabourCostEntry(detail.id, entryId, { costRates: newRates });
      setDetail(updated);
    } catch (err) {
      console.error("Failed to update rate:", err);
    }
    setEditingCell(null);
  }, [detail, editValue]);

  const handleSaveField = useCallback(async (entryId: string, field: "code" | "name" | "group") => {
    if (!detail) return;
    try {
      const updated = await updateLabourCostEntry(detail.id, entryId, { [field]: editFieldValue });
      setDetail(updated);
    } catch (err) {
      console.error("Failed to update entry:", err);
    }
    setEditingField(null);
  }, [detail, editFieldValue]);

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-fg/30" />
      </div>
    );
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Labour Cost Tables</CardTitle>
          <Button variant="accent" size="xs" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3" />
            New Table
          </Button>
        </CardHeader>

        {/* Create form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-line"
            >
              <div className="px-5 py-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={newForm.name}
                      onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. 2024 Master Rates"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={newForm.description}
                      onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Optional description"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Effective Date</Label>
                    <Input
                      type="date"
                      value={newForm.effectiveDate}
                      onChange={(e) => setNewForm((f) => ({ ...f, effectiveDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Expiry Date</Label>
                    <Input
                      type="date"
                      value={newForm.expiryDate}
                      onChange={(e) => setNewForm((f) => ({ ...f, expiryDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="accent" size="xs" onClick={handleCreate}>Create Table</Button>
                  <Button variant="ghost" size="xs" onClick={() => setShowCreate(false)}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table list */}
        {tables.length === 0 && !showCreate && (
          <div className="px-5 py-8 text-center text-xs text-fg/40">
            No labour cost tables configured. Click &quot;New Table&quot; to get started.
          </div>
        )}

        <div className="divide-y divide-line">
          {tables.map((table) => (
            <div key={table.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => selectedId === table.id ? (setSelectedId(null), setDetail(null)) : loadDetail(table.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectedId === table.id ? (setSelectedId(null), setDetail(null)) : loadDetail(table.id); } }}
                className={cn("flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer", selectedId === table.id && "bg-accent/5")}
              >
                {selectedId === table.id ? <ChevronDown className="h-3.5 w-3.5 text-fg/40 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/40 shrink-0" />}
                <DollarSign className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="font-medium text-fg truncate">{table.name}</span>
                <Badge className="text-[10px] shrink-0">{table.entries.length} entries</Badge>
                {table.effectiveDate && (
                  <span className="text-[10px] text-fg/40 shrink-0">from {new Date(table.effectiveDate).toLocaleDateString()}</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  {deleteConfirm === table.id ? (
                    <>
                      <span className="text-[10px] text-danger mr-1">Delete?</span>
                      <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); handleDeleteTable(table.id); }}>Yes</Button>
                      <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}>No</Button>
                    </>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(table.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-danger transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Detail panel */}
              <AnimatePresence>
                {selectedId === table.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-line bg-panel2/30"
                  >
                    {loadingDetail ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-4 w-4 animate-spin text-fg/30" />
                      </div>
                    ) : detail ? (
                      <div className="px-5 py-4 space-y-4">
                        {/* Header edit */}
                        {editingHeader ? (
                          <div className="flex items-end gap-3">
                            <div className="flex-1">
                              <Label>Name</Label>
                              <Input
                                value={headerForm.name}
                                onChange={(e) => setHeaderForm((f) => ({ ...f, name: e.target.value }))}
                              />
                            </div>
                            <div className="flex-1">
                              <Label>Description</Label>
                              <Input
                                value={headerForm.description}
                                onChange={(e) => setHeaderForm((f) => ({ ...f, description: e.target.value }))}
                              />
                            </div>
                            <Button variant="accent" size="xs" onClick={handleUpdateHeader}>Save</Button>
                            <Button variant="ghost" size="xs" onClick={() => setEditingHeader(false)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium">{detail.name}</h3>
                            {detail.description && <span className="text-xs text-fg/50">- {detail.description}</span>}
                            <button
                              onClick={() => { setEditingHeader(true); setHeaderForm({ name: detail.name, description: detail.description || "" }); }}
                              className="p-1 hover:text-accent transition-colors"
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                          </div>
                        )}

                        {/* Filters */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1 max-w-xs">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-fg/30" />
                            <Input
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              placeholder="Search entries..."
                              className="pl-7 h-7 text-xs"
                            />
                          </div>
                          <Select
                            value={groupFilter}
                            onChange={(e) => setGroupFilter(e.target.value)}
                            className="h-7 text-xs w-32"
                          >
                            <option value="">All Groups</option>
                            {GROUPS.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </Select>
                          <Button variant="accent" size="xs" onClick={() => setShowAddEntry(true)}>
                            <Plus className="h-3 w-3" />
                            Add Entry
                          </Button>
                        </div>

                        {/* Add entry form */}
                        <AnimatePresence>
                          {showAddEntry && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="flex items-end gap-2 p-3 rounded-lg border border-line bg-panel">
                                <div>
                                  <Label className="text-[10px]">Code</Label>
                                  <Input
                                    value={newEntry.code}
                                    onChange={(e) => setNewEntry((f) => ({ ...f, code: e.target.value }))}
                                    placeholder="e.g. JM"
                                    className="h-7 text-xs w-20"
                                    autoFocus
                                  />
                                </div>
                                <div className="flex-1">
                                  <Label className="text-[10px]">Name</Label>
                                  <Input
                                    value={newEntry.name}
                                    onChange={(e) => setNewEntry((f) => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Journeyman Mechanic"
                                    className="h-7 text-xs"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px]">Group</Label>
                                  <Select
                                    value={newEntry.group}
                                    onChange={(e) => setNewEntry((f) => ({ ...f, group: e.target.value }))}
                                    className="h-7 text-xs w-28"
                                  >
                                    {GROUPS.map((g) => (
                                      <option key={g} value={g}>{g}</option>
                                    ))}
                                  </Select>
                                </div>
                                <Button variant="accent" size="xs" onClick={handleAddEntry}>Add</Button>
                                <Button variant="ghost" size="xs" onClick={() => setShowAddEntry(false)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Entries table */}
                        <div className="rounded-lg border border-line overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-panel2/60">
                                <th className="text-left px-3 py-2 font-medium text-fg/60">Code</th>
                                <th className="text-left px-3 py-2 font-medium text-fg/60">Name</th>
                                <th className="text-left px-3 py-2 font-medium text-fg/60">Group</th>
                                {RATE_KEYS.map((k) => (
                                  <th key={k} className="text-right px-3 py-2 font-medium text-fg/60">{RATE_LABELS[k]} Cost</th>
                                ))}
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {filteredEntries.length === 0 && (
                                <tr>
                                  <td colSpan={6} className="px-3 py-6 text-center text-fg/40">
                                    No entries yet. Click &quot;Add Entry&quot; to add labour classifications.
                                  </td>
                                </tr>
                              )}
                              {filteredEntries.map((entry) => (
                                <tr key={entry.id} className="hover:bg-panel2/30 transition-colors group">
                                  {/* Code */}
                                  <td className="px-3 py-2">
                                    {editingField?.entryId === entry.id && editingField.field === "code" ? (
                                      <Input
                                        value={editFieldValue}
                                        onChange={(e) => setEditFieldValue(e.target.value)}
                                        onBlur={() => handleSaveField(entry.id, "code")}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveField(entry.id, "code"); if (e.key === "Escape") setEditingField(null); }}
                                        className="h-6 text-xs w-16"
                                        autoFocus
                                      />
                                    ) : (
                                      <span
                                        className="cursor-pointer hover:text-accent transition-colors font-mono"
                                        onClick={() => { setEditingField({ entryId: entry.id, field: "code" }); setEditFieldValue(entry.code); }}
                                      >
                                        {entry.code || "-"}
                                      </span>
                                    )}
                                  </td>
                                  {/* Name */}
                                  <td className="px-3 py-2">
                                    {editingField?.entryId === entry.id && editingField.field === "name" ? (
                                      <Input
                                        value={editFieldValue}
                                        onChange={(e) => setEditFieldValue(e.target.value)}
                                        onBlur={() => handleSaveField(entry.id, "name")}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveField(entry.id, "name"); if (e.key === "Escape") setEditingField(null); }}
                                        className="h-6 text-xs"
                                        autoFocus
                                      />
                                    ) : (
                                      <span
                                        className="cursor-pointer hover:text-accent transition-colors"
                                        onClick={() => { setEditingField({ entryId: entry.id, field: "name" }); setEditFieldValue(entry.name); }}
                                      >
                                        {entry.name || "-"}
                                      </span>
                                    )}
                                  </td>
                                  {/* Group */}
                                  <td className="px-3 py-2">
                                    <Badge tone="info" className="text-[10px]">{entry.group}</Badge>
                                  </td>
                                  {/* Rates */}
                                  {RATE_KEYS.map((rateKey) => (
                                    <td key={rateKey} className="px-3 py-2 text-right">
                                      {editingCell?.entryId === entry.id && editingCell.rateKey === rateKey ? (
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onBlur={() => handleSaveRate(entry.id, rateKey)}
                                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveRate(entry.id, rateKey); if (e.key === "Escape") setEditingCell(null); }}
                                          className="h-6 text-xs text-right w-20 ml-auto"
                                          autoFocus
                                        />
                                      ) : (
                                        <span
                                          className="cursor-pointer hover:text-accent transition-colors font-mono"
                                          onClick={() => { setEditingCell({ entryId: entry.id, rateKey }); setEditValue(String(entry.costRates[rateKey] ?? 0)); }}
                                        >
                                          ${(entry.costRates[rateKey] ?? 0).toFixed(2)}
                                        </span>
                                      )}
                                    </td>
                                  ))}
                                  {/* Delete */}
                                  <td className="px-2 py-2">
                                    <button
                                      onClick={() => handleDeleteEntry(entry.id)}
                                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-danger transition-all"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </Card>
    </FadeIn>
  );
}
