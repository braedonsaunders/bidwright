/**
 * Default classification heuristics for BIM elements.
 *
 * Most authored BIM models lack explicit Uniformat/MasterFormat codes — they
 * carry IFC class names (or Revit categories that translate cleanly to IFC).
 * This module provides a sensible default mapping so newly ingested elements
 * arrive in the BIM workspace pre-classified, and the user only has to
 * override the edge cases instead of code every element from scratch.
 *
 * The mappings are deliberately conservative: when an IFC class could map to
 * multiple Uniformat codes (e.g. an IFCWALL might be exterior or interior),
 * we pick the most common authored case, with a note in the doc-comment so
 * the heuristic stays auditable. Users override per element via the BIM
 * workspace; manual overrides are tagged so re-ingest doesn't clobber them.
 *
 * Coverage spans the IFC entities most often used for estimating quantity
 * takeoff (architecture, structure, MEP). Niche entities fall through with
 * empty classification — the user can still tag them manually.
 */

/** A construction-classification record matching WorksheetItem.classification.
 *  All keys are optional; an adapter can populate just the standards it knows. */
export interface BimClassificationDefaults {
  uniformat?: string;
  masterformat?: string;
  omniclass?: string;
}

/**
 * Default classification per IFC class. Codes are upper-case so the IFC class
 * coming out of web-ifc (or APS, or any other adapter) can match without
 * normalization. Intentionally narrow on Uniformat — we use the level-3 code
 * (e.g. B2010) which is the most common reporting level. MasterFormat codes
 * are at the section level (XX XX 00) where authoritative; some are left
 * empty when the IFC class doesn't map cleanly to a single section.
 */
