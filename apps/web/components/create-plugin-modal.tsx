"use client";

import { useState, useCallback } from "react";
import {
  Plus,
  Minus,
  Wrench,
  Puzzle,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Check,
  Sparkles,
  Loader2,
} from "lucide-react";
import * as RadixSelect from "@radix-ui/react-select";
import { cn } from "@/lib/utils";
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
  ModalBackdrop,
  Select,
  Separator,
  Textarea,
  Toggle,
} from "@/components/ui";
import { createPlugin, updatePlugin as apiUpdatePlugin } from "@/lib/api";
import type { EntityCategory } from "@/lib/api";
import type {
  PluginRecord,
  PluginToolDefinition,
  PluginConfigField,
  PluginUISchema,
  PluginUISection,
  PluginField,
  PluginFieldOption,
  PluginTable,
  PluginTableColumn,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────

type Step = "basics" | "config" | "tools" | "review";

interface ToolDraft {
  id: string;
  name: string;
  description: string;
  llmDescription: string;
  outputType: string;
  requiresConfirmation: boolean;
  mutates: boolean;
  tags: string;
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: string;
    enumValues?: string;
  }>;
  uiSections: UISectionDraft[];
}

interface UISectionDraft {
  id: string;
  type: string;
  label: string;
  description: string;
  fields: UIFieldDraft[];
  tableColumns: UITableColumnDraft[];
}

interface UIFieldDraft {
  id: string;
  type: string;
  label: string;
  description: string;
  placeholder: string;
  defaultValue: string;
  required: boolean;
  width: string;
  options: string; // comma-separated "value:label" pairs
  datasetId: string;
  datasetColumn: string;
  cascadeDependsOn: string;
  cascadeParentColumn: string;
  formula: string;
  formulaDeps: string;
  formulaFormat: string;
  validationMin: string;
  validationMax: string;
}

interface UITableColumnDraft {
  id: string;
  label: string;
  type: string;
  width: string;
  editable: boolean;
  aggregate: string;
  options: string;
  formula: string;
  formulaDeps: string;
  formulaFormat: string;
}

// ── Defaults ──────────────────────────────────────────────────────────

function makeToolDraft(): ToolDraft {
  return {
    id: `tool-${Date.now()}`,
    name: "",
    description: "",
    llmDescription: "",
    outputType: "line_items",
    requiresConfirmation: false,
    mutates: true,
    tags: "",
    parameters: [],
    uiSections: [],
  };
}

function makeFieldDraft(): UIFieldDraft {
  return {
    id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "text", label: "", description: "", placeholder: "", defaultValue: "",
    required: false, width: "full", options: "", datasetId: "", datasetColumn: "",
    cascadeDependsOn: "", cascadeParentColumn: "", formula: "", formulaDeps: "",
    formulaFormat: "number", validationMin: "", validationMax: "",
  };
}

function makeSectionDraft(): UISectionDraft {
  return {
    id: `section-${Date.now()}`,
    type: "fields",
    label: "",
    description: "",
    fields: [],
    tableColumns: [],
  };
}

function makeColumnDraft(): UITableColumnDraft {
  return {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: "", type: "text", width: "120px", editable: true,
    aggregate: "", options: "", formula: "", formulaDeps: "", formulaFormat: "number",
  };
}

// ── Build output ──────────────────────────────────────────────────────

function parseOptions(raw: string): PluginFieldOption[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => {
    const [value, label] = s.trim().split(":");
    return { value: value?.trim() ?? "", label: (label ?? value)?.trim() ?? "" };
  });
}

function buildField(d: UIFieldDraft, order: number): PluginField {
  const f: PluginField = {
    id: d.id, type: d.type as any, label: d.label,
    width: d.width as any, order,
  };
  if (d.description) f.description = d.description;
  if (d.placeholder) f.placeholder = d.placeholder;
  if (d.defaultValue) {
    f.defaultValue = d.type === "number" || d.type === "currency" || d.type === "percentage"
      ? parseFloat(d.defaultValue) : d.type === "boolean" ? d.defaultValue === "true" : d.defaultValue;
  }
  if (d.required) f.validation = { ...f.validation, required: true };
  if (d.validationMin) f.validation = { ...f.validation, min: parseFloat(d.validationMin) };
  if (d.validationMax) f.validation = { ...f.validation, max: parseFloat(d.validationMax) };
  if (d.options) f.options = parseOptions(d.options);
  if (d.datasetId && d.datasetColumn) {
    if (d.cascadeDependsOn) {
      f.optionsSource = { type: "cascade", datasetId: d.datasetId, column: d.datasetColumn, dependsOn: d.cascadeDependsOn, parentColumn: d.cascadeParentColumn || d.cascadeDependsOn };
    } else {
      f.optionsSource = { type: "dataset", datasetId: d.datasetId, column: d.datasetColumn };
    }
  }
  if (d.formula) {
    f.computation = { formula: d.formula, dependencies: d.formulaDeps.split(",").map((s) => s.trim()).filter(Boolean), format: d.formulaFormat };
  }
  return f;
}

function buildTableColumn(d: UITableColumnDraft): PluginTableColumn {
  const c: PluginTableColumn = { id: d.id, label: d.label, type: d.type as any };
  if (d.width) c.width = d.width;
  if (d.editable !== undefined) c.editable = d.editable;
  if (d.aggregate) c.aggregate = d.aggregate as any;
  if (d.options) c.options = parseOptions(d.options);
  if (d.formula) c.computation = { formula: d.formula, dependencies: d.formulaDeps.split(",").map((s) => s.trim()).filter(Boolean), format: d.formulaFormat };
  return c;
}

