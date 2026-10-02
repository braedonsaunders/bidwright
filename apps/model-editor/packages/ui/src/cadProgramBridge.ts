import {
    EditableShapeNode,
    type IApplication,
    type IDocument,
    type IShape,
    type ISolid,
    ShapeNode,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import {
    cadNodeId,
    validateCadBuild,
    validateCadParts,
    type CadBuild,
    type CadPart,
    type CadProgram,
    type CadSource,
} from "../../../../../packages/domain/src/cad-program";

export const geometrySignature = (brep: string) =>
    brep.replace(/^[01]{7}$/gm, (flags) => `000${flags.slice(3)}`);
export function worldBrep(app: IApplication, node: ShapeNode): string {
    if (!node.shape.isOk) throw new Error(`${node.name}: geometry unavailable`);
    const shape = node.shape.value.transformedMul(node.worldTransform());
    try {
        const converted = app.shapeFactory.converter.convertToBrep(shape);
        if (!converted.isOk) throw new Error(String(converted.error));
        return converted.value;
    } finally {
        shape.dispose();
    }
}
type Output = {
    id: string;
    name: string;
    nodeId: string;
    fingerprint: string;
    brep: string;
    material?: string;
};

export function cadProgramState(app: IApplication, document: IDocument, includeGeometry = false) {
    const program = document.userData?.["cadProgram"] as CadProgram | undefined;
    const outputs = (document.userData?.["cadOutputs"] ?? {}) as Record<string, Output>;
    const sources = (document.userData?.["cadSources"] ?? {}) as Record<string, CadSource>;
    const geometry: Record<string, string> = Object.create(null);
    if (includeGeometry) {
        const selected = new Set(document.selection.getSelectedNodes().map((n) => n.id));
        const owned = new Map(Object.values(outputs).map((o) => [o.nodeId, o]));
        const nodes = document.modelManager.findNodes((n) => n instanceof ShapeNode);
        nodes.sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)));
        let bytes = 0;
        for (const node of nodes) {
            const output = owned.get(node.id);
            // Parametric source handles pristine CAD parts; capture their live
            // geometry only when selected or manually changed.
            const brep = worldBrep(app, node as ShapeNode);
            if (
                output &&
                !selected.has(node.id) &&
                geometrySignature(brep) === geometrySignature(output.brep)
            )
                continue;
            if (bytes + brep.length > 24 * 1024 * 1024) continue;
            bytes += brep.length;
            geometry[node.id] = brep;
        }
    }
    return {
        program: program ?? null,
        cadParts: Object.values(outputs).map(({ brep: _, ...p }) => ({
            ...p,
            manuallyDeleted: !document.modelManager.findNode((n) => n.id === p.nodeId),
        })),
        ...(includeGeometry ? { sources, geometry } : {}),
    };
}

