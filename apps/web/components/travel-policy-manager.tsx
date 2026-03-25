"use client";

import { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TravelPolicy, PerDiemEmbedMode, FuelSurchargeAppliesTo } from "@/lib/api";
import {
  listTravelPolicies,
  getTravelPolicy,
  createTravelPolicy,
  updateTravelPolicy,
  deleteTravelPolicy,
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
  Separator,
  Toggle,
} from "@/components/ui";

/* ─── Defaults ─── */

const DEFAULT_FORM = {
  name: "",
  description: "",
  perDiemRate: "0",
  perDiemEmbedMode: "separate" as PerDiemEmbedMode,
  hoursPerDay: "10",
  travelTimeHours: "0",
  travelTimeTrips: "0",
  kmToDestination: "0",
  mileageRate: "0",
  fuelSurchargePercent: "0",
  fuelSurchargeAppliesTo: "none" as FuelSurchargeAppliesTo,
  accommodationRate: "0",
  accommodationNights: "0",
  showAsSeparateLine: false,
  breakoutLabel: "",
};

type FormState = typeof DEFAULT_FORM;

function policyToForm(p: TravelPolicy): FormState {
  return {
    name: p.name,
    description: p.description || "",
    perDiemRate: String(p.perDiemRate),
    perDiemEmbedMode: p.perDiemEmbedMode,
    hoursPerDay: String(p.hoursPerDay),
    travelTimeHours: String(p.travelTimeHours),
    travelTimeTrips: String(p.travelTimeTrips),
    kmToDestination: String(p.kmToDestination),
    mileageRate: String(p.mileageRate),
    fuelSurchargePercent: String(p.fuelSurchargePercent),
    fuelSurchargeAppliesTo: p.fuelSurchargeAppliesTo,
    accommodationRate: String(p.accommodationRate),
    accommodationNights: String(p.accommodationNights),
    showAsSeparateLine: p.showAsSeparateLine,
    breakoutLabel: p.breakoutLabel || "",
  };
}

function formToPayload(f: FormState) {
  return {
    name: f.name.trim(),
    description: f.description,
    perDiemRate: parseFloat(f.perDiemRate) || 0,
    perDiemEmbedMode: f.perDiemEmbedMode,
    hoursPerDay: parseFloat(f.hoursPerDay) || 10,
    travelTimeHours: parseFloat(f.travelTimeHours) || 0,
    travelTimeTrips: parseFloat(f.travelTimeTrips) || 0,
    kmToDestination: parseFloat(f.kmToDestination) || 0,
    mileageRate: parseFloat(f.mileageRate) || 0,
    fuelSurchargePercent: parseFloat(f.fuelSurchargePercent) || 0,
    fuelSurchargeAppliesTo: f.fuelSurchargeAppliesTo,
    accommodationRate: parseFloat(f.accommodationRate) || 0,
    accommodationNights: parseFloat(f.accommodationNights) || 0,
    showAsSeparateLine: f.showAsSeparateLine,
    breakoutLabel: f.breakoutLabel,
  };
}

/* ─── Section component for form grouping ─── */

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-fg/60 uppercase tracking-wider">{title}</h4>
      <div className="grid grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  );
}

/* ─── Component ─── */

