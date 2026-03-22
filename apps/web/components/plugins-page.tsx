"use client";

import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Puzzle,
  Wrench,
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
  Label,
  Toggle,
} from "@/components/ui";
import type { PluginRecord } from "@/lib/api";
import { updatePlugin as apiUpdatePlugin } from "@/lib/api";

const CATEGORY_COLORS: Record<string, "default" | "success" | "warning" | "danger"> = {
  labour: "success",
  equipment: "warning",
  material: "default",
  travel: "danger",
  general: "default",
};

export function PluginsPage({ initialPlugins }: { initialPlugins: PluginRecord[] }) {
  const [plugins, setPlugins] = useState<PluginRecord[]>(initialPlugins);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

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

  const handleConfigChange = useCallback(async (pluginId: string, key: string, value: string) => {
    try {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin) return;
      const updated = await apiUpdatePlugin(pluginId, {
        config: { ...plugin.config, [key]: value },
      });
      setPlugins((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    } catch {
      // ignore
    }
  }, [plugins]);

  const categories = ["all", ...Array.from(new Set(plugins.map((p) => p.category)))];
  const filtered = filterCategory === "all"
    ? plugins
    : plugins.filter((p) => p.category === filterCategory);

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Plugins</h1>
            <p className="text-xs text-fg/50">
              Manage estimation tools, product lookups, and integrations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-fg/30" />
            <span className="text-xs text-fg/40">
              {plugins.filter((p) => p.enabled).length} of {plugins.length} active
            </span>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="flex gap-2">
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
      </FadeIn>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((plugin, i) => {
          const expanded = expandedId === plugin.id;
          const tone = CATEGORY_COLORS[plugin.category] ?? "default";
          return (
            <FadeIn key={plugin.id} delay={0.05 + i * 0.03}>
              <Card
                className={cn(
                  "transition-shadow cursor-pointer",
                  expanded && "ring-1 ring-accent/30"
                )}
              >
                <CardHeader
                  className="flex flex-row items-start justify-between gap-3"
                  onClick={() => toggleExpand(plugin.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className="text-sm truncate">
                        {plugin.name}
                      </CardTitle>
                      <Badge tone={tone} className="shrink-0 capitalize text-[10px]">
                        {plugin.category}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-fg/50 line-clamp-2">
                      {plugin.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Toggle
                      checked={plugin.enabled}
                      onChange={(val) => {
                        void handleToggleEnabled(plugin.id, val);
                      }}
                    />
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-fg/30" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-fg/30" />
                    )}
                  </div>
                </CardHeader>

                {expanded && (
                  <CardBody className="border-t border-line pt-3 space-y-4">
                    <div className="flex items-center gap-3 text-[11px] text-fg/40">
                      <span>v{plugin.version}</span>
                      <span>Slug: {plugin.slug}</span>
                    </div>

                    {/* Tool Definitions */}
                    <div>
                      <p className="text-[11px] font-medium text-fg/60 mb-2 flex items-center gap-1.5">
                        <Wrench className="h-3 w-3" />
                        Tools ({plugin.toolDefinitions.length})
                      </p>
                      <div className="space-y-1.5">
                        {plugin.toolDefinitions.map((tool) => (
                          <div
                            key={tool.id}
                            className="rounded-lg bg-panel2 px-3 py-2"
                          >
                            <p className="text-xs font-medium text-fg/80">
                              {tool.name}
                            </p>
                            <p className="text-[11px] text-fg/40 mt-0.5">
                              {tool.description}
                            </p>
                            {tool.parameters.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {tool.parameters.map((param) => (
                                  <span
                                    key={param.name}
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[10px]",
                                      param.required
                                        ? "bg-accent/10 text-accent"
                                        : "bg-panel text-fg/40"
                                    )}
                                  >
                                    {param.name}
                                    {param.required ? "*" : ""}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Config */}
                    {Object.keys(plugin.config).length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-fg/60 mb-2">
                          Configuration
                        </p>
                        <div className="space-y-2">
                          {Object.entries(plugin.config).map(([key, value]) => (
                            <div key={key}>
                              <Label className="capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</Label>
                              <Input
                                type={key.toLowerCase().includes("key") || key.toLowerCase().includes("password") ? "password" : "text"}
                                value={String(value ?? "")}
                                onChange={(e) => {
                                  void handleConfigChange(plugin.id, key, e.target.value);
                                }}
                                placeholder={`Enter ${key}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardBody>
                )}
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
              <p className="text-sm text-fg/50">No plugins found in this category</p>
            </CardBody>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}