export function applyCadBuild(
    app: IApplication,
    document: IDocument,
    build: CadBuild,
    editableNodeIds?: string[],
): number {
    validateCadBuild(build);
    const previous = document.userData ?? {};
    const old = (previous["cadOutputs"] ?? {}) as Record<string, Output>;
    const priorSources = (previous["cadSources"] ?? {}) as Record<string, CadSource>;
    const byId = new Map(build.parts.map((p) => [p.id, p]));
    const deleted = Object.values(old).filter((p) => !byId.has(p.id));
    for (const part of deleted) {
        if (editableNodeIds?.length && !editableNodeIds.includes(part.nodeId))
            throw new Error(
                `${part.name}: outside the selected edit scope. Clear the selection to edit the whole assembly.`,
            );
        if (
            document.modelManager.findNode((n) => n.id === part.nodeId) &&
            !build.program.removedParts.includes(part.id)
        )
            throw new Error(
                `Retain unaffected part ${part.id}; deletion requires an explicit removedParts entry`,
            );
    }
    for (const [key, source] of Object.entries(build.sources)) {
        const prior = Object.hasOwn(priorSources, key) ? priorSources[key] : undefined;
        if (
            prior &&
            (prior.nodeId !== source.nodeId ||
                geometrySignature(prior.brep) !== geometrySignature(source.brep))
        )
            throw new Error(`Immutable input ${key} changed; use a NEW snapshot key to rebase`);
    }
    const changed: CadPart[] = [];
    const outputs: Record<string, Output> = Object.create(null);
    const prepared = new Map<string, IShape>();
    const created = new Map<string, EditableShapeNode>();
    const selected = new Set(document.selection.getSelectedNodes().map((n) => n.id));
    try {
        for (const part of build.parts) {
            const prior = Object.hasOwn(old, part.id) ? old[part.id] : undefined;
            const target = cadNodeId(part);
            if (prior && prior.nodeId !== target) throw new Error(`${part.id}: preserve its target node ID`);
            const live = document.modelManager.findNode((n) => n.id === target);
            if (live && !(live instanceof ShapeNode))
                throw new Error(`${part.name}: target is not an editable shape`);
            if (prior && !live)
                throw new Error(
                    `${part.name}: part was manually deleted; remove it from the source rather than recreating it`,
                );
            if (part.nodeId && !(live instanceof ShapeNode))
                throw new Error(`${part.name}: target geometry is unavailable`);
            if (prior && prior.fingerprint === part.fingerprint) {
                outputs[part.id] = { ...prior, name: part.name, material: part.material };
                continue;
            }
            if (live && editableNodeIds?.length && !editableNodeIds.includes(target))
                throw new Error(
                    `${part.name}: outside the selected edit scope. Clear the selection to edit the whole assembly.`,
                );
            if (live instanceof ShapeNode) {
                const manuallyChanged =
                    prior && geometrySignature(worldBrep(app, live)) !== geometrySignature(prior.brep);
                const isNewInput = Object.keys(build.program.imports).some(
                    (key) => !priorSources[key] && build.sources[key]?.nodeId === live.id,
                );
                if ((!prior || manuallyChanged) && !isNewInput)
                    throw new Error(
                        `${part.name}: use a NEW exact input snapshot of node ${live.id} before changing existing or manually edited geometry`,
                    );
            }
            const converted = app.shapeFactory.converter.convertFromBrep(part.brep);
            if (!converted.isOk) throw new Error(`${part.name}: ${converted.error}`);
            let shape = converted.value;
            prepared.set(part.id, shape);
            if (shape.isNull() || !shape.isValid())
                throw new Error(`${part.name}: invalid geometry in the editor kernel`);
            const solids =
                shape.shapeType === ShapeTypes.solid
                    ? [shape as ISolid]
                    : (shape.findSubShapes(ShapeTypes.solid) as ISolid[]);
            const volume = solids.reduce((sum, s) => sum + s.volume(), 0);
            if (shape.shapeType !== ShapeTypes.solid) solids.forEach((s) => s.dispose());
            if (
                !Number.isFinite(volume) ||
                volume <= 1e-9 ||
                Math.abs(volume - part.volumeMm3) > Math.max(1e-5, part.volumeMm3 * 1e-6)
            )
                throw new Error(`${part.name}: geometry failed the independent volume check`);
            if (live instanceof ShapeNode) {
                const inverse = live.worldTransform().invert();
                if (!inverse) throw new Error("Cannot edit a node with a singular transform");
                const local = shape.transformedMul(inverse);
                shape.dispose();
                shape = local;
                prepared.set(part.id, local);
            }
            const world =
                live instanceof ShapeNode ? shape.transformedMul(live.worldTransform()) : shape.clone();
            try {
                const brep = app.shapeFactory.converter.convertToBrep(world);
                if (!brep.isOk) throw new Error(String(brep.error));
                outputs[part.id] = {
                    id: part.id,
                    name: part.name,
                    nodeId: target,
                    fingerprint: part.fingerprint,
                    brep: brep.value,
                    material: part.material,
                };
            } finally {
                world.dispose();
            }
            changed.push(part);
        }
        const next = {
            ...previous,
            cadProgram: structuredClone(build.program),
            cadOutputs: outputs,
            cadSources: { ...build.sources },
            cadLibraryVersion: build.libraryVersion,
        };
        Transaction.execute(document, "AI CAD edit", () => {
            for (const part of deleted)
                document.modelManager
                    .findNode((n) => n.id === part.nodeId)
                    ?.parent?.remove(document.modelManager.findNode((n) => n.id === part.nodeId)!);
            for (const part of build.parts) {
                const existing = document.modelManager.findNode((n) => n.id === cadNodeId(part));
                const shape = prepared.get(part.id);
                if (!shape) {
                    if (existing && existing.name !== part.name) existing.name = part.name;
                    continue;
                }
                const node = new EditableShapeNode({
                    document,
                    id: cadNodeId(part),
                    name: part.name,
                    shape,
                    materialId: existing instanceof ShapeNode ? existing.materialId : undefined,
                });
                created.set(part.id, node);
                if (existing instanceof ShapeNode) {
                    node.transform = existing.transform;
                    node.visible = existing.visible;
                    const parent = existing.parent!;
                    parent.insertBefore(existing, node);
                    parent.remove(existing);
                } else document.modelManager.addNode(node);
                outputs[part.id].brep = worldBrep(app, node);
            }
            document.userData = next;
            Transaction.add(document, {
                name: "Editable CAD source",
                dispose() {},
                undo() {
                    document.userData = previous;
                },
                redo() {
                    document.userData = next;
                },
            });
        });
    } catch (error) {
        created.forEach((node) => {
            if (!node.parent) node.dispose();
        });
        prepared.forEach((shape, id) => {
            if (!created.has(id)) shape.dispose();
        });
        throw error;
    }
    document.selection.setSelection(
        document.modelManager.findNodes((n) => selected.has(n.id)),
        false,
    );
    document.visual.update();
    if (!previous["cadProgram"] && !previous["modelDesign"]) app.activeView?.cameraController.fitContent();
    app.activeView?.update();
    return changed.length + deleted.length;
}

