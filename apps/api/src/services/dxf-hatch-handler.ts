// Custom HATCH entity handler for dxf-parser.
//
// Why: the underlying dxf-parser library (1.1.2) doesn't ship a HATCH
// handler — HATCH entities silently disappear during parse, taking
// architectural wall hatching, floor patterns, and solid colour fills out
// of every downstream consumer (takeoff area rows, layer counts, the
// thumbnail SVG, etc.). For a construction-estimating tool this is a real
// regression vs the hand-rolled parser we replaced.
//
// What this handler covers (V1):
//   - Layer, color, common entity properties (via dxf-parser's helpers)
//   - Hatch pattern name, solid-fill flag, pattern angle / scale
//   - Polyline-style boundary paths (DXF type-flag bit 2). Each path
//     becomes an array of (x, y) vertices plus a closed flag. The first
//     polyline boundary is the natural "outer" boundary for takeoff
//     purposes — that's what we surface to DwgEntityMetadata.
//
// What it deliberately doesn't cover (yet):
//   - Composite boundary paths (line / arc / spline edges). Most
//     CAD-authored hatches use the polyline-path form; composite edges
//     show up only for hatches with curved boundaries. Detected and
//     marked via `compositeBoundaryCount` so downstream consumers can
//     flag the hatch instead of silently zeroing its area.
//   - Hatch pattern geometry (the lines making up the cross-hatch
//     pattern). The boundary is the takeoff-meaningful shape; the pattern
//     is decorative.
//
// The DXF group-code reference used here is the AutoCAD 2018 DXF Reference,
// HATCH section.
//
// Note on imports: dxf-parser's public `index.d.ts` only exports the
// entity-shape types and DxfParser itself. The IGeometry / IGroup /
// DxfArrayScanner types live in the package's dist folder without barrel
// re-exports. We import them as type-only (which gets erased at runtime)
// and inline copies of the runtime helpers parsePoint /
// checkCommonEntityProperties below — the dist .js files use extensionless
// ESM imports that Node/tsx can't resolve through `import {...}`, and
// re-implementing them avoids that coupling. The reference implementations
// are dxf-parser 1.1.2's ParseHelpers.js.

import type { default as DxfArrayScanner, IGroup } from "dxf-parser/dist/DxfArrayScanner";
import type IGeometry from "dxf-parser/dist/entities/geomtry";
import type { IEntity, IPoint } from "dxf-parser/dist/entities/geomtry";

/** Local copy of dxf-parser's `parsePoint`. Walks the scanner forward to
 *  collect the X, Y (and optionally Z) groups of a coordinate triple, then
 *  leaves the scanner positioned on the last group it consumed — exactly
 *  what dxf-parser's built-in handlers expect. */
function parsePoint(scanner: DxfArrayScanner): IPoint {
  const point: Partial<IPoint> = {};
  scanner.rewind();
  let curr = scanner.next();
  let code = curr.code;
  point.x = curr.value as number;
  code += 10;
  curr = scanner.next();
  if (curr.code !== code) {
    throw new Error(`Expected code for point value to be ${code} but got ${curr.code}.`);
  }
  point.y = curr.value as number;
  code += 10;
  curr = scanner.next();
  if (curr.code !== code) {
    scanner.rewind();
    return point as IPoint;
  }
  point.z = curr.value as number;
  return point as IPoint;
}

/** Local copy of dxf-parser's `checkCommonEntityProperties`. Fills in the
 *  entity-common fields (layer, handle, color index, paper-space flag,
 *  etc.) for any group code the per-entity switch didn't already consume.
 *  We skip the `getAcadColor` index → RGB lookup the upstream helper does
 *  (would require shipping the 257-entry AutoCAD color table); downstream
 *  takeoff uses the layer name, not the RGB value, to bucket hatches. */
function checkCommonEntityProperties(entity: IEntity, curr: IGroup, scanner: DxfArrayScanner): boolean {
  // dxf-parser declares IEntity with narrow literal types (e.g.
  // `handle: number`, `lineweight: 0 | 5 | 9 | 13 | …`). Real-world DXF
  // files put strings in `handle` (hex strings like "F2") and arbitrary
  // numbers in `lineweight` outside the AutoCAD-spec union. We cast to a
  // permissive record so this helper fills in whatever the file gave us
  // without the type system rejecting valid inputs.
  const e = entity as unknown as Record<string, unknown>;
  switch (curr.code) {
    case 0:
      e.type = String(curr.value);
      break;
    case 5:
      e.handle = String(curr.value);
      break;
    case 6:
      e.lineType = String(curr.value);
      break;
    case 8:
      e.layer = String(curr.value);
      break;
    case 48:
      e.lineTypeScale = Number(curr.value);
      break;
    case 60:
      e.visible = Number(curr.value) === 0;
      break;
    case 62:
      e.colorIndex = Number(curr.value);
      break;
    case 67:
      e.inPaperSpace = Number(curr.value) !== 0;
      break;
    case 100:
      break;
    case 101: {
      // Embedded object marker — skip to the next entity boundary.
      let next = curr;
      while (next.code !== 0) {
        next = scanner.next();
      }
      scanner.rewind();
      break;
    }
    case 330:
      e.ownerHandle = String(curr.value);
      break;
    case 347:
      e.materialObjectHandle = Number(curr.value);
      break;
    case 370:
      e.lineweight = Number(curr.value);
      break;
    case 420:
      e.color = Number(curr.value);
      break;
    case 1000: {
      const ext = (e.extendedData as { customStrings?: string[] } | undefined) ?? {};
      const customStrings = ext.customStrings ?? [];
      customStrings.push(String(curr.value));
      e.extendedData = { ...ext, customStrings };
      break;
    }
    case 1001: {
      const ext = (e.extendedData as { applicationName?: string } | undefined) ?? {};
      e.extendedData = { ...ext, applicationName: String(curr.value) };
      break;
    }
    default:
      return false;
  }
  return true;
}