function buildSection(d: UISectionDraft, order: number): PluginUISection {
  const s: PluginUISection = { id: d.id, type: d.type as any, order };
  if (d.label) s.label = d.label;
  if (d.description) s.description = d.description;
  if (d.type === "fields" || d.type === "search") {
    s.fields = d.fields.map((f, i) => buildField(f, i));
  }
  if (d.type === "table") {
    s.table = {
      id: d.id + "-table",
      label: d.label,
      columns: d.tableColumns.map(buildTableColumn),
      allowAddRow: true,
      allowDeleteRow: true,
      totalsRow: true,
      rowTemplate: Object.fromEntries(d.tableColumns.map((c) => [c.id, c.type === "number" ? 0 : ""])),
    };
  }
  return s;
}

function buildToolDef(d: ToolDraft): PluginToolDefinition {
  const ui: PluginUISchema | undefined = d.uiSections.length > 0
    ? { layout: "single", submitLabel: "Submit", showPreview: true, sections: d.uiSections.map((s, i) => buildSection(s, i)) }
    : undefined;

  return {
    id: d.id,
    name: d.name,
    description: d.description,
    llmDescription: d.llmDescription || undefined,
    outputType: d.outputType as any,
    requiresConfirmation: d.requiresConfirmation,
    mutates: d.mutates,
    tags: d.tags.split(",").map((s) => s.trim()).filter(Boolean),
    parameters: d.parameters.map((p) => ({
      name: p.name, type: p.type, description: p.description,
      required: p.required,
      ...(p.default ? { default: p.type === "number" ? parseFloat(p.default) : p.default } : {}),
      ...(p.enumValues ? { enum: p.enumValues.split(",").map((s) => s.trim()) } : {}),
    })),
    ...(ui ? { ui } : {}),
  };
}

// ── Component ─────────────────────────────────────────────────────────

function pluginToToolDrafts(plugin: PluginRecord): ToolDraft[] {
  return plugin.toolDefinitions.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    llmDescription: t.llmDescription ?? "",
    outputType: t.outputType,
    requiresConfirmation: t.requiresConfirmation ?? false,
    mutates: t.mutates ?? true,
    tags: t.tags?.join(", ") ?? "",
    parameters: t.parameters.map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description,
      required: p.required ?? false,
      default: p.default != null ? String(p.default) : undefined,
      enumValues: p.enum?.join(", "),
    })),
    uiSections: t.ui?.sections.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label ?? "",
      description: s.description ?? "",
      fields: (s.fields ?? []).map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        description: f.description ?? "",
        placeholder: f.placeholder ?? "",
        defaultValue: f.defaultValue != null ? String(f.defaultValue) : "",
        required: f.validation?.required ?? false,
        width: f.width ?? "full",
        options: f.options?.map((o) => `${o.value}:${o.label}`).join(", ") ?? "",
        datasetId: (f.optionsSource as any)?.datasetId ?? "",
        datasetColumn: (f.optionsSource as any)?.column ?? "",
        cascadeDependsOn: (f.optionsSource as any)?.dependsOn ?? "",
        cascadeParentColumn: (f.optionsSource as any)?.parentColumn ?? "",
        formula: f.computation?.formula ?? "",
        formulaDeps: f.computation?.dependencies?.join(", ") ?? "",
        formulaFormat: f.computation?.format ?? "number",
        validationMin: f.validation?.min != null ? String(f.validation.min) : "",
        validationMax: f.validation?.max != null ? String(f.validation.max) : "",
      })),
      tableColumns: s.table?.columns.map((c) => ({
        id: c.id,
        label: c.label,
        type: c.type,
        width: c.width ?? "120px",
        editable: c.editable ?? true,
        aggregate: (c.aggregate as string) ?? "",
        options: c.options?.map((o) => `${o.value}:${o.label}`).join(", ") ?? "",
        formula: c.computation?.formula ?? "",
        formulaDeps: c.computation?.dependencies?.join(", ") ?? "",
        formulaFormat: c.computation?.format ?? "number",
      })) ?? [],
    })) ?? [],
  }));
}

// ── Radix Select Helper ───────────────────────────────────────────────

