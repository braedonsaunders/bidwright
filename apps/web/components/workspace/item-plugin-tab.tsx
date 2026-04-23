"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Puzzle, Wrench } from "lucide-react";

import { PluginRuntime } from "@/components/plugin-runtime";
import { Badge } from "@/components/ui";
import type {
  PluginExecutionRecord,
  PluginOutput,
  PluginRecord,
  PluginToolDefinition,
  ProjectWorkspaceData,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import {
  executePlugin,
  listPluginExecutions,
  listPlugins,
} from "@/lib/api";

const CATEGORY_COLORS: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  labour: "success",
  equipment: "warning",
  material: "default",
  travel: "danger",
  general: "info",
};

interface ItemPluginTabProps {
  item: WorkspaceWorksheetItem;
  workspace: ProjectWorkspaceData;
  onRefreshWorkspace: () => void;
  onError: (message: string) => void;
}

interface PluginExecutionContext {
  execution: PluginExecutionRecord;
  plugin: PluginRecord | null;
  tool: PluginToolDefinition | null;
}

function resolvePluginExecutionContext(
  itemId: string,
  executions: PluginExecutionRecord[],
  plugins: PluginRecord[],
): PluginExecutionContext | null {
  const execution = executions.find(
    (candidate) =>
      candidate.output?.type === "line_items" &&
      (candidate.appliedLineItemIds ?? []).includes(itemId),
  );

  if (!execution) {
    return null;
  }

  const plugin = plugins.find((candidate) => candidate.id === execution.pluginId) ?? null;
  const tool = plugin?.toolDefinitions.find((candidate) => candidate.id === execution.toolId) ?? null;

  return {
    execution,
    plugin,
    tool,
  };
}

export function ItemPluginTab({
  item,
  workspace,
  onRefreshWorkspace,
  onError,
}: ItemPluginTabProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [executionContext, setExecutionContext] = useState<PluginExecutionContext | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executionOutput, setExecutionOutput] = useState<PluginOutput | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setExecutionContext(null);
    setExecutionOutput(null);

    Promise.all([
      listPluginExecutions(workspace.project.id),
      listPlugins(),
    ])
      .then(([executions, plugins]) => {
        if (cancelled) {
          return;
        }

        const nextContext = resolvePluginExecutionContext(item.id, executions, plugins);
        setExecutionContext(nextContext);
        setExecutionOutput(nextContext?.execution.output ?? null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Failed to load plugin session.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, workspace.project.id]);

  const initialValues = useMemo(() => {
    const values = executionContext?.execution.formState?.values;
    if (values && typeof values === "object" && !Array.isArray(values)) {
      return values as Record<string, unknown>;
    }
    return executionContext?.execution.input ?? {};
  }, [executionContext]);

  const initialTableData = useMemo(() => {
    const tableData = executionContext?.execution.formState?.tableData;
    if (tableData && typeof tableData === "object" && !Array.isArray(tableData)) {
      return tableData as Record<string, Record<string, unknown>[]>;
    }
    return {};
  }, [executionContext]);

  const initialScoringData = useMemo(() => {
    const scoringData = executionContext?.execution.formState?.scoringData;
    if (scoringData && typeof scoringData === "object" && !Array.isArray(scoringData)) {
      return scoringData as Record<string, Record<string, number>>;
    }
    return {};
  }, [executionContext]);

  const handleSubmit = useCallback(async (data: {
    values: Record<string, unknown>;
    tableData: Record<string, Record<string, unknown>[]>;
    scoringData: Record<string, Record<string, number>>;
  }) => {
    if (!executionContext?.plugin || !executionContext.tool) {
      return;
    }

    setExecuting(true);

    try {
      const nextExecution = await executePlugin(
        executionContext.plugin.id,
        executionContext.tool.id,
        workspace.project.id,
        workspace.currentRevision.id,
        data.values,
        {
          worksheetId: item.worksheetId,
          replaceExecutionId: executionContext.execution.id,
          formState: {
            values: data.values,
            tableData: data.tableData,
            scoringData: data.scoringData,
          },
        },
      );

      setExecutionContext((current) =>
        current
          ? {
              ...current,
              execution: nextExecution,
            }
          : current,
      );
      setExecutionOutput(nextExecution.output as PluginOutput);
      onRefreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plugin execution failed.";
      setExecutionOutput({
        type: "summary",
        displayText: `Error: ${message}`,
      });
      onError(message);
    } finally {
      setExecuting(false);
    }
  }, [executionContext, item.worksheetId, onError, onRefreshWorkspace, workspace.currentRevision.id, workspace.project.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-fg/40">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading plugin session...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      </div>
    );
  }

  if (!executionContext) {
    return (
      <div className="rounded-xl border border-line bg-panel2/20 p-5 text-sm text-fg/50">
        This line item was not created by a reopenable plugin run.
      </div>
    );
  }

  const { execution, plugin, tool } = executionContext;

  if (!plugin || !tool) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="info">Plugin Session</Badge>
          <span className="text-xs text-fg/35">{execution.pluginId}</span>
        </div>
        <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning">
          This plugin tool is no longer available in the current plugin catalog, so its saved parameters
          can&apos;t be reopened here.
        </div>
      </div>
    );
  }

  if (!tool.ui) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone={CATEGORY_COLORS[plugin.category] ?? "default"} className="capitalize">
            {plugin.category}
          </Badge>
          <Badge tone="info">{tool.outputType}</Badge>
          {!plugin.enabled && <Badge tone="warning">Disabled</Badge>}
        </div>
        <div className="rounded-xl border border-line bg-panel2/20 p-5 text-sm text-fg/50">
          This tool does not expose an interactive parameter form, so it cannot be reopened from the line
          item drawer.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-panel2/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CATEGORY_COLORS[plugin.category] ?? "default"} className="capitalize">
            {plugin.category}
          </Badge>
          <Badge tone="info">{tool.outputType}</Badge>
          <Badge tone="default">
            {(execution.appliedLineItemIds ?? []).length} linked {(execution.appliedLineItemIds ?? []).length === 1 ? "item" : "items"}
          </Badge>
          {!plugin.enabled && <Badge tone="warning">Disabled</Badge>}
        </div>
        <div className="mt-3 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Wrench className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-fg/90">{tool.name}</span>
              <span className="text-xs text-fg/35">{plugin.name}</span>
            </div>
            <p className="mt-1 text-sm text-fg/55">{tool.description}</p>
          </div>
        </div>
      </div>

      {!plugin.enabled ? (
        <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning">
          This plugin is currently disabled, so its saved parameters can be viewed but not re-run.
        </div>
      ) : (
        <PluginRuntime
          key={execution.id}
          schema={tool.ui}
          pluginId={plugin.id}
          toolId={tool.id}
          initialValues={initialValues}
          initialTableData={initialTableData}
          initialScoringData={initialScoringData}
          onSubmit={handleSubmit}
          submitting={executing}
          output={executionOutput}
        />
      )}

      {plugin.enabled && !executing && !executionOutput && (
        <div className="rounded-xl border border-line bg-panel2/20 p-4 text-sm text-fg/45">
          Saved plugin parameters are loaded here. Re-running this tool will replace the linked plugin-created
          line items in this worksheet instead of creating duplicates.
        </div>
      )}

      {!plugin.enabled && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-panel2/20 p-4 text-sm text-fg/45">
          <Puzzle className="h-4 w-4 shrink-0 text-fg/35" />
          Enable the plugin again to edit and reapply its parameters from this tab.
        </div>
      )}
    </div>
  );
}
