"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Calendar,
  Check,
  Edit3,
  Loader2,
  Percent,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BurdenPeriod } from "@/lib/api";
import {
  listBurdenPeriods,
  createBurdenPeriod,
  updateBurdenPeriod,
  deleteBurdenPeriod,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Label,
  Select,
} from "@/components/ui";

/* ─── Constants ─── */

const GROUPS = ["MECH", "ELEC", "INST", "PIPE", "CIVIL", "STRUCT", "GENERAL"] as const;

function isActive(period: BurdenPeriod): boolean {
  const now = new Date();
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);
  return now >= start && now <= end;
}

/* ─── Component ─── */

export function BurdenManager() {
  const [periods, setPeriods] = useState<BurdenPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState("");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newForm, setNewForm] = useState({
    name: "",
    group: "MECH",
    percentage: "",
    startDate: "",
    endDate: "",
  });

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    group: "",
    percentage: "",
    startDate: "",
    endDate: "",
  });

  // Confirm delete
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ─── Load ─── */

  useEffect(() => {
    setLoading(true);
    listBurdenPeriods()
      .then((data) => setPeriods(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ─── Filtered ─── */

  const filtered = useMemo(() => {
    let list = periods;
    if (groupFilter) {
      list = list.filter((p) => p.group === groupFilter);
    }
    return list.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [periods, groupFilter]);

  /* ─── CRUD ─── */

  const handleCreate = useCallback(async () => {
    if (!newForm.name.trim() || !newForm.startDate || !newForm.endDate) return;
    try {
      const created = await createBurdenPeriod({
        name: newForm.name.trim(),
        group: newForm.group,
        percentage: parseFloat(newForm.percentage) || 0,
        startDate: newForm.startDate,
        endDate: newForm.endDate,
      });
      setPeriods((prev) => [...prev, created]);
      setNewForm({ name: "", group: "MECH", percentage: "", startDate: "", endDate: "" });
      setShowAdd(false);
    } catch (err) {
      console.error("Failed to create burden period:", err);
    }
  }, [newForm]);

  const handleUpdate = useCallback(async () => {
    if (!editingId) return;
    try {
      const updated = await updateBurdenPeriod(editingId, {
        name: editForm.name,
        group: editForm.group,
        percentage: parseFloat(editForm.percentage) || 0,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
      });
      setPeriods((prev) => prev.map((p) => (p.id === editingId ? updated : p)));
      setEditingId(null);
    } catch (err) {
      console.error("Failed to update burden period:", err);
    }
  }, [editingId, editForm]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteBurdenPeriod(id);
      setPeriods((prev) => prev.filter((p) => p.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete burden period:", err);
    }
  }, []);

  const startEdit = useCallback((period: BurdenPeriod) => {
    setEditingId(period.id);
    setEditForm({
      name: period.name,
      group: period.group,
      percentage: String(period.percentage),
      startDate: period.startDate.slice(0, 10),
      endDate: period.endDate.slice(0, 10),
    });
  }, []);

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
          <CardTitle>Burden Periods</CardTitle>
          <div className="flex items-center gap-2">
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
            <Button variant="accent" size="xs" onClick={() => setShowAdd(true)}>
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
        </CardHeader>

        {/* Add form */}
        <AnimatePresence>
          {showAdd && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-line"
            >
              <div className="px-5 py-4 space-y-3">
                <div className="grid grid-cols-5 gap-3">
                  <div>
                    <Label className="text-[10px]">Name</Label>
                    <Input
                      value={newForm.name}
                      onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Q1 2024"
                      className="h-7 text-xs"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">Group</Label>
                    <Select
                      value={newForm.group}
                      onChange={(e) => setNewForm((f) => ({ ...f, group: e.target.value }))}
                      className="h-7 text-xs"
                    >
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Percentage</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newForm.percentage}
                      onChange={(e) => setNewForm((f) => ({ ...f, percentage: e.target.value }))}
                      placeholder="e.g. 35.5"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">Start Date</Label>
                    <Input
                      type="date"
                      value={newForm.startDate}
                      onChange={(e) => setNewForm((f) => ({ ...f, startDate: e.target.value }))}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">End Date</Label>
                    <Input
                      type="date"
                      value={newForm.endDate}
                      onChange={(e) => setNewForm((f) => ({ ...f, endDate: e.target.value }))}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="accent" size="xs" onClick={handleCreate}>Create Period</Button>
                  <Button variant="ghost" size="xs" onClick={() => setShowAdd(false)}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table */}
        <div className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-panel2/60 border-b border-line">
                <th className="text-left px-4 py-2.5 font-medium text-fg/60">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-fg/60">Group</th>
                <th className="text-right px-4 py-2.5 font-medium text-fg/60">Percentage</th>
                <th className="text-left px-4 py-2.5 font-medium text-fg/60">Start Date</th>
                <th className="text-left px-4 py-2.5 font-medium text-fg/60">End Date</th>
                <th className="text-center px-4 py-2.5 font-medium text-fg/60">Status</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-fg/40">
                    No burden periods configured. Click &quot;Add&quot; to get started.
                  </td>
                </tr>
              )}
              {filtered.map((period) => (
                <tr key={period.id} className="hover:bg-panel2/30 transition-colors group">
                  {editingId === period.id ? (
                    <>
                      <td className="px-4 py-2">
                        <Input
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="h-6 text-xs"
                          autoFocus
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Select
                          value={editForm.group}
                          onChange={(e) => setEditForm((f) => ({ ...f, group: e.target.value }))}
                          className="h-6 text-xs"
                        >
                          {GROUPS.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.percentage}
                          onChange={(e) => setEditForm((f) => ({ ...f, percentage: e.target.value }))}
                          className="h-6 text-xs text-right w-20 ml-auto"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="date"
                          value={editForm.startDate}
                          onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                          className="h-6 text-xs"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="date"
                          value={editForm.endDate}
                          onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                          className="h-6 text-xs"
                        />
                      </td>
                      <td />
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={handleUpdate} className="p-1 hover:text-success transition-colors">
                            <Check className="h-3 w-3" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 hover:text-fg/60 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium">{period.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone="info" className="text-[10px]">{period.group}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{period.percentage}%</td>
                      <td className="px-4 py-2.5 text-fg/60">{new Date(period.startDate).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 text-fg/60">{new Date(period.endDate).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 text-center">
                        {isActive(period) ? (
                          <Badge tone="success" className="text-[10px]">Active</Badge>
                        ) : (
                          <Badge tone="default" className="text-[10px]">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(period)} className="p-1 hover:text-accent transition-colors">
                            <Edit3 className="h-3 w-3" />
                          </button>
                          {deleteConfirm === period.id ? (
                            <div className="flex items-center gap-1">
                              <Button variant="danger" size="xs" onClick={() => handleDelete(period.id)}>Yes</Button>
                              <Button variant="ghost" size="xs" onClick={() => setDeleteConfirm(null)}>No</Button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirm(period.id)} className="p-1 hover:text-danger transition-colors">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </FadeIn>
  );
}