function StyledSelect({ value, onValueChange, placeholder, children }: {
  value: string;
  onValueChange: (val: string) => void;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger className="inline-flex items-center justify-between gap-1.5 h-9 w-full px-3 text-sm rounded-lg border border-line bg-bg/50 text-fg outline-none hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors">
        <RadixSelect.Value placeholder={placeholder ?? "Select..."} />
        <RadixSelect.Icon className="shrink-0">
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="z-[300] rounded-lg border border-line bg-panel shadow-xl min-w-[var(--radix-select-trigger-width)]" position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="p-1">
            {children}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RadixSelect.Item value={value} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md outline-none cursor-pointer hover:bg-accent/10 data-[highlighted]:bg-accent/10 data-[state=checked]:text-accent">
      <RadixSelect.ItemIndicator className="shrink-0 w-3"><Check className="h-3 w-3" /></RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

export function CreatePluginModal({
  open,
  onClose,
  onCreated,
  datasets,
  initialPlugin,
  entityCategories,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (plugin: PluginRecord) => void;
  datasets?: Array<{ id: string; name: string; columns: Array<{ key: string; name: string }> }>;
  initialPlugin?: PluginRecord;
  entityCategories?: EntityCategory[];
}) {
  const isEdit = !!initialPlugin;
  const [step, setStep] = useState<Step>("basics");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  // Plugin basics
  const [name, setName] = useState(initialPlugin?.name ?? "");
  const [slug, setSlug] = useState(initialPlugin?.slug ?? "");
  const [category, setCategory] = useState(initialPlugin?.category ?? "general");
  const [description, setDescription] = useState(initialPlugin?.description ?? "");
  const [llmDescription, setLlmDescription] = useState(initialPlugin?.llmDescription ?? "");
  const [tags, setTags] = useState(initialPlugin?.tags?.join(", ") ?? "");
  const [documentation, setDocumentation] = useState(initialPlugin?.documentation ?? "");
  const [defaultOutputType, setDefaultOutputType] = useState(initialPlugin?.defaultOutputType ?? "line_items");

  // Config fields
  const [configFields, setConfigFields] = useState<Array<{ key: string; label: string; type: string; description: string; required: boolean; placeholder: string }>>(
    initialPlugin?.configSchema?.map((f) => ({ key: f.key, label: f.label, type: f.type, description: f.description ?? "", required: f.required ?? false, placeholder: f.placeholder ?? "" })) ?? []
  );

  // Tools
  const [tools, setTools] = useState<ToolDraft[]>(initialPlugin ? pluginToToolDrafts(initialPlugin) : []);
  const [expandedToolIdx, setExpandedToolIdx] = useState<number | null>(null);
  const [expandedSectionIdx, setExpandedSectionIdx] = useState<number | null>(null);

  const autoSlug = useCallback((n: string) => {
    setName(n);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")) {
      setSlug(n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
    }
  }, [slug, name]);

  const handleGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const { apiBaseUrl } = await import("@/lib/api");
      const cats = entityCategories?.filter((c) => c.enabled).map((c) => c.name);
      const res = await fetch(`${apiBaseUrl}/plugins/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim(), categories: cats }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Generation failed" }));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const gen = await res.json();

      // Populate form fields from generated plugin
      if (gen.name) { setName(gen.name); setSlug(gen.slug ?? gen.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")); }
      if (gen.category) setCategory(gen.category);
      if (gen.description) setDescription(gen.description);
      if (gen.llmDescription) setLlmDescription(gen.llmDescription);
      if (gen.tags) setTags(Array.isArray(gen.tags) ? gen.tags.join(", ") : gen.tags);
      if (gen.documentation) setDocumentation(gen.documentation);
      if (gen.defaultOutputType) setDefaultOutputType(gen.defaultOutputType);

      // Config
      if (gen.configSchema && Array.isArray(gen.configSchema)) {
        setConfigFields(gen.configSchema.map((f: any) => ({
          key: f.key ?? "", label: f.label ?? "", type: f.type ?? "text",
          description: f.description ?? "", required: f.required ?? false, placeholder: f.placeholder ?? "",
        })));
      }

      // Tools — convert full tool definitions to drafts
      if (gen.toolDefinitions && Array.isArray(gen.toolDefinitions)) {
        const draftPlugin = {
          ...gen,
          id: "temp",
          enabled: true,
          config: gen.config ?? {},
          createdAt: "", updatedAt: "",
        } as PluginRecord;
        setTools(pluginToToolDrafts(draftPlugin));
      }

      setStep("basics"); // show the populated form
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [aiPrompt, entityCategories]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError("Plugin name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        category,
        description: description.trim(),
        llmDescription: llmDescription.trim() || undefined,
        version: initialPlugin?.version ?? "1.0.0",
        author: initialPlugin?.author ?? "Custom",
        enabled: initialPlugin?.enabled ?? true,
        config: Object.fromEntries(configFields.map((f) => [f.key, initialPlugin?.config?.[f.key] ?? ""])),
        configSchema: configFields.map((f) => ({
          key: f.key, label: f.label, type: f.type as any,
          description: f.description, required: f.required, placeholder: f.placeholder,
        })),
        toolDefinitions: tools.map(buildToolDef),
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        defaultOutputType,
        documentation: documentation.trim() || undefined,
      };
      const plugin = isEdit
        ? await apiUpdatePlugin(initialPlugin!.id, payload)
        : await createPlugin(payload);
      onCreated(plugin);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${isEdit ? "update" : "create"} plugin`);
    } finally {
      setSaving(false);
    }
  }, [name, slug, category, description, llmDescription, tags, documentation, defaultOutputType, configFields, tools, onCreated, onClose]);

  const steps: Array<{ id: Step; label: string }> = [
    { id: "basics", label: "Basics" },
    { id: "config", label: "Configuration" },
    { id: "tools", label: "Tools" },
    { id: "review", label: "Review" },
  ];

  return (
    <ModalBackdrop open={open} onClose={onClose} size="xl">
      <Card className="h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between shrink-0">
          <div>
            <CardTitle>{isEdit ? "Edit Plugin" : "Create Plugin"}</CardTitle>
            <p className="text-[11px] text-fg/50 mt-0.5">
              {isEdit ? "Modify plugin settings, tools, and configuration" : "Build a new estimation tool, search integration, or content generator"}
            </p>
          </div>
          <Button variant="ghost" size="xs" onClick={onClose}><X className="h-4 w-4" /></Button>
        </CardHeader>

        {/* AI Generate bar */}
        {!isEdit && (
          <div className="px-5 py-3 border-b border-line bg-panel2/30 shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
              <Input
                className="flex-1 h-8 text-xs bg-bg"
                placeholder="Describe the plugin you want to create..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !generating) handleGenerate(); }}
                disabled={generating}
              />
              <Button
                variant="accent"
                size="xs"
                onClick={handleGenerate}
                disabled={generating || !aiPrompt.trim()}
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generating ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex border-b border-line shrink-0">
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              className={cn(
                "flex-1 px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                step === s.id ? "border-accent text-accent" : "border-transparent text-fg/40 hover:text-fg/60"
              )}
            >
              <span className="mr-1.5 text-[10px]">{i + 1}.</span>
              {s.label}
            </button>
          ))}
        </div>

        <CardBody className="overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {/* ── Step: Basics ── */}
          {step === "basics" && (
            <FadeIn>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Plugin Name *</Label>
                  <Input value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="e.g., NECA Labour Units" />
                </div>
                <div>
                  <Label>Slug</Label>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
                </div>
                <div>
                  <Label>Category *</Label>
                  <StyledSelect value={category} onValueChange={setCategory} placeholder="Select category...">
                    {(entityCategories && entityCategories.length > 0
                      ? entityCategories.filter((c) => c.enabled).map((c) => (
                          <SelectItem key={c.name} value={c.name.toLowerCase()}>{c.name}</SelectItem>
                        ))
                      : [
                          <SelectItem key="labour" value="labour">Labour</SelectItem>,
                          <SelectItem key="equipment" value="equipment">Equipment</SelectItem>,
                          <SelectItem key="material" value="material">Material</SelectItem>,
                          <SelectItem key="travel" value="travel">Travel</SelectItem>,
                          <SelectItem key="general" value="general">General</SelectItem>,
                        ]
                    )}
                  </StyledSelect>
                </div>
                <div className="col-span-2">
                  <Label>Description *</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this plugin do?" />
                </div>
                <div className="col-span-2">
                  <Label>LLM Description</Label>
                  <p className="text-[10px] text-fg/40 mb-1">Detailed description for the AI agent — when should it use this plugin?</p>
                  <Textarea value={llmDescription} onChange={(e) => setLlmDescription(e.target.value)} placeholder="When the user asks about..." />
                </div>
                <div>
                  <Label>Default Output Type</Label>
                  <StyledSelect value={defaultOutputType} onValueChange={setDefaultOutputType} placeholder="Select output type...">
                    <SelectItem value="line_items">Line Items</SelectItem>
                    <SelectItem value="worksheet">Worksheet</SelectItem>
                    <SelectItem value="text_content">Text Content</SelectItem>
                    <SelectItem value="revision_patch">Revision Patch</SelectItem>
                    <SelectItem value="score">Score</SelectItem>
                    <SelectItem value="summary">Summary</SelectItem>
                    <SelectItem value="composite">Composite</SelectItem>
                  </StyledSelect>
                </div>
                <div>
                  <Label>Tags</Label>
                  <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated, tags" />
                </div>
                <div className="col-span-2">
                  <Label>Documentation (markdown)</Label>
                  <Textarea value={documentation} onChange={(e) => setDocumentation(e.target.value)} placeholder="# Plugin docs..." className="min-h-24" />
                </div>
              </div>
            </FadeIn>
          )}

          {/* ── Step: Config ── */}
          {step === "config" && (
            <FadeIn>
              <p className="text-xs text-fg/50 mb-3">
                Define configuration fields for this plugin (e.g., API keys, default settings).
                Users fill these in on the Plugins page before using the tools.
              </p>
              <div className="space-y-3">
                {configFields.map((field, i) => (
                  <div key={i} className="rounded-lg border border-line p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-fg/70">Field {i + 1}</span>
                      <Button variant="ghost" size="xs" onClick={() => setConfigFields((f) => f.filter((_, j) => j !== i))}>
                        <Minus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label>Key</Label>
                        <Input value={field.key} onChange={(e) => {
                          const next = [...configFields]; next[i] = { ...next[i], key: e.target.value }; setConfigFields(next);
                        }} placeholder="apiKey" />
                      </div>
                      <div>
                        <Label>Label</Label>
                        <Input value={field.label} onChange={(e) => {
                          const next = [...configFields]; next[i] = { ...next[i], label: e.target.value }; setConfigFields(next);
                        }} placeholder="API Key" />
                      </div>
                      <div>
                        <Label>Type</Label>
                        <Select value={field.type} onChange={(e) => {
                          const next = [...configFields]; next[i] = { ...next[i], type: e.target.value }; setConfigFields(next);
                        }}>
                          <option value="text">Text</option>
                          <option value="password">Password</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                          <option value="url">URL</option>
                          <option value="select">Select</option>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Description</Label>
                        <Input value={field.description} onChange={(e) => {
                          const next = [...configFields]; next[i] = { ...next[i], description: e.target.value }; setConfigFields(next);
                        }} placeholder="Describe this config field" />
                      </div>
                      <div className="flex items-end gap-3">
                        <div>
                          <Label>Placeholder</Label>
                          <Input value={field.placeholder} onChange={(e) => {
                            const next = [...configFields]; next[i] = { ...next[i], placeholder: e.target.value }; setConfigFields(next);
                          }} placeholder="Enter..." />
                        </div>
                        <div className="flex items-center gap-2 pb-1">
                          <Toggle checked={field.required} onChange={(v) => {
                            const next = [...configFields]; next[i] = { ...next[i], required: v }; setConfigFields(next);
                          }} />
                          <span className="text-[10px] text-fg/40">Required</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setConfigFields([...configFields, { key: "", label: "", type: "text", description: "", required: false, placeholder: "" }])}>
                  <Plus className="h-3 w-3" /> Add Config Field
                </Button>
              </div>
            </FadeIn>
          )}

          {/* ── Step: Tools ── */}
          {step === "tools" && (
            <FadeIn>
              <p className="text-xs text-fg/50 mb-3">
                Define the tools this plugin provides. Each tool can have parameters for LLM invocation
                and a UI schema for interactive use in the workspace.
              </p>
              <div className="space-y-3">
                {tools.map((tool, ti) => {
                  const expanded = expandedToolIdx === ti;
                  return (
                    <div key={tool.id} className="rounded-lg border border-line overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 bg-panel2/30 cursor-pointer"
                        onClick={() => setExpandedToolIdx(expanded ? null : ti)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Wrench className="h-3.5 w-3.5 text-fg/40 shrink-0" />
                          <span className="text-xs font-medium text-fg/80 truncate">
                            {tool.name || `Tool ${ti + 1}`}
                          </span>
                          {tool.outputType && <Badge tone="info" className="text-[9px]">{tool.outputType}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="xs" onClick={(e) => {
                            e.stopPropagation();
                            setTools((t) => t.filter((_, j) => j !== ti));
                          }}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          {expanded ? <ChevronDown className="h-3 w-3 text-fg/30" /> : <ChevronRight className="h-3 w-3 text-fg/30" />}
                        </div>
                      </div>
                      {expanded && (
                        <div className="px-4 py-3 space-y-4 border-t border-line">
                          {/* Tool basics */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label>Tool Name *</Label>
                              <Input value={tool.name} onChange={(e) => {
                                const next = [...tools]; next[ti] = { ...next[ti], name: e.target.value }; setTools(next);
                              }} placeholder="e.g., Labour Unit Calculator" />
                            </div>
                            <div>
                              <Label>Tool ID</Label>
                              <Input value={tool.id} onChange={(e) => {
                                const next = [...tools]; next[ti] = { ...next[ti], id: e.target.value }; setTools(next);
                              }} placeholder="e.g., myPlugin.calculator" />
                            </div>
                            <div className="col-span-2">
                              <Label>Description</Label>
                              <Input value={tool.description} onChange={(e) => {
                                const next = [...tools]; next[ti] = { ...next[ti], description: e.target.value }; setTools(next);
                              }} placeholder="What does this tool do?" />
                            </div>
                            <div className="col-span-2">
                              <Label>LLM Description</Label>
                              <Textarea value={tool.llmDescription} onChange={(e) => {
                                const next = [...tools]; next[ti] = { ...next[ti], llmDescription: e.target.value }; setTools(next);
                              }} placeholder="Detailed instructions for when the AI should use this tool..." />
                            </div>
                            <div>
                              <Label>Output Type</Label>
                              <Select value={tool.outputType} onChange={(e) => {
                                const next = [...tools]; next[ti] = { ...next[ti], outputType: e.target.value }; setTools(next);
                              }}>
                                <option value="line_items">Line Items</option>
                                <option value="worksheet">Worksheet</option>
                                <option value="text_content">Text Content</option>
                                <option value="revision_patch">Revision Patch</option>
                                <option value="score">Score</option>
                                <option value="summary">Summary</option>
                                <option value="composite">Composite</option>
                              </Select>
                            </div>
                            <div>
                              <Label>Tags</Label>
                              <Input value={tool.tags} onChange={(e) => {
                                const next = [...tools]; next[ti] = { ...next[ti], tags: e.target.value }; setTools(next);
                              }} placeholder="comma, separated" />
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <Toggle checked={tool.mutates} onChange={(v) => {
                                  const next = [...tools]; next[ti] = { ...next[ti], mutates: v }; setTools(next);
                                }} />
                                <span className="text-[10px] text-fg/40">Mutates data</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Toggle checked={tool.requiresConfirmation} onChange={(v) => {
                                  const next = [...tools]; next[ti] = { ...next[ti], requiresConfirmation: v }; setTools(next);
                                }} />
                                <span className="text-[10px] text-fg/40">Requires confirmation</span>
                              </div>
                            </div>
                          </div>

                          <Separator />

                          {/* Parameters */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <Label className="mb-0">LLM Parameters</Label>
                              <Button variant="ghost" size="xs" onClick={() => {
                                const next = [...tools];
                                next[ti] = { ...next[ti], parameters: [...next[ti].parameters, { name: "", type: "string", description: "", required: false }] };
                                setTools(next);
                              }}>
                                <Plus className="h-3 w-3" /> Add
                              </Button>
                            </div>
                            {tool.parameters.length === 0 && (
                              <p className="text-[10px] text-fg/30 italic">No parameters — the LLM will invoke this tool without arguments</p>
                            )}
                            {tool.parameters.map((p, pi) => (
                              <div key={pi} className="grid grid-cols-12 gap-1.5 mb-1.5">
                                <Input className="col-span-3 text-xs h-7" value={p.name} placeholder="name" onChange={(e) => {
                                  const next = [...tools]; next[ti].parameters[pi] = { ...p, name: e.target.value }; setTools(next);
                                }} />
                                <Select className="col-span-2 text-xs h-7" value={p.type} onChange={(e) => {
                                  const next = [...tools]; next[ti].parameters[pi] = { ...p, type: e.target.value }; setTools(next);
                                }}>
                                  <option value="string">string</option>
                                  <option value="number">number</option>
                                  <option value="boolean">boolean</option>
                                </Select>
                                <Input className="col-span-5 text-xs h-7" value={p.description} placeholder="description" onChange={(e) => {
                                  const next = [...tools]; next[ti].parameters[pi] = { ...p, description: e.target.value }; setTools(next);
                                }} />
                                <div className="col-span-1 flex items-center justify-center">
                                  <Toggle checked={p.required} onChange={(v) => {
                                    const next = [...tools]; next[ti].parameters[pi] = { ...p, required: v }; setTools(next);
                                  }} />
                                </div>
                                <div className="col-span-1 flex items-center justify-center">
                                  <button className="text-fg/30 hover:text-danger" onClick={() => {
                                    const next = [...tools]; next[ti].parameters = next[ti].parameters.filter((_, j) => j !== pi); setTools(next);
                                  }}>
                                    <Minus className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>

                          <Separator />

                          {/* UI Sections */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <Label className="mb-0">UI Sections</Label>
                              <Button variant="ghost" size="xs" onClick={() => {
                                const next = [...tools];
                                next[ti] = { ...next[ti], uiSections: [...next[ti].uiSections, makeSectionDraft()] };
                                setTools(next);
                              }}>
                                <Plus className="h-3 w-3" /> Add Section
                              </Button>
                            </div>
                            {tool.uiSections.length === 0 && (
                              <p className="text-[10px] text-fg/30 italic">No UI sections — this tool will only be available via the AI agent</p>
                            )}
                            {tool.uiSections.map((section, si) => {
                              const secExpanded = expandedSectionIdx === si;
                              return (
                                <div key={section.id} className="rounded border border-line/50 mb-2 overflow-hidden">
                                  <div
                                    className="flex items-center justify-between px-3 py-2 bg-panel2/20 cursor-pointer"
                                    onClick={() => setExpandedSectionIdx(secExpanded ? null : si)}
                                  >
                                    <span className="text-[11px] font-medium text-fg/60">
                                      {section.label || `Section ${si + 1}`} ({section.type})
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button className="text-fg/30 hover:text-danger p-0.5" onClick={(e) => {
                                        e.stopPropagation();
                                        const next = [...tools]; next[ti].uiSections = next[ti].uiSections.filter((_, j) => j !== si); setTools(next);
                                      }}>
                                        <Minus className="h-3 w-3" />
                                      </button>
                                      {secExpanded ? <ChevronDown className="h-3 w-3 text-fg/30" /> : <ChevronRight className="h-3 w-3 text-fg/30" />}
                                    </div>
                                  </div>
                                  {secExpanded && (
                                    <div className="px-3 py-2 space-y-2 border-t border-line/30">
                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <Label>Type</Label>
                                          <Select value={section.type} onChange={(e) => {
                                            const next = [...tools]; next[ti].uiSections[si] = { ...section, type: e.target.value }; setTools(next);
                                          }}>
                                            <option value="fields">Fields</option>
                                            <option value="table">Table</option>
                                            <option value="search">Search</option>
                                            <option value="scoring">Scoring</option>
                                            <option value="preview">Preview</option>
                                          </Select>
                                        </div>
                                        <div>
                                          <Label>Label</Label>
                                          <Input value={section.label} onChange={(e) => {
                                            const next = [...tools]; next[ti].uiSections[si] = { ...section, label: e.target.value }; setTools(next);
                                          }} />
                                        </div>
                                        <div>
                                          <Label>Description</Label>
                                          <Input value={section.description} onChange={(e) => {
                                            const next = [...tools]; next[ti].uiSections[si] = { ...section, description: e.target.value }; setTools(next);
                                          }} />
                                        </div>
                                      </div>

                                      {/* Fields for fields/search sections */}
                                      {(section.type === "fields" || section.type === "search") && (
                                        <div>
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="text-[10px] text-fg/40 font-medium">Fields ({section.fields.length})</span>
                                            <Button variant="ghost" size="xs" onClick={() => {
                                              const next = [...tools]; next[ti].uiSections[si].fields = [...section.fields, makeFieldDraft()]; setTools(next);
                                            }}>
                                              <Plus className="h-2.5 w-2.5" /> Field
                                            </Button>
                                          </div>
                                          {section.fields.map((field, fi) => (
                                            <div key={field.id} className="rounded bg-panel2/20 p-2 mb-1.5 space-y-1.5">
                                              <div className="flex items-center justify-between">
                                                <span className="text-[10px] text-fg/50">{field.label || field.id}</span>
                                                <button className="text-fg/30 hover:text-danger" onClick={() => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields = section.fields.filter((_, j) => j !== fi); setTools(next);
                                                }}>
                                                  <Minus className="h-2.5 w-2.5" />
                                                </button>
                                              </div>
                                              <div className="grid grid-cols-4 gap-1.5">
                                                <Input className="text-[10px] h-6" value={field.id} placeholder="id" onChange={(e) => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, id: e.target.value }; setTools(next);
                                                }} />
                                                <Select className="text-[10px] h-6" value={field.type} onChange={(e) => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, type: e.target.value }; setTools(next);
                                                }}>
                                                  <option value="text">text</option>
                                                  <option value="number">number</option>
                                                  <option value="currency">currency</option>
                                                  <option value="percentage">percentage</option>
                                                  <option value="select">select</option>
                                                  <option value="multi-select">multi-select</option>
                                                  <option value="radio">radio</option>
                                                  <option value="slider">slider</option>
                                                  <option value="date">date</option>
                                                  <option value="textarea">textarea</option>
                                                  <option value="boolean">boolean</option>
                                                  <option value="computed">computed</option>
                                                  <option value="search">search</option>
                                                  <option value="hidden">hidden</option>
                                                </Select>
                                                <Input className="text-[10px] h-6" value={field.label} placeholder="Label" onChange={(e) => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, label: e.target.value }; setTools(next);
                                                }} />
                                                <Select className="text-[10px] h-6" value={field.width} onChange={(e) => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, width: e.target.value }; setTools(next);
                                                }}>
                                                  <option value="full">Full</option>
                                                  <option value="half">Half</option>
                                                  <option value="third">Third</option>
                                                  <option value="quarter">Quarter</option>
                                                </Select>
                                              </div>
                                              {/* Options / Dataset binding */}
                                              {(field.type === "select" || field.type === "multi-select" || field.type === "radio") && (
                                                <div className="grid grid-cols-2 gap-1.5">
                                                  <div>
                                                    <span className="text-[9px] text-fg/30">Static Options (val:label, ...)</span>
                                                    <Input className="text-[10px] h-6" value={field.options} placeholder="opt1:Label 1, opt2:Label 2" onChange={(e) => {
                                                      const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, options: e.target.value }; setTools(next);
                                                    }} />
                                                  </div>
                                                  <div>
                                                    <span className="text-[9px] text-fg/30">Or Dataset Binding</span>
                                                    <div className="flex gap-1">
                                                      <Select className="text-[10px] h-6 flex-1" value={field.datasetId} onChange={(e) => {
                                                        const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, datasetId: e.target.value }; setTools(next);
                                                      }}>
                                                        <option value="">None</option>
                                                        {(datasets ?? []).map((ds) => (
                                                          <option key={ds.id} value={ds.id}>{ds.name}</option>
                                                        ))}
                                                      </Select>
                                                      {field.datasetId && (
                                                        <Select className="text-[10px] h-6 flex-1" value={field.datasetColumn} onChange={(e) => {
                                                          const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, datasetColumn: e.target.value }; setTools(next);
                                                        }}>
                                                          <option value="">Column...</option>
                                                          {(datasets ?? []).find((ds) => ds.id === field.datasetId)?.columns.map((col) => (
                                                            <option key={col.key} value={col.key}>{col.name}</option>
                                                          ))}
                                                        </Select>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                              )}
                                              {/* Cascade config */}
                                              {field.datasetId && (
                                                <div className="grid grid-cols-2 gap-1.5">
                                                  <div>
                                                    <span className="text-[9px] text-fg/30">Cascade Depends On (field id)</span>
                                                    <Input className="text-[10px] h-6" value={field.cascadeDependsOn} onChange={(e) => {
                                                      const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, cascadeDependsOn: e.target.value }; setTools(next);
                                                    }} />
                                                  </div>
                                                  <div>
                                                    <span className="text-[9px] text-fg/30">Parent Column</span>
                                                    <Input className="text-[10px] h-6" value={field.cascadeParentColumn} onChange={(e) => {
                                                      const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, cascadeParentColumn: e.target.value }; setTools(next);
                                                    }} />
                                                  </div>
                                                </div>
                                              )}
                                              {/* Computed formula */}
                                              {field.type === "computed" && (
                                                <div className="grid grid-cols-3 gap-1.5">
                                                  <Input className="text-[10px] h-6 col-span-2" value={field.formula} placeholder="quantity * hoursPerUnit" onChange={(e) => {
                                                    const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, formula: e.target.value }; setTools(next);
                                                  }} />
                                                  <Input className="text-[10px] h-6" value={field.formulaDeps} placeholder="dep1, dep2" onChange={(e) => {
                                                    const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, formulaDeps: e.target.value }; setTools(next);
                                                  }} />
                                                </div>
                                              )}
                                              <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1">
                                                  <Toggle checked={field.required} onChange={(v) => {
                                                    const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, required: v }; setTools(next);
                                                  }} />
                                                  <span className="text-[9px] text-fg/30">Required</span>
                                                </div>
                                                <Input className="text-[10px] h-6 w-24" value={field.placeholder} placeholder="placeholder" onChange={(e) => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, placeholder: e.target.value }; setTools(next);
                                                }} />
                                                <Input className="text-[10px] h-6 w-20" value={field.defaultValue} placeholder="default" onChange={(e) => {
                                                  const next = [...tools]; next[ti].uiSections[si].fields[fi] = { ...field, defaultValue: e.target.value }; setTools(next);
                                                }} />
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* Table columns for table sections */}
                                      {section.type === "table" && (
                                        <div>
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="text-[10px] text-fg/40 font-medium">Table Columns ({section.tableColumns.length})</span>
                                            <Button variant="ghost" size="xs" onClick={() => {
                                              const next = [...tools]; next[ti].uiSections[si].tableColumns = [...section.tableColumns, makeColumnDraft()]; setTools(next);
                                            }}>
                                              <Plus className="h-2.5 w-2.5" /> Column
                                            </Button>
                                          </div>
                                          {section.tableColumns.map((col, ci) => (
                                            <div key={col.id} className="grid grid-cols-6 gap-1 mb-1">
                                              <Input className="text-[10px] h-6" value={col.id} placeholder="id" onChange={(e) => {
                                                const next = [...tools]; next[ti].uiSections[si].tableColumns[ci] = { ...col, id: e.target.value }; setTools(next);
                                              }} />
                                              <Input className="text-[10px] h-6" value={col.label} placeholder="Label" onChange={(e) => {
                                                const next = [...tools]; next[ti].uiSections[si].tableColumns[ci] = { ...col, label: e.target.value }; setTools(next);
                                              }} />
                                              <Select className="text-[10px] h-6" value={col.type} onChange={(e) => {
                                                const next = [...tools]; next[ti].uiSections[si].tableColumns[ci] = { ...col, type: e.target.value }; setTools(next);
                                              }}>
                                                <option value="text">text</option>
                                                <option value="number">number</option>
                                                <option value="select">select</option>
                                                <option value="computed">computed</option>
                                                <option value="currency">currency</option>
                                              </Select>
                                              <Select className="text-[10px] h-6" value={col.aggregate} onChange={(e) => {
                                                const next = [...tools]; next[ti].uiSections[si].tableColumns[ci] = { ...col, aggregate: e.target.value }; setTools(next);
                                              }}>
                                                <option value="">No agg</option>
                                                <option value="sum">Sum</option>
                                                <option value="avg">Avg</option>
                                                <option value="count">Count</option>
                                              </Select>
                                              <Input className="text-[10px] h-6" value={col.width} placeholder="120px" onChange={(e) => {
                                                const next = [...tools]; next[ti].uiSections[si].tableColumns[ci] = { ...col, width: e.target.value }; setTools(next);
                                              }} />
                                              <button className="text-fg/30 hover:text-danger flex items-center justify-center" onClick={() => {
                                                const next = [...tools]; next[ti].uiSections[si].tableColumns = section.tableColumns.filter((_, j) => j !== ci); setTools(next);
                                              }}>
                                                <Minus className="h-3 w-3" />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button variant="secondary" size="sm" onClick={() => { setTools([...tools, makeToolDraft()]); setExpandedToolIdx(tools.length); }}>
                  <Plus className="h-3 w-3" /> Add Tool
                </Button>
              </div>
            </FadeIn>
          )}

          {/* ── Step: Review ── */}
          {step === "review" && (
            <FadeIn>
              <div className="space-y-3">
                <div className="rounded-lg border border-line p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-accent" />
                    <span className="text-sm font-semibold">{name || "Untitled Plugin"}</span>
                    <Badge tone="info" className="capitalize text-[10px]">{category}</Badge>
                  </div>
                  <p className="text-xs text-fg/50">{description || "No description"}</p>
                  {tags && (
                    <div className="flex flex-wrap gap-1">
                      {tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                        <span key={t} className="rounded px-1.5 py-0.5 text-[9px] bg-panel2 text-fg/40">{t}</span>
                      ))}
                    </div>
                  )}
                </div>

                {configFields.length > 0 && (
                  <div className="rounded-lg border border-line p-3">
                    <span className="text-[10px] text-fg/40 font-medium uppercase tracking-wide">Configuration ({configFields.length} fields)</span>
                    <div className="mt-2 space-y-1">
                      {configFields.map((f) => (
                        <div key={f.key} className="flex items-center justify-between text-xs">
                          <span className="text-fg/60">{f.label}</span>
                          <span className="text-fg/30">{f.type}{f.required ? " *" : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-line p-3">
                  <span className="text-[10px] text-fg/40 font-medium uppercase tracking-wide">Tools ({tools.length})</span>
                  <div className="mt-2 space-y-2">
                    {tools.map((t) => (
                      <div key={t.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-3 w-3 text-fg/30" />
                          <span className="text-xs text-fg/70">{t.name || t.id}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge tone="info" className="text-[9px]">{t.outputType}</Badge>
                          <span className="text-[9px] text-fg/30">{t.parameters.length} params</span>
                          <span className="text-[9px] text-fg/30">{t.uiSections.length} UI sections</span>
                        </div>
                      </div>
                    ))}
                    {tools.length === 0 && <p className="text-[10px] text-fg/30 italic">No tools defined yet</p>}
                  </div>
                </div>
              </div>
            </FadeIn>
          )}
        </CardBody>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3 shrink-0">
          <div>
            {step !== "basics" && (
              <Button variant="ghost" size="sm" onClick={() => {
                const idx = steps.findIndex((s) => s.id === step);
                if (idx > 0) setStep(steps[idx - 1].id);
              }}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            {step === "review" ? (
              <Button variant="accent" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
                {saving ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create Plugin")}
              </Button>
            ) : (
              <Button variant="accent" size="sm" onClick={() => {
                const idx = steps.findIndex((s) => s.id === step);
                if (idx < steps.length - 1) setStep(steps[idx + 1].id);
              }}>
                Next
              </Button>
            )}
          </div>
        </div>
      </Card>
    </ModalBackdrop>
  );
}
