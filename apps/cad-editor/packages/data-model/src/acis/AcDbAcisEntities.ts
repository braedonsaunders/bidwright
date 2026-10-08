import type {
  AcDbAcisSabData,
  AcDbAcisSabHeader,
  AcDbAcisSabRecord,
  AcDbAcisSabVector,
} from './AcDbAcisSab'
import { AcDbAcisSabTag } from './AcDbAcisSab'

/**
 * One node in the resolved ACIS B-rep entity DAG.
 * Pointers in the source record are resolved to references to other nodes.
 */
export interface AcDbAcisNode {
  /** Zero-based index of this node in the model's record list. */
  readonly index: number
  /** ACIS entity type name, e.g. `"body"`, `"edge"`, `"plane-surface"`. */
  readonly type: string
  /** Raw SAB record backing this node. */
  readonly record: AcDbAcisSabRecord
  /** Resolved pointer targets from this record's tokens. */
  readonly refs: readonly (AcDbAcisNode | null)[]
}

/**
 * Resolved ACIS/ASM B-rep model graph built from parsed SAB data.
 */
export interface AcDbAcisModel {
  /** Parsed SAB file header metadata. */
  readonly header: AcDbAcisSabHeader
  /** All resolved entity nodes in record order. */
  readonly nodes: readonly AcDbAcisNode[]
  /** Top-level `body` entity nodes. */
  readonly bodies: readonly AcDbAcisNode[]
  /** Count of nodes per entity type name. */
  readonly typeCounts: ReadonlyMap<string, number>
  /** Returns all nodes whose entity type matches `type`. */
  nodesOfType(type: string): readonly AcDbAcisNode[]
  /** Collects 3D locations from all `point` entity records. */
  pointLocations(): readonly AcDbAcisSabVector[]
}

const END_MARKERS = new Set([
  'End-of-ACIS-data',
  'End-of-ASM-data',
  'End-of-ACIS-History-data',
])

interface AcDbAcisMutableNode {
  index: number
  type: string
  record: AcDbAcisSabRecord
  refs: (AcDbAcisNode | null)[]
}

/**
 * Builds a resolved B-rep DAG from parsed SAB data by wiring pointer tokens
 * between records.
 *
 * @param sab - Parsed SAB header and record list from {@link acdbParseAcisSab}.
 * @returns Resolved model graph with indexed nodes and type-based lookups.
 */
export function acdbBuildAcisModel(sab: AcDbAcisSabData): AcDbAcisModel {
  const records = sab.records
  const nodes: AcDbAcisMutableNode[] = records.map((record, index) => ({
    index,
    type: record.type,
    record,
    refs: [],
  }))

  for (const node of nodes) {
    for (const token of node.record.tokens) {
      if (token.tag !== AcDbAcisSabTag.Pointer) continue
      const target = token.value as number
      node.refs.push(
        target >= 0 && target < nodes.length ? (nodes[target] as AcDbAcisNode) : null,
      )
    }
  }

  const frozen = nodes as unknown as AcDbAcisNode[]
  const byType = new Map<string, AcDbAcisNode[]>()
  const typeCounts = new Map<string, number>()
  for (const node of frozen) {
    if (END_MARKERS.has(node.type)) continue
    let bucket = byType.get(node.type)
    if (bucket === undefined) {
      bucket = []
      byType.set(node.type, bucket)
    }
    bucket.push(node)
    typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1)
  }

  return {
    header: sab.header,
    nodes: frozen,
    bodies: byType.get('body') ?? [],
    typeCounts,
    nodesOfType: (type: string) => byType.get(type) ?? [],
    pointLocations() {
      const out: AcDbAcisSabVector[] = []
      for (const node of byType.get('point') ?? []) {
        const vec = node.record.tokens.find(t => t.tag === AcDbAcisSabTag.LocationVec)
        if (vec !== undefined) out.push(vec.value as AcDbAcisSabVector)
      }
      return out
    },
  }
}
