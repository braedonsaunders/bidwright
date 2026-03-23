"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  ModalBackdrop,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Constants ─── */

const ANNOTATION_TYPES = [
  { value: "linear", label: "Linear", description: "Measure distance between two points" },
  { value: "linear-polyline", label: "Polyline", description: "Measure length along multiple points" },
  { value: "linear-drop", label: "Linear Drop", description: "Polyline with drop distance at each vertex" },
  { value: "count", label: "Count", description: "Click to count individual items" },
  { value: "count-by-distance", label: "Count by Distance", description: "Auto-count items along a line at interval" },
  { value: "area-rectangle", label: "Rectangle", description: "Rectangular area measurement" },
  { value: "area-polygon", label: "Polygon", description: "Freeform polygon area measurement" },
  { value: "area-triangle", label: "Triangle", description: "Triangular area measurement" },
  { value: "area-ellipse", label: "Ellipse", description: "Elliptical area measurement" },
  { value: "area-vertical-wall", label: "Vertical Wall", description: "Wall area from perimeter and height" },
  { value: "calibrate", label: "Calibrate", description: "Set scale by measuring a known distance" },
] as const;

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#14b8a6", // teal
  "#a855f7", // purple
];

interface CreateAnnotationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (config: AnnotationConfig) => void;
}

export interface AnnotationConfig {
  type: string;
  label: string;
  color: string;
  thickness: number;
  groupName?: string;
  opts?: {
    dropDistance?: number;
    wallHeight?: number;
    height?: number;
    spacing?: number;
  };
}

export function CreateAnnotationModal({
  open,
  onClose,
  onConfirm,
}: CreateAnnotationModalProps) {
  const [type, setType] = useState("linear");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [customColor, setCustomColor] = useState("");
  const [thickness, setThickness] = useState(3);
  const [groupName, setGroupName] = useState("");

  /* Type-specific fields */
  const [dropDistance, setDropDistance] = useState(0);
  const [wallHeight, setWallHeight] = useState(8);
  const [height, setHeight] = useState(0);
  const [spacing, setSpacing] = useState(1);

  const selectedType = ANNOTATION_TYPES.find((t) => t.value === type);
  const needsDropDistance = type === "linear-drop";
  const needsWallHeight = type === "area-vertical-wall";
  const needsHeight = type.startsWith("area-") && type !== "area-vertical-wall";
  const needsSpacing = type === "count-by-distance";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalColor = customColor.match(/^#[0-9a-fA-F]{6}$/) ? customColor : color;

    const config: AnnotationConfig = {
      type,
      label: label.trim() || (selectedType?.label ?? type),
      color: finalColor,
      thickness,
      groupName: groupName.trim() || undefined,
      opts: {},
    };

    if (needsDropDistance) config.opts!.dropDistance = dropDistance;
    if (needsWallHeight) config.opts!.wallHeight = wallHeight;
    if (needsHeight && height > 0) config.opts!.height = height;
    if (needsSpacing) config.opts!.spacing = spacing;

    onConfirm(config);
    resetForm();
  }

  function resetForm() {
    setLabel("");
    setType("linear");
    setColor(PRESET_COLORS[0]);
    setCustomColor("");
    setThickness(3);
    setGroupName("");
    setDropDistance(0);
    setWallHeight(8);
    setHeight(0);
    setSpacing(1);
  }

  return (
    <ModalBackdrop open={open} onClose={onClose} size="md">
      <Card>
        <CardHeader>
          <CardTitle>New Annotation</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type selector */}
            <div>
              <Label htmlFor="ann-type">Measurement Type</Label>
              <Select
                id="ann-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {ANNOTATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              {selectedType && (
                <p className="mt-1 text-[11px] text-fg/40">{selectedType.description}</p>
              )}
            </div>

            {/* Label */}
            <div>
              <Label htmlFor="ann-label">Label</Label>
              <Input
                id="ann-label"
                placeholder={selectedType?.label ?? "Annotation label..."}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            {/* Group name */}
            <div>
              <Label htmlFor="ann-group">Group (optional)</Label>
              <Input
                id="ann-group"
                placeholder="e.g. Foundation, Walls, Electrical..."
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>

            {/* Color picker */}
            <div>
              <Label>Color</Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(c);
                      setCustomColor("");
                    }}
                    className={cn(
                      "h-7 w-7 rounded-md border-2 transition-all",
                      color === c && !customColor
                        ? "border-fg scale-110"
                        : "border-transparent hover:border-fg/20"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <Input
                  className="h-7 w-24 text-xs ml-1"
                  placeholder="#hex"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                />
              </div>
            </div>

            {/* Thickness slider */}
            <div>
              <Label htmlFor="ann-thickness">
                Line Thickness: {thickness}pt
              </Label>
              <input
                id="ann-thickness"
                type="range"
                min={2}
                max={40}
                value={thickness}
                onChange={(e) => setThickness(parseInt(e.target.value, 10))}
                className="w-full accent-accent"
              />
            </div>

            {/* Type-specific fields */}
            {needsDropDistance && (
              <div>
                <Label htmlFor="ann-drop">Drop Distance (units)</Label>
                <Input
                  id="ann-drop"
                  type="number"
                  min={0}
                  step={0.1}
                  value={dropDistance}
                  onChange={(e) => setDropDistance(parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            {needsWallHeight && (
              <div>
                <Label htmlFor="ann-wall-height">Wall Height (units)</Label>
                <Input
                  id="ann-wall-height"
                  type="number"
                  min={0}
                  step={0.1}
                  value={wallHeight}
                  onChange={(e) => setWallHeight(parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            {needsHeight && (
              <div>
                <Label htmlFor="ann-height">Height / Depth for Volume (optional, units)</Label>
                <Input
                  id="ann-height"
                  type="number"
                  min={0}
                  step={0.1}
                  value={height}
                  onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
                />
              </div>
            )}

            {needsSpacing && (
              <div>
                <Label htmlFor="ann-spacing">Count Interval / Spacing (units)</Label>
                <Input
                  id="ann-spacing"
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={spacing}
                  onChange={(e) => setSpacing(parseFloat(e.target.value) || 1)}
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="accent" size="sm">
                Start Drawing
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </ModalBackdrop>
  );
}