/** A boundary path on a HATCH. Polyline paths are the V1 common case; we
 *  drop composite-edge paths for now (counted in IHatchEntity.compositeBoundaryCount). */
export interface HatchPolylineBoundary {
  closed: boolean;
  hasBulge: boolean;
  vertices: IPoint[];
}

/** What we surface for a HATCH after parsing. Shape-compatible with the
 *  IEntity contract dxf-parser expects; extra fields are picked up by
 *  our own mapper in dwg-processing-service. */
export interface IHatchEntity extends IEntity {
  patternName: string;
  solidFill: boolean;
  patternAngle: number;
  patternScale: number;
  associativity: boolean;
  /** Number of boundary paths declared in code-91. */
  boundaryPathCount: number;
  /** Polyline boundaries (DXF path type flag bit 2). */
  polylineBoundaries: HatchPolylineBoundary[];
  /** Number of boundary paths we encountered that used the composite-edge
   *  form (lines / arcs / splines). 0 = nothing fancy; nonzero = the
   *  hatch has curved-edge boundaries we didn't sample. Downstream can
   *  use this to flag "hatch boundary partially unavailable". */
  compositeBoundaryCount: number;
}

// Flags on group code 92 (boundary-path type).
const BOUNDARY_FLAG_POLYLINE = 2;

export class HatchEntityHandler implements IGeometry {
  // dxf-parser's published `EntityName` union doesn't include HATCH, but
  // its handler registry is keyed by the same open string the file uses
  // for entity types (`0` group value). The cast lets us register without
  // forking the library's type union.
  ForEntityName = "HATCH" as IGeometry["ForEntityName"];

  parseEntity(scanner: DxfArrayScanner, curr: IGroup): IHatchEntity {
    // Cast via `unknown` because IEntity declares many mandatory fields
    // (lineType, lineTypeScale, visible, colorIndex, color, inPaperSpace,
    // ownerHandle, materialObjectHandle, lineweight, extendedData, handle)
    // that the built-in entity parsers also leave undefined until
    // checkCommonEntityProperties fills them in. The IEntity contract is
    // effectively "build incrementally during parse" — matching the
    // pattern used by every dxf-parser built-in handler.
    const entity: IHatchEntity = {
      type: String(curr.value),
      patternName: "",
      solidFill: false,
      patternAngle: 0,
      patternScale: 1,
      associativity: false,
      boundaryPathCount: 0,
      polylineBoundaries: [],
      compositeBoundaryCount: 0,
    } as unknown as IHatchEntity;

    // State for the boundary path currently being read.
    let currentPolyline: HatchPolylineBoundary | null = null;
    let inPolylinePath = false;

    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0) break;

      switch (curr.code) {
        case 2:
          entity.patternName = String(curr.value);
          break;
        case 70:
          // Solid fill: 1 = solid, 0 = pattern.
          entity.solidFill = Number(curr.value) === 1;
          break;
        case 71:
          // Associativity flag.
          entity.associativity = Number(curr.value) === 1;
          break;
        case 91:
          // Number of boundary paths overall.
          entity.boundaryPathCount = Number(curr.value);
          break;
        case 92: {
          // Boundary-path type-flag word. Starts a NEW boundary path.
          const flags = Number(curr.value);
          inPolylinePath = (flags & BOUNDARY_FLAG_POLYLINE) !== 0;
          if (inPolylinePath) {
            currentPolyline = { closed: false, hasBulge: false, vertices: [] };
            entity.polylineBoundaries.push(currentPolyline);
          } else {
            // Composite edge path — we don't sample the edges in V1.
            // Increment the counter and keep currentPolyline null so 10/20
            // codes that follow don't accidentally feed into a polyline.
            currentPolyline = null;
            entity.compositeBoundaryCount += 1;
          }
          break;
        }
        case 72:
          // For polyline boundary: has-bulge flag (1 = vertices include bulges).
          if (inPolylinePath && currentPolyline) {
            currentPolyline.hasBulge = Number(curr.value) === 1;
          }
          break;
        case 73:
          // For polyline boundary: closed flag.
          if (inPolylinePath && currentPolyline) {
            currentPolyline.closed = Number(curr.value) === 1;
          }
          break;
        case 93:
          // For polyline boundary: vertex count. For composite boundary:
          // edge count. Not enforced here — we collect vertices via the
          // following 10/20 codes regardless.
          break;
        case 10:
          // X of a vertex on the current polyline boundary. parsePoint
          // walks the scanner forward to also consume codes 20 (and 30
          // if present), returning a single point.
          if (inPolylinePath && currentPolyline) {
            const point = parsePoint(scanner);
            currentPolyline.vertices.push(point);
          }
          break;
        case 52:
          // Pattern angle (in degrees).
          entity.patternAngle = Number(curr.value);
          break;
        case 41:
          // Pattern scale or spacing.
          entity.patternScale = Number(curr.value);
          break;
        default:
          // Common entity fields (layer, color, lineType, handle, ...).
          checkCommonEntityProperties(entity as unknown as IEntity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }

    // The scanner has advanced past the HATCH entity's last code, leaving
    // the cursor on the next entity's 0-code group — exactly where
    // dxf-parser's main loop expects it. checkCommonEntityProperties +
    // the explicit code-0 break above guarantee this.
    return entity;
  }
}
