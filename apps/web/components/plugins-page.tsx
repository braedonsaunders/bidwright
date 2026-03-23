"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Plus,
  Puzzle,
  Search,
  X,
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
} from "@/lib/api";
import {
  updatePlugin as apiUpdatePlugin,
  executePlugin as apiExecutePlugin,
} from "@/lib/api";

const CATEGORY_COLORS: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  labour: "success",
  equipment: "warning",
  material: "default",
  travel: "danger",
  general: "info",
};

interface ToolExecutionModalState {
  plugin: PluginRecord;
  tool: PluginToolDefinition;
}

export function PluginsPage({
  initialPlugins,
  initialDatasets,
  projectId,
  revisionId,
}: {
  initialPlugins: PluginRecord[];
  initialDatasets?: DatasetRecord[];
  projectId?: string;
  revisionId?: string;
}) {
  const [plugins, setPlugins] = useState<PluginRecord[]>(initialPlugins);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [executionModal, setExecutionModal] = useState<ToolExecutionModalState | null>(null);
  const [executionOutput, setExecutionOutput] = useState<PluginOutput | null>(null);
  const [executing, setExecuting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlugin, setEditingPlugin] = useState<PluginRecord | null>(null);

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
        { formState: { ...data.values, _tables: data.tableData, _scores: data.scoringData } },
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

          return (
            <FadeIn key={plugin.id} delay={0.05 + i * 0.02}>
              <Card className="transition-shadow hover:ring-1 hover:ring-accent/20">
                <CardHeader
                  className="flex flex-row items-start justify-between gap-3 cursor-pointer"
                  onClick={() => setEditingPlugin(plugin)}
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
