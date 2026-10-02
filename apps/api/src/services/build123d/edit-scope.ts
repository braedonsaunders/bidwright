import { cadNodeId, type CadBuild, type CadSource } from "@bidwright/domain";

/** Reject unsafe candidates before they reach the editor; errors go back to the agent. */
export function validateCadEditScope(build: CadBuild, context: unknown, priorSources: Record<string, CadSource> = {}, restrictSelection = true) {
  const state = context as { nodes?: Array<{ id: string; selected?: boolean; manuallyModified?: boolean }>; cadParts?: Array<{ id: string; nodeId: string; fingerprint: string; manuallyDeleted?: boolean }> } | null;
  if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.cadParts)) return;
  const selected = new Set(state.nodes.filter(n => n.selected).map(n => n.id));
  const prior = new Map(state.cadParts.map(p => [p.id, p]));
  const output = new Map(build.parts.map(p => [p.id, p]));
  for (const p of state.cadParts) {
    if (!p.manuallyDeleted && !output.has(p.id) && !build.program.removedParts.includes(p.id)) throw new Error(`Retain unaffected part ${p.id}; only explicit requested deletions belong in removedParts`);
    if (p.manuallyDeleted && output.has(p.id)) throw new Error(`${p.id} was manually deleted; remove it from the source instead of recreating it`);
    if (!output.has(p.id) && !p.manuallyDeleted && restrictSelection && selected.size && !selected.has(p.nodeId)) throw new Error(`${p.id}: cannot delete a part outside the selected edit scope`);
  }
  for (const p of build.parts) {
    const old = prior.get(p.id);
    const target = cadNodeId(p);
    if (old && old.nodeId !== target) throw new Error(`${p.id}: preserve target node ID ${old.nodeId}`);
    if (old?.fingerprint === p.fingerprint) continue;
    const live = state.nodes.find(n => n.id === target);
    if (!live) { if (p.nodeId) throw new Error(`${p.name}: target node is unavailable`); continue; }
    if (restrictSelection && selected.size && !selected.has(target)) throw new Error(`${p.name}: retain unchanged geometry outside the selected edit scope`);
    const rebased = Object.keys(build.program.imports).some(key => !Object.hasOwn(priorSources, key) && build.sources[key]?.nodeId === target);
    if ((!old || live.manuallyModified) && !rebased) throw new Error(`${p.name}: use a NEW exact input snapshot of node ${target}; do not discard its existing/manual geometry`);
  }
}
