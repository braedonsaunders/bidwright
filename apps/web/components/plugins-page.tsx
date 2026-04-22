"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import {
  Download,
  Plus,
  Puzzle,
  Search,
  Upload,
  X,
  Pencil,
  Play,
  Wrench,
  ChevronRight,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  FadeIn,
  Input,
  ModalBackdrop,
  Toggle,
} from "@/components/ui";
import { PluginRuntime } from "@/components/plugin-runtime";
import { CreatePluginModal } from "@/components/create-plugin-modal";
import type {
  PluginRecord,
  PluginToolDefinition,
  PluginOutput,
  DatasetRecord,
  EntityCategory,
} from "@/lib/api";
import {
  updatePlugin as apiUpdatePlugin,
  executePlugin as apiExecutePlugin,
  createPlugin as apiCreatePlugin,
} from "@/lib/api";

const CATEGORY_COLORS: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  labour: "success",
  equipment: "warning",
  material: "default",
  travel: "danger",
  general: "info",
  dynamic: "info",
};

function getCategoryTone(cat: string): "default" | "success" | "warning" | "danger" | "info" {
  return CATEGORY_COLORS[cat.toLowerCase()] ?? "default";
}

interface ToolExecutionModalState {
  plugin: PluginRecord;
  tool: PluginToolDefinition;
}

