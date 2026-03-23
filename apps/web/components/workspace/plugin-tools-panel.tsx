"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import {
  Puzzle,
  Wrench,
  Play,
  X,
  Search,
  ChevronRight,
} from "lucide-react";
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
  Separator,
} from "@/components/ui";
import { PluginRuntime } from "@/components/plugin-runtime";
import type {
  PluginRecord,
  PluginToolDefinition,
  PluginOutput,
} from "@/lib/api";
import {
  listPlugins,
  executePlugin as apiExecutePlugin,
  listDatasets,
  listDatasetRows,
} from "@/lib/api";

const CATEGORY_COLORS: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  labour: "success",
  equipment: "warning",
  material: "default",
  travel: "danger",
  general: "info",
};

interface SelectedTool {
  plugin: PluginRecord;
  tool: PluginToolDefinition;
}

export function PluginToolsPanel({
  projectId,
  revisionId,
  worksheetId,
  open,
  onClose,
  onItemsCreated,
}: {
  projectId: string;
  revisionId: string;
  worksheetId?: string;
  open: boolean;
  onClose: () => void;
  onItemsCreated?: () => void;
}) {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTool, setSelectedTool] = useState<SelectedTool | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executionOutput, setExecutionOutput] = useState<PluginOutput | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  // Load plugins
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listPlugins()
      .then((p) => setPlugins(p.filter((pl) => pl.enabled)))
      .catch(() => setPlugins([]))
      .finally(() => setLoading(false));
  }, [open]);

  const allTools = useMemo(() => {
    const tools: Array<{ plugin: PluginRecord; tool: PluginToolDefinition }> = [];
    for (const p of plugins) {
      for (const t of p.toolDefinitions) {
        tools.push({ plugin: p, tool: t });
      }
    }
    return tools;
  }, [plugins]);

  const filteredTools = useMemo(() => {
    let result = allTools;
    if (filterCategory !== "all") {
      result = result.filter((t) => t.plugin.category === filterCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.tool.name.toLowerCase().includes(q) ||
          t.tool.description.toLowerCase().includes(q) ||
          t.plugin.name.toLowerCase().includes(q) ||
          (t.tool.tags ?? []).some((tag) => tag.includes(q))
      );
    }
    return result;
  }, [allTools, filterCategory, search]);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(plugins.map((p) => p.category)))],
    [plugins]
  );

  const handleExecute = useCallback(async (data: {
    values: Record<string, unknown>;
    tableData: Record<string, Record<string, unknown>[]>;
    scoringData: Record<string, Record<string, number>>;
  }) => {
    if (!selectedTool) return;
    setExecuting(true);
    setExecutionOutput(null);
    try {
      const result = await apiExecutePlugin(
        selectedTool.plugin.id,
        selectedTool.tool.id,
        projectId,
        revisionId,
        data.values,
        {
          worksheetId,
          formState: { ...data.values, _tables: data.tableData, _scores: data.scoringData },
        },
      );
      setExecutionOutput(result.output as PluginOutput);
      onItemsCreated?.();
    } catch (err) {
      setExecutionOutput({
        type: "summary",
        displayText: `Error: ${err instanceof Error ? err.message : "Execution failed"}`,
      });
    } finally {
      setExecuting(false);
    }
  }, [selectedTool, projectId, revisionId, worksheetId, onItemsCreated]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ x: 480 }}
      animate={{ x: 0 }}
      exit={{ x: 480 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 z-50 w-[480px] bg-panel border-l border-line shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-panel2/40 shrink-0">
        <div className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">
            {selectedTool ? selectedTool.tool.name : "Plugin Tools"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedTool && (
            <Button variant="ghost" size="xs" onClick={() => { setSelectedTool(null); setExecutionOutput(null); }}>
              All Tools
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-xs text-fg/40">Loading plugins...</span>
            </div>
          ) : selectedTool ? (
            /* Tool execution view */
            <div className="p-4">
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={CATEGORY_COLORS[selectedTool.plugin.category]} className="text-[9px] capitalize">
                    {selectedTool.plugin.category}
                  </Badge>
                  <Badge tone="info" className="text-[9px]">{selectedTool.tool.outputType}</Badge>
                  <span className="text-[10px] text-fg/30">{selectedTool.plugin.name}</span>
                </div>
                <p className="text-[11px] text-fg/50">{selectedTool.tool.description}</p>
              </div>

              {selectedTool.tool.ui ? (
                <PluginRuntime
                  schema={selectedTool.tool.ui}
                  onSubmit={handleExecute}
                  onCancel={() => { setSelectedTool(null); setExecutionOutput(null); }}
                  submitting={executing}
                  output={executionOutput}
                />
              ) : (
                <div className="py-8 text-center text-xs text-fg/40">
                  <Puzzle className="mx-auto h-8 w-8 text-fg/20 mb-3" />
                  <p>This tool has no interactive UI.</p>
                  <p className="mt-1">Use the AI assistant to invoke it.</p>
                </div>
              )}
            </div>
          ) : (
            /* Tool browser */
            <div className="p-4 space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
                <Input
                  className="pl-9 h-8 text-xs"
                  placeholder="Search tools..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Category filter */}
              <div className="flex gap-1.5 overflow-x-auto">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors capitalize whitespace-nowrap",
                      filterCategory === cat
                        ? "bg-accent/10 text-accent"
                        : "text-fg/40 hover:bg-panel2 hover:text-fg/60"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Tool list */}
              <div className="space-y-1.5">
                {filteredTools.map(({ plugin, tool }) => (
                  <button
                    key={`${plugin.id}-${tool.id}`}
                    onClick={() => { setSelectedTool({ plugin, tool }); setExecutionOutput(null); }}
                    className="w-full text-left rounded-lg border border-line p-3 hover:bg-panel2/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Wrench className="h-3.5 w-3.5 text-fg/30 shrink-0" />
                        <span className="text-xs font-medium text-fg/80 truncate">{tool.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge tone={CATEGORY_COLORS[plugin.category]} className="text-[9px] capitalize">
                          {plugin.category}
                        </Badge>
                        {tool.ui && (
                          <Play className="h-3 w-3 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                        <ChevronRight className="h-3 w-3 text-fg/20" />
                      </div>
                    </div>
                    <p className="text-[10px] text-fg/40 mt-1 line-clamp-1">{tool.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] text-fg/25">{plugin.name}</span>
                      <Badge tone="info" className="text-[8px]">{tool.outputType}</Badge>
                      {!tool.ui && <span className="text-[8px] text-fg/20">AI only</span>}
                    </div>
                  </button>
                ))}
              </div>

              {filteredTools.length === 0 && (
                <div className="py-8 text-center">
                  <Puzzle className="mx-auto h-6 w-6 text-fg/15 mb-2" />
                  <p className="text-xs text-fg/30">
                    {search ? "No tools match your search" : "No enabled plugins"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
    </motion.div>
  );
}