export function TravelPolicyManager() {
  const [policies, setPolicies] = useState<TravelPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TravelPolicy | null>(null);

  // Create / edit
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /* ─── Load ─── */

  useEffect(() => {
    setLoading(true);
    listTravelPolicies()
      .then((data) => setPolicies(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ─── CRUD ─── */

  const handleCreate = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const created = await createTravelPolicy(formToPayload(form));
      setPolicies((prev) => [...prev, created]);
      setForm({ ...DEFAULT_FORM });
      setMode("list");
    } catch (err) {
      console.error("Failed to create travel policy:", err);
    } finally {
      setSaving(false);
    }
  }, [form]);

  const handleUpdate = useCallback(async () => {
    if (!selectedId || !form.name.trim()) return;
    setSaving(true);
    try {
      const updated = await updateTravelPolicy(selectedId, formToPayload(form));
      setPolicies((prev) => prev.map((p) => (p.id === selectedId ? updated : p)));
      setDetail(updated);
      setMode("list");
    } catch (err) {
      console.error("Failed to update travel policy:", err);
    } finally {
      setSaving(false);
    }
  }, [selectedId, form]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteTravelPolicy(id);
      setPolicies((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete travel policy:", err);
    }
  }, [selectedId]);

  const startEdit = useCallback((policy: TravelPolicy) => {
    setSelectedId(policy.id);
    setDetail(policy);
    setForm(policyToForm(policy));
    setMode("edit");
  }, []);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-fg/30" />
      </div>
    );
  }

  // Form view (create or edit)
  if (mode === "create" || mode === "edit") {
    return (
      <FadeIn>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{mode === "create" ? "New Travel Policy" : `Edit: ${detail?.name}`}</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="xs" onClick={() => { setMode("list"); setForm({ ...DEFAULT_FORM }); }}>
                <X className="h-3 w-3" />
                Cancel
              </Button>
              <Button
                variant="accent"
                size="xs"
                onClick={mode === "create" ? handleCreate : handleUpdate}
                disabled={saving || !form.name.trim()}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {mode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-6">
            {/* Basic info */}
            <FormSection title="Basic Information">
              <div>
                <Label className="text-[10px]">Policy Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g. Site Work Travel"
                  autoFocus
                />
              </div>
              <div className="col-span-2">
                <Label className="text-[10px]">Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </FormSection>

            <Separator />

            {/* Per Diem */}
            <FormSection title="Per Diem">
              <div>
                <Label className="text-[10px]">Per Diem Rate ($/day)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.perDiemRate}
                  onChange={(e) => updateField("perDiemRate", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Embed Mode</Label>
                <Select
                  value={form.perDiemEmbedMode}
                  onChange={(e) => updateField("perDiemEmbedMode", e.target.value as PerDiemEmbedMode)}
                >
                  <option value="separate">Separate Line</option>
                  <option value="embed_hourly">Embed in Hourly Rate</option>
                  <option value="embed_cost_only">Embed in Cost Only</option>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Hours Per Day</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.hoursPerDay}
                  onChange={(e) => updateField("hoursPerDay", e.target.value)}
                />
              </div>
            </FormSection>

            <Separator />

            {/* Travel Time */}
            <FormSection title="Travel Time">
              <div>
                <Label className="text-[10px]">Travel Hours (one way)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.travelTimeHours}
                  onChange={(e) => updateField("travelTimeHours", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Number of Trips</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.travelTimeTrips}
                  onChange={(e) => updateField("travelTimeTrips", e.target.value)}
                />
              </div>
              <div />
            </FormSection>

            <Separator />

            {/* Distance & Fuel */}
            <FormSection title="Distance & Fuel">
              <div>
                <Label className="text-[10px]">KM to Destination</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.kmToDestination}
                  onChange={(e) => updateField("kmToDestination", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Mileage Rate ($/km)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.mileageRate}
                  onChange={(e) => updateField("mileageRate", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Fuel Surcharge %</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.fuelSurchargePercent}
                  onChange={(e) => updateField("fuelSurchargePercent", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Fuel Surcharge Applies To</Label>
                <Select
                  value={form.fuelSurchargeAppliesTo}
                  onChange={(e) => updateField("fuelSurchargeAppliesTo", e.target.value as FuelSurchargeAppliesTo)}
                >
                  <option value="none">None</option>
                  <option value="labour">Labour Only</option>
                  <option value="all">All Costs</option>
                </Select>
              </div>
            </FormSection>

            <Separator />

            {/* Accommodation */}
            <FormSection title="Accommodation">
              <div>
                <Label className="text-[10px]">Accommodation Rate ($/night)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.accommodationRate}
                  onChange={(e) => updateField("accommodationRate", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px]">Number of Nights</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.accommodationNights}
                  onChange={(e) => updateField("accommodationNights", e.target.value)}
                />
              </div>
              <div />
            </FormSection>

            <Separator />

            {/* Display */}
            <FormSection title="Display Options">
              <div className="flex items-center gap-3 col-span-2">
                <Toggle
                  checked={form.showAsSeparateLine}
                  onChange={(checked) => updateField("showAsSeparateLine", checked)}
                />
                <Label className="text-[10px] mb-0">Show as Separate Line on Quote</Label>
              </div>
              <div>
                <Label className="text-[10px]">Breakout Label</Label>
                <Input
                  value={form.breakoutLabel}
                  onChange={(e) => updateField("breakoutLabel", e.target.value)}
                  placeholder="e.g. Travel & Living"
                />
              </div>
            </FormSection>
          </CardBody>
        </Card>
      </FadeIn>
    );
  }

  // List view
  return (
    <FadeIn>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Travel Policies</CardTitle>
          <Button variant="accent" size="xs" onClick={() => { setMode("create"); setForm({ ...DEFAULT_FORM }); }}>
            <Plus className="h-3 w-3" />
            New Policy
          </Button>
        </CardHeader>

        {policies.length === 0 && (
          <div className="px-5 py-8 text-center text-xs text-fg/40">
            No travel policies configured. Click &quot;New Policy&quot; to get started.
          </div>
        )}

        <div className="divide-y divide-line">
          {policies.map((policy) => (
            <div
              key={policy.id}
              className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-panel2 transition-colors group"
            >
              <Car className="h-3.5 w-3.5 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-fg truncate">{policy.name}</div>
                {policy.description && (
                  <div className="text-[10px] text-fg/40 truncate">{policy.description}</div>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-fg/50 shrink-0">
                <span>${policy.perDiemRate}/day</span>
                <span className="text-fg/20">|</span>
                <span>{policy.kmToDestination} km</span>
                <span className="text-fg/20">|</span>
                <span>${policy.accommodationRate}/night</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => startEdit(policy)} className="p-1 hover:text-accent transition-colors">
                  <Edit3 className="h-3 w-3" />
                </button>
                {deleteConfirm === policy.id ? (
                  <div className="flex items-center gap-1">
                    <Button variant="danger" size="xs" onClick={() => handleDelete(policy.id)}>Yes</Button>
                    <Button variant="ghost" size="xs" onClick={() => setDeleteConfirm(null)}>No</Button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(policy.id)} className="p-1 hover:text-danger transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </FadeIn>
  );
}