export function PluginsPage({
  initialPlugins,
  initialDatasets,
  projectId,
  revisionId,
  entityCategories,
}: {
  initialPlugins: PluginRecord[];
  initialDatasets?: DatasetRecord[];
  projectId?: string;
  revisionId?: string;
  entityCategories?: EntityCategory[];
}) {
  const [plugins, setPlugins] = useState<PluginRecord[]>(initialPlugins);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [executionModal, setExecutionModal] = useState<ToolExecutionModalState | null>(null);
  const [executionOutput, setExecutionOutput] = useState<PluginOutput | null>(null);
  const [executing, setExecuting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlugin, setEditingPlugin] = useState<PluginRecord | null>(null);
  const [detailPlugin, setDetailPlugin] = useState<PluginRecord | null>(null);
  const [detailActiveTool, setDetailActiveTool] = useState<string>("");

  const datasetOptions = useMemo(
    () => (initialDatasets ?? []).map((ds) => ({ id: ds.id, name: ds.name, columns: ds.columns.map((c) => ({ key: c.key, name: c.name })) })),
    [initialDatasets]
  );


  const handleToggleEnabled = useCallback(async (pluginId: string, enabled: boolean) => {
    try {
      const updated = await apiUpdatePlugin(pluginId, { enabled });
      setPlugins((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    } catch {
      // revert on failure
    }
  }, []);



  const handleExecuteTool = useCallback(async (data: {
    values: Record<string, unknown>;
    tableData: Record<string, Record<string, unknown>[]>;
    scoringData: Record<string, Record<string, number>>;
  }) => {
    if (!executionModal || !projectId || !revisionId) return;
    setExecuting(true);
    try {
      const result = await apiExecutePlugin(
        executionModal.plugin.id,
        executionModal.tool.id,
        projectId,
        revisionId,
        data.values,
        {
          formState: {
            values: data.values,
            tableData: data.tableData,
            scoringData: data.scoringData,
          },
        },
      );
      setExecutionOutput(result.output as PluginOutput);
    } catch (err) {
      setExecutionOutput({
        type: "summary",
        displayText: `Error: ${err instanceof Error ? err.message : "Execution failed"}`,
      });
    } finally {
      setExecuting(false);
    }
  }, [executionModal, projectId, revisionId]);

  // ── Plugin Export / Import ──────────────────────────────────────────

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleExportPlugins = useCallback(() => {
    const exportData = {
      bidwright_plugins: { version: 1, exportedAt: new Date().toISOString(), count: plugins.length },
      plugins: plugins.map((p) => ({
        name: p.name,
        slug: p.slug,
        icon: p.icon,
        category: p.category,
        description: p.description,
        llmDescription: p.llmDescription,
        version: p.version,
        author: p.author,
        enabled: p.enabled,
        config: p.config,
        configSchema: p.configSchema,
        toolDefinitions: p.toolDefinitions,
        defaultOutputType: p.defaultOutputType,
        supportedCategories: p.supportedCategories,
        tags: p.tags,
        documentation: p.documentation,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bidwright-plugins-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [plugins]);

  const handleImportPlugins = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.bidwright_plugins || !Array.isArray(parsed.plugins)) {
        throw new Error("Invalid plugin export file");
      }
      const existingSlugs = new Set(plugins.map((p) => p.slug));
      let created = 0;
      let skipped = 0;
      for (const pluginData of parsed.plugins) {
        if (existingSlugs.has(pluginData.slug)) {
          skipped++;
          continue;
        }
        try {
          const newPlugin = await apiCreatePlugin(pluginData);
          setPlugins((prev) => [...prev, newPlugin]);
          existingSlugs.add(newPlugin.slug);
          created++;
        } catch {
          skipped++;
        }
      }
      alert(`Imported ${created} plugin${created !== 1 ? "s" : ""}${skipped > 0 ? `, ${skipped} skipped (already exist or failed)` : ""}.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to parse import file");
    } finally {
      setImporting(false);
    }
  }, [plugins]);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(plugins.map((p) => p.category)))],
    [plugins]
  );

  const filtered = useMemo(() => {
    let result = filterCategory === "all"
      ? plugins
      : plugins.filter((p) => p.category === filterCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)) ||
          p.toolDefinitions.some((t) => t.name.toLowerCase().includes(q))
      );
    }
    return result;
  }, [plugins, filterCategory, searchQuery]);

  const totalTools = useMemo(
    () => plugins.reduce((acc, p) => acc + p.toolDefinitions.length, 0),
    [plugins]
  );

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Plugins</h1>
            <p className="text-xs text-fg/50">
              Estimation tools, product lookups, content generators, and integrations
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-xs text-fg/40">
              <span>{plugins.filter((p) => p.enabled).length} active</span>
              <span className="text-fg/20">|</span>
              <span>{totalTools} tools</span>
            </div>
            <Button size="sm" variant="ghost" onClick={handleExportPlugins} title="Export plugins">
              <Download className="h-3 w-3" /> Export
            </Button>
            <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportPlugins} />
            <Button size="sm" variant="ghost" onClick={() => importFileRef.current?.click()} disabled={importing} title="Import plugins">
              <Upload className="h-3 w-3" /> {importing ? "Importing..." : "Import"}
            </Button>
            <Button size="sm" variant="accent" onClick={() => setShowCreateModal(true)}>
              <Plus className="h-3 w-3" /> Create Plugin
            </Button>
          </div>
        </div>
      </FadeIn>

      {/* Filters */}
      <FadeIn delay={0.05}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                  filterCategory === cat
                    ? "bg-accent/10 text-accent"
                    : "text-fg/50 hover:bg-panel2 hover:text-fg/70"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
            <Input
              className="pl-9 h-8 text-xs"
              placeholder="Search plugins & tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </FadeIn>

      {/* Plugin Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((plugin, i) => {
          const tone = CATEGORY_COLORS[plugin.category] ?? "default";
          const toolCount = plugin.toolDefinitions.length;
          const hasUI = plugin.toolDefinitions.some((t) => t.ui);

          return (
            <FadeIn key={plugin.id} delay={0.05 + i * 0.02}>
              <Card className={cn(
                "transition-all hover:ring-1 hover:ring-accent/20 cursor-pointer",
                !plugin.enabled && "opacity-50"
              )}>
                <CardHeader
                  className="flex flex-row items-start justify-between gap-3"
                  onClick={() => {
                    setDetailPlugin(plugin);
                    setDetailActiveTool(plugin.toolDefinitions[0]?.id ?? "");
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Puzzle className="h-4 w-4 text-fg/40 shrink-0" />
                      <CardTitle className="text-sm truncate">{plugin.name}</CardTitle>
                      <Badge tone={tone} className="shrink-0 capitalize text-[10px]">
                        {plugin.category}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-fg/50 line-clamp-2">{plugin.description}</p>
                    {plugin.tags && plugin.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {plugin.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded px-1.5 py-0.5 text-[9px] bg-panel2 text-fg/40">
                            {tag}
                          </span>
                        ))}
                        {plugin.tags.length > 4 && (
                          <span className="text-[9px] text-fg/30">+{plugin.tags.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      checked={plugin.enabled}
                      onChange={(val) => {
                        void handleToggleEnabled(plugin.id, val);
                      }}
                    />
                  </div>
                </CardHeader>
                <CardBody className="pt-0 pb-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[10px] text-fg/40">
                      <span className="flex items-center gap-1">
                        <Wrench className="h-3 w-3" />
                        {toolCount} tool{toolCount !== 1 ? "s" : ""}
                      </span>
                      {hasUI && (
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          UI
                        </span>
                      )}
                      {plugin.version && (
                        <span>v{plugin.version}</span>
                      )}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-fg/20" />
                  </div>
                  {/* Mini tool list */}
                  {toolCount > 0 && (
                    <div className="mt-2 space-y-1">
                      {plugin.toolDefinitions.slice(0, 3).map((tool) => (
                        <div key={tool.id} className="flex items-center gap-2 text-[10px] text-fg/50">
                          <span className="w-1 h-1 rounded-full bg-fg/20 shrink-0" />
                          <span className="truncate">{tool.name}</span>
                          <Badge tone="info" className="text-[8px] ml-auto shrink-0">{tool.outputType}</Badge>
                        </div>
                      ))}
                      {toolCount > 3 && (
                        <p className="text-[9px] text-fg/30 pl-3">+{toolCount - 3} more</p>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            </FadeIn>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <FadeIn delay={0.1}>
          <Card>
            <CardBody className="py-12 text-center">
              <Puzzle className="mx-auto h-8 w-8 text-fg/20 mb-3" />
              <p className="text-sm text-fg/50">
                {searchQuery ? "No plugins match your search" : "No plugins found in this category"}
              </p>
            </CardBody>
          </Card>
        </FadeIn>
      )}

      {/* Plugin Detail / Preview Modal */}
      <ModalBackdrop
        open={!!detailPlugin}
        onClose={() => { setDetailPlugin(null); setDetailActiveTool(""); }}
        size="xl"
      >
        {detailPlugin && (() => {
          const activeTool = detailPlugin.toolDefinitions.find((t) => t.id === detailActiveTool) ?? detailPlugin.toolDefinitions[0];
          const tone = CATEGORY_COLORS[detailPlugin.category] ?? "default";
          return (
            <Card className="max-h-[85vh] overflow-y-auto">
              <CardHeader className="sticky top-0 bg-panel z-10 border-b border-line">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Puzzle className="h-5 w-5 text-fg/40 shrink-0" />
                      <CardTitle className="text-base">{detailPlugin.name}</CardTitle>
                      <Badge tone={tone} className="capitalize text-[10px]">{detailPlugin.category}</Badge>
                      {detailPlugin.version && (
                        <span className="text-[10px] text-fg/30">v{detailPlugin.version}</span>
                      )}
                    </div>
                    <p className="text-xs text-fg/50">{detailPlugin.description}</p>
                    {detailPlugin.author && (
                      <p className="text-[10px] text-fg/30 mt-1">by {detailPlugin.author}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setDetailPlugin(null);
                        setEditingPlugin(detailPlugin);
                      }}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => { setDetailPlugin(null); setDetailActiveTool(""); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Tool tabs */}
                {detailPlugin.toolDefinitions.length > 1 && (
                  <div className="flex gap-1 mt-3 -mb-1 overflow-x-auto">
                    {detailPlugin.toolDefinitions.map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => setDetailActiveTool(tool.id)}
                        className={cn(
                          "rounded-t-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                          (activeTool?.id === tool.id)
                            ? "bg-panel2 text-fg border border-line border-b-transparent"
                            : "text-fg/40 hover:text-fg/60"
                        )}
                      >
                        {tool.name}
                      </button>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardBody>
                {activeTool && (
                  <div className="space-y-4">
                    {/* Tool header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-fg/80">{activeTool.name}</h3>
                        <p className="text-[11px] text-fg/50 mt-0.5">{activeTool.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone="info" className="text-[9px]">{activeTool.outputType}</Badge>
                        {activeTool.mutates && <Badge tone="warning" className="text-[9px]">mutates</Badge>}
                      </div>
                    </div>

                    {/* Parameters */}
                    {activeTool.parameters.length > 0 && (
                      <div>
                        <p className="text-[10px] text-fg/40 font-medium uppercase tracking-wide mb-2">Parameters</p>
                        <div className="rounded-lg border border-line overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="bg-panel2/50 border-b border-line">
                                <th className="text-left px-3 py-1.5 text-fg/50 font-medium">Name</th>
                                <th className="text-left px-3 py-1.5 text-fg/50 font-medium">Type</th>
                                <th className="text-left px-3 py-1.5 text-fg/50 font-medium">Description</th>
                                <th className="text-center px-3 py-1.5 text-fg/50 font-medium">Required</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeTool.parameters.map((param) => (
                                <tr key={param.name} className="border-b border-line/30">
                                  <td className="px-3 py-1.5 font-mono text-accent">{param.name}</td>
                                  <td className="px-3 py-1.5 text-fg/50">{param.type}</td>
                                  <td className="px-3 py-1.5 text-fg/60">{param.description}</td>
                                  <td className="px-3 py-1.5 text-center">
                                    {param.required ? <span className="text-danger">*</span> : <span className="text-fg/20">—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* UI Preview */}
                    {activeTool.ui ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] text-fg/40 font-medium uppercase tracking-wide">UI Preview</p>
                          {projectId && revisionId && (
                            <Button
                              variant="accent"
                              size="xs"
                              onClick={() => {
                                setDetailPlugin(null);
                                setExecutionModal({ plugin: detailPlugin, tool: activeTool });
                                setExecutionOutput(null);
                              }}
                            >
                              <Play className="h-3 w-3" /> Run Tool
                            </Button>
                          )}
                        </div>
                        <div className="rounded-lg border border-line bg-panel2/20 p-4">
                          <PluginRuntime
                            schema={activeTool.ui}
                            onSubmit={() => {}}
                            submitting={false}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-line bg-panel2/10 p-8 text-center">
                        <Puzzle className="mx-auto h-6 w-6 text-fg/15 mb-2" />
                        <p className="text-xs text-fg/40">No interactive UI — agent-only tool</p>
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })()}
      </ModalBackdrop>

      {/* Tool Execution Modal */}
      <ModalBackdrop
        open={!!executionModal}
        onClose={() => setExecutionModal(null)}
        size="xl"
      >
        {executionModal && (
          <Card className="max-h-[85vh] overflow-y-auto">
            <CardHeader className="flex flex-row items-center justify-between sticky top-0 bg-panel z-10">
              <div>
                <CardTitle>{executionModal.tool.name}</CardTitle>
                <p className="text-[11px] text-fg/50 mt-0.5">{executionModal.tool.description}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge tone={CATEGORY_COLORS[executionModal.plugin.category]} className="text-[9px] capitalize">
                    {executionModal.plugin.category}
                  </Badge>
                  <Badge tone="info" className="text-[9px]">{executionModal.tool.outputType}</Badge>
                  <span className="text-[10px] text-fg/30">{executionModal.plugin.name}</span>
                </div>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setExecutionModal(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardBody>
              {executionModal.tool.ui ? (
                <PluginRuntime
                  schema={executionModal.tool.ui}
                  onSubmit={handleExecuteTool}
                  onCancel={() => setExecutionModal(null)}
                  submitting={executing}
                  output={executionOutput}
                />
              ) : (
                <div className="py-8 text-center text-xs text-fg/40">
                  <Puzzle className="mx-auto h-8 w-8 text-fg/20 mb-3" />
                  <p>This tool has no interactive UI schema defined.</p>
                  <p className="mt-1">It can be invoked by the AI agent via the tool system.</p>
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </ModalBackdrop>

      {/* Create / Edit Plugin Modal */}
      <CreatePluginModal
        key={editingPlugin?.id ?? "create"}
        open={showCreateModal || !!editingPlugin}
        onClose={() => { setShowCreateModal(false); setEditingPlugin(null); }}
        datasets={datasetOptions}
        initialPlugin={editingPlugin ?? undefined}
        entityCategories={entityCategories}
        onCreated={(plugin) => {
          setPlugins((prev) => {
            const idx = prev.findIndex((p) => p.id === plugin.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = plugin;
              return next;
            }
            return [...prev, plugin];
          });
          setShowCreateModal(false);
          setEditingPlugin(null);
        }}
      />
    </div>
  );
}
