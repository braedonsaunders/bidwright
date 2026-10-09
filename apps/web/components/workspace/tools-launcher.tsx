"use client";

import { Box, Boxes, Clock, FileSpreadsheet, Files, GitBranch, Ruler } from "lucide-react";
import { WorkspaceLauncher, type WorkspaceLaunchItem } from "@braedonsaunders/appkit-ui";
import type { FileNode } from "@/lib/api";
import { formatDate } from "@/lib/format";

export type AuthoringTool = "piping" | "cad" | "model" | "pdf" | "spreadsheet" | "bim";

const matchers: Record<AuthoringTool, RegExp> = {
  piping: /\.piping$/i,
  cad: /\.(dxf|dwg)$/i,
  model: /\.(cd|step|stp|glb|gltf|stl|obj)$/i,
  pdf: /\.pdf$/i,
  spreadsheet: /\.(xlsx?|csv)$/i,
  bim: /\.(ifc|rvt|nwd|nwc)$/i,
};

const tools: Array<Omit<WorkspaceLaunchItem<AuthoringTool>, "metric">> = [
  {
    id: "piping",
    title: "Piping Isometric",
    description: "Route measured pipe, design spools and issue fabrication drawing packages.",
    icon: GitBranch,
    tone: "teal",
    ghostIcon: true,
    metricLabel: "isometrics",
  },
  {
    id: "cad",
    title: "2D CAD",
    description: "Native DXF and DWG drafting with layers, blocks, dimensions and plotting.",
    icon: Ruler,
    tone: "amber",
    ghostIcon: true,
    metricLabel: "drawings",
  },
  {
    id: "model",
    title: "3D Geometry",
    description: "Model parts and assemblies, or review STEP, glTF, OBJ and STL geometry.",
    icon: Boxes,
    tone: "rose",
    ghostIcon: true,
    metricLabel: "models",
  },
  {
    id: "pdf",
    title: "PDF",
    description: "Open drawing sheets, calibrate scale, measure and mark up pages.",
    icon: Files,
    tone: "sky",
    ghostIcon: true,
    metricLabel: "documents",
  },
  {
    id: "spreadsheet",
    title: "Spreadsheet / CSV",
    description: "Build schedules, material lists and tabular calculations.",
    icon: FileSpreadsheet,
    tone: "emerald",
    ghostIcon: true,
    metricLabel: "sheets",
  },
  {
    id: "bim",
    title: "BIM",
    description: "Explore IFC building models, elements, properties and quantities.",
    icon: Box,
    tone: "violet",
    ghostIcon: true,
    metricLabel: "models",
  },
];

/** The Tools start surface: every authoring editor, plus the files most recently worked on. */
export function ToolsLauncher({
  nodes,
  spaceLabel,
  onSelect,
  onOpen,
}: {
  nodes: FileNode[];
  spaceLabel: string;
  onSelect: (tool: AuthoringTool) => void;
  onOpen: (node: FileNode) => void;
}) {
  const files = nodes.filter((n) => n.type === "file");
  const recent = files
    .filter((n) => Object.values(matchers).some((m) => m.test(n.name)))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, 6);
  const items = tools.map((tool) => ({
    ...tool,
    metric: files.filter((n) => matchers[tool.id].test(n.name)).length,
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-panel/60">
      <WorkspaceLauncher
        title="Tools"
        description={`Create in ${spaceLabel}. New files land in the selected folder, and any file can be added to a quote later.`}
        itemCountLabel={items.length}
        items={items}
        onSelect={onSelect}
        density="compact"
        className="rounded-none border-0"
      />
      {recent.length > 0 && (
        <div className="px-6 pb-6">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg/40">
            <Clock className="h-3 w-3" /> Recent
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {recent.map((node) => {
              const tool = tools.find((t) => matchers[t.id].test(node.name))!;
              const Icon = tool.icon;
              return (
                <button
                  key={node.id}
                  onClick={() => onOpen(node)}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-panel2"
                >
                  <Icon className="h-4 w-4 shrink-0 text-fg/50" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-fg">{node.name}</span>
                    <span className="block text-[11px] text-fg/40">
                      {tool.title} · {node.updatedAt ? formatDate(node.updatedAt) : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