/** Temporary geometry never enters document nodes, undo, autosave or exports. */
export class CadDraftPreview {
    private document?: IDocument;
    private meshes: number[] = [];
    constructor(private app: IApplication) {}
    clear() {
        this.meshes.forEach((id) => this.document?.visual.context.removeMesh(id));
        this.meshes = [];
        this.document?.visual.update();
        this.document = undefined;
    }
    show(document: IDocument, parts: CadPart[], editableNodeIds?: string[]) {
        validateCadParts(parts);
        this.clear();
        this.document = document;
        const old = (document.userData?.["cadOutputs"] ?? {}) as Record<string, Output>;
        try {
            for (const part of parts) {
                const prior = Object.hasOwn(old, part.id) ? old[part.id] : undefined;
                const target = cadNodeId(part);
                if (prior?.fingerprint === part.fingerprint) continue;
                if (
                    editableNodeIds?.length &&
                    document.modelManager.findNode((n) => n.id === target) &&
                    !editableNodeIds.includes(target)
                )
                    continue;
                const converted = this.app.shapeFactory.converter.convertFromBrep(part.brep);
                if (!converted.isOk) throw new Error(`${part.name}: ${converted.error}`);
                const shape = converted.value;
                try {
                    if (shape.isNull() || !shape.isValid())
                        throw new Error(`${part.name}: invalid draft geometry`);
                    const solids =
                        shape.shapeType === ShapeTypes.solid
                            ? [shape as ISolid]
                            : (shape.findSubShapes(ShapeTypes.solid) as ISolid[]);
                    let volume: number;
                    try {
                        volume = solids.reduce((sum, solid) => sum + solid.volume(), 0);
                    } finally {
                        if (shape.shapeType !== ShapeTypes.solid) solids.forEach((s) => s.dispose());
                    }
                    if (
                        !Number.isFinite(volume) ||
                        Math.abs(volume - part.volumeMm3) > Math.max(1e-5, part.volumeMm3 * 1e-6)
                    )
                        throw new Error(`${part.name}: invalid draft volume`);
                    const data = [shape.mesh.faces, shape.mesh.edges].filter((x) => x !== undefined);
                    this.meshes.push(document.visual.context.displayMesh(data, 0.65));
                } finally {
                    shape.dispose();
                }
            }
            if (!document.modelManager.findNode((n) => n instanceof ShapeNode))
                this.app.activeView?.cameraController.fitContent(true);
            document.visual.update();
            this.app.activeView?.update();
        } catch (error) {
            this.clear();
            throw error;
        }
    }
}