const IFC_CLASSIFICATION_DEFAULTS: Record<string, BimClassificationDefaults> = {
  // ── Substructure (Uniformat A) ─────────────────────────────────────────
  IFCFOOTING:        { uniformat: "A1010", masterformat: "03 30 00" }, // Standard Foundations / Cast-in-Place Concrete
  IFCPILE:           { uniformat: "A1020", masterformat: "31 62 00" }, // Special Foundations / Driven Piles

  // ── Shell — Superstructure (Uniformat B1) ──────────────────────────────
  // Default a slab to floor construction; users override to B1020 (roof) for roof slabs.
  IFCSLAB:                 { uniformat: "B1010", masterformat: "03 30 00" },
  IFCSLABSTANDARDCASE:     { uniformat: "B1010", masterformat: "03 30 00" },
  IFCBEAM:                 { uniformat: "B1010", masterformat: "05 12 00" }, // Structural Steel Framing default; concrete beams override
  IFCBEAMSTANDARDCASE:     { uniformat: "B1010", masterformat: "05 12 00" },
  IFCCOLUMN:               { uniformat: "B1010", masterformat: "05 12 00" },
  IFCCOLUMNSTANDARDCASE:   { uniformat: "B1010", masterformat: "05 12 00" },
  IFCMEMBER:               { uniformat: "B1010", masterformat: "05 12 00" },
  IFCMEMBERSTANDARDCASE:   { uniformat: "B1010", masterformat: "05 12 00" },
  IFCPLATE:                { uniformat: "B1010", masterformat: "05 12 00" },
  IFCPLATESTANDARDCASE:    { uniformat: "B1010", masterformat: "05 12 00" },
  IFCELEMENTASSEMBLY:      { uniformat: "B1010", masterformat: "05 12 00" },

  // ── Shell — Exterior Enclosure (Uniformat B2) ──────────────────────────
  // Walls default to exterior; interior partitions are common but exterior is
  // the structural-frame-relevant default. Users tag interior walls to C1010.
  IFCWALL:               { uniformat: "B2010", masterformat: "04 22 00" }, // Concrete Unit Masonry default; framed walls override
  IFCWALLSTANDARDCASE:   { uniformat: "B2010", masterformat: "04 22 00" },
  IFCWALLELEMENTEDCASE:  { uniformat: "B2010", masterformat: "04 22 00" },
  IFCCURTAINWALL:        { uniformat: "B2010", masterformat: "08 44 00" }, // Curtain Wall and Glazed Assemblies
  IFCWINDOW:             { uniformat: "B2020", masterformat: "08 50 00" }, // Windows
  IFCWINDOWSTANDARDCASE: { uniformat: "B2020", masterformat: "08 50 00" },
  IFCDOOR:               { uniformat: "B2030", masterformat: "08 11 00" }, // Metal Doors and Frames default; wood/glass doors override
  IFCDOORSTANDARDCASE:   { uniformat: "B2030", masterformat: "08 11 00" },

  // ── Shell — Roofing (Uniformat B3) ─────────────────────────────────────
  IFCROOF: { uniformat: "B3010", masterformat: "07 50 00" }, // Membrane Roofing default

  // ── Interiors (Uniformat C) ────────────────────────────────────────────
  IFCSTAIR:                  { uniformat: "C2010", masterformat: "05 51 00" }, // Metal Stairs default
  IFCSTAIRFLIGHT:            { uniformat: "C2010", masterformat: "05 51 00" },
  IFCRAMP:                   { uniformat: "C2010", masterformat: "03 30 00" },
  IFCRAMPFLIGHT:             { uniformat: "C2010", masterformat: "03 30 00" },
  IFCRAILING:                { uniformat: "C2020", masterformat: "05 52 00" }, // Metal Railings
  // Coverings cover too many surfaces (floor finishes, ceiling tiles, wall paint)
  // for a clean default. Leave empty so users tag explicitly.
  IFCCOVERING:               { },

  // ── Services — Plumbing (Uniformat D2 / MasterFormat 22) ──────────────
  IFCPIPE:           { uniformat: "D2020", masterformat: "22 11 00" },
  IFCPIPESEGMENT:    { uniformat: "D2020", masterformat: "22 11 00" },
  IFCPIPEFITTING:    { uniformat: "D2020", masterformat: "22 11 00" },

  // ── Services — HVAC (Uniformat D3 / MasterFormat 23) ──────────────────
  IFCDUCT:           { uniformat: "D3030", masterformat: "23 31 00" },
  IFCDUCTSEGMENT:    { uniformat: "D3030", masterformat: "23 31 00" },
  IFCDUCTFITTING:    { uniformat: "D3030", masterformat: "23 31 00" },
  IFCFLOWFITTING:    { uniformat: "D3030", masterformat: "23 31 00" },
  IFCFLOWSEGMENT:    { uniformat: "D3030", masterformat: "23 31 00" },
  IFCAIRTERMINAL:    { uniformat: "D3030", masterformat: "23 37 00" }, // Air Outlets and Inlets
  IFCFLOWTERMINAL:   { uniformat: "D3030", masterformat: "23 37 00" },
  IFCVALVE:          { uniformat: "D2020", masterformat: "22 05 23" }, // General-Duty Valves for Plumbing Piping
  IFCFAN:            { uniformat: "D3030", masterformat: "23 34 00" },
  IFCPUMP:           { uniformat: "D2020", masterformat: "22 11 23" },

  // ── Equipment & Furnishings (Uniformat E) ──────────────────────────────
  IFCFURNISHINGELEMENT: { uniformat: "E2010", masterformat: "12 50 00" }, // Furniture
  IFCFURNITURE:         { uniformat: "E2010", masterformat: "12 50 00" },

  // ── Special Construction & Conveying (Uniformat F) ─────────────────────
  // No clean defaults — leave empty.

  // ── Spatial / proxy (no physical takeoff value) ────────────────────────
  // IFCSPACE, IFCBUILDINGSTOREY, IFCBUILDING, IFCSITE, IFCBUILDINGELEMENTPROXY
  // — intentionally NOT in the map; they shouldn't carry classification.
};

/**
 * Returns the default classification record for an IFC class name. The
 * input is matched case-insensitively. Returns an empty object for unmapped
 * classes — the caller decides whether to persist an empty `classification`
 * blob or skip the field entirely.
 */
export function defaultClassificationForIfcClass(className: string): BimClassificationDefaults {
  if (!className) return {};
  return IFC_CLASSIFICATION_DEFAULTS[className.toUpperCase()] ?? {};
}

/**
 * Convert a {@link BimClassificationDefaults} record into the JSON shape
 * persisted on `ModelElement.classification` and `WorksheetItem.classification`
 * (see `classification-utils.ts` in apps/web). Returns undefined when no
 * codes are set, so adapters can avoid writing empty blobs.
 */
export function classificationDefaultsToRecord(
  defaults: BimClassificationDefaults,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (defaults.uniformat) out.uniformat = defaults.uniformat;
  if (defaults.masterformat) out.masterformat = defaults.masterformat;
  if (defaults.omniclass) out.omniclass = defaults.omniclass;
  return Object.keys(out).length > 0 ? out : undefined;
}
