import {
    EditableShapeNode,
    type IApplication,
    type IDocument,
    type IShape,
    type ISolid,
    Line,
    Matrix4,
    Plane,
    type Result,
    ShapeNode,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import {
    type DesignScalar,
    type DesignVector,
    evaluateDesignScalar,
    type ModelDesign,
    modelDesignPartSignature,
    validateModelDesign,
} from "../../../../../packages/domain/src/model-design";

export function buildDesignShapes(
    app: IApplication,
    recipe: ModelDesign,
    options: { partIds?: Set<string>; existing?: (feature: ModelDesign["features"][number]) => IShape } = {},
): Map<string, IShape> {
    validateModelDesign(recipe);
    const factory = app.shapeFactory;
    const features = new Map<string, IShape>();
    const owned = new Set<IShape>();
    const parts = new Map<string, IShape>();
    const n = (value: DesignScalar) => evaluateDesignScalar(value, recipe.parameters);
    const factor = recipe.units === "in" ? 25.4 : 1;
    const length = (value: DesignScalar) => n(value) * factor;
    const positive = (value: DesignScalar | undefined) => {
        if (value === undefined) throw new Error("Missing dimension");
        const result = length(value);
        if (result < 0.0001 || result > 1e6)
            throw new Error("Dimensions must be between 0.0001 and 1,000,000 mm");
        return result;
    };
    const v = (value: DesignVector = [0, 0, 0], dimensional = true) => {
        const [x, y, z] = value.map((x) => (dimensional ? length(x) : n(x)));
        return new XYZ({ x: x!, y: y!, z: z! });
    };
    const keep = (shape: IShape) => {
        owned.add(shape);
        return shape;
    };
    const result = (r: Result<IShape>) => {
        if (!r.isOk) throw new Error(String(r.error));
        return keep(r.value);
    };
    const wantedParts = recipe.parts.filter((p) => !options.partIds || options.partIds.has(p.id));
    const needed = new Set<string>();
    const byId = new Map(recipe.features.map((f) => [f.id, f]));
    const include = (id: string) => {
        if (needed.has(id)) return;
        needed.add(id);
        (byId.get(id)?.inputs ?? []).forEach(include);
    };
    wantedParts.forEach((p) => include(p.feature));
    try {
        for (const f of recipe.features.filter((f) => needed.has(f.id))) {
            try {
                const inputs = (f.inputs ?? []).map((id) => {
                    const shape = features.get(id);
                    if (!shape) throw new Error(`Missing input ${id}`);
                    return shape;
                });
                const origin = v(f.origin);
                const axis = v(f.axis ?? [0, 0, 1], false);
                if (axis.length() < 1e-10) throw new Error("Axis cannot be zero");
                let shape: IShape;
                switch (f.op) {
                    case "existing": {
                        if (!options.existing) throw new Error("Existing geometry is unavailable");
                        shape = keep(options.existing(f));
                        break;
                    }
                    case "box":
                    case "tube": {
                        const xDirection = v(
                            f.xDirection ?? (Math.abs(axis.normalize()!.x) > 0.99 ? [0, 1, 0] : [1, 0, 0]),
                            false,
                        );
                        if (
                            xDirection.length() < 1e-10 ||
                            Math.abs(axis.normalize()!.dot(xDirection.normalize()!)) > 1e-6
                        )
                            throw new Error("Axis and xDirection must be perpendicular");
                        const plane = new Plane({
                            origin,
                            normal: axis,
                            xvec: xDirection,
                        });
                        const [width, depth, height] = f.size!.map(positive);
                        shape = result(factory.box(plane, width!, depth!, height!));
                        if (f.op === "tube") {
                            const wall = positive(f.wall);
                            if (wall * 2 >= Math.min(width!, depth!))
                                throw new Error("Tube wall must be less than half its outside width/depth");
                            const innerOrigin = origin
                                .add(plane.xvec.multiply(wall))
                                .add(plane.yvec.multiply(wall))
                                .sub(plane.normal.multiply(wall));
                            const inside = result(
                                factory.box(
                                    plane.translateTo(innerOrigin),
                                    width! - 2 * wall,
                                    depth! - 2 * wall,
                                    height! + 2 * wall,
                                ),
                            );
                            shape = result(factory.booleanCut([shape], [inside]));
                        }
                        break;
                    }
                    case "cylinder":
                        shape = result(
                            factory.cylinder(axis, origin, positive(f.radius), positive(f.height)),
                        );
                        break;
                    case "sphere":
                        shape = result(factory.sphere(origin, positive(f.radius)));
                        break;
                    case "extrude":
                    case "revolve": {
                        const wire = factory.polygon(f.points!.map((point) => v(point)));
                        if (!wire.isOk) throw new Error(String(wire.error));
                        keep(wire.value);
                        const face = result(wire.value.toFace());
                        shape =
                            f.op === "extrude"
                                ? result(factory.prism(face, v(f.direction!)))
                                : result(
                                      factory.revolve(
                                          face,
                                          new Line({ point: origin, direction: axis }),
                                          (n(f.angle ?? 360) * Math.PI) / 180,
                                      ),
                                  );
                        break;
                    }
                    case "union":
                        shape = result(factory.booleanFuse([inputs[0]!], inputs.slice(1)));
                        break;
                    case "cut":
                        shape = result(factory.booleanCut([inputs[0]!], inputs.slice(1)));
                        break;
                    case "intersect":
                        shape = result(factory.booleanCommon([inputs[0]!], inputs.slice(1)));
                        break;
                    case "transform": {
                        const rotation = v(f.rotation, false).multiply(Math.PI / 180);
                        shape = keep(
                            inputs[0]!.transformed(
                                Matrix4.createFromTRS(
                                    v(f.translation),
                                    { pitch: rotation.x, yaw: rotation.y, roll: rotation.z },
                                    XYZ.one,
                                ),
                            ),
                        );
                        break;
                    }
                    case "fillet":
                    case "chamfer": {
                        const edges = inputs[0]!.findSubShapes(ShapeTypes.edge);
                        const indices = f.edges ?? edges.map((_, index) => index);
                        edges.forEach((edge) => edge.dispose());
                        if (indices.some((index) => index >= edges.length))
                            throw new Error("Edge index is outside the shape");
                        shape = result(
                            f.op === "fillet"
                                ? factory.fillet(inputs[0]!, indices, positive(f.radius))
                                : factory.chamfer(inputs[0]!, indices, positive(f.radius)),
                        );
                        break;
                    }
                }
                if (shape.isNull()) throw new Error("Operation produced an empty shape");
                features.set(f.id, shape);
            } catch (error) {
                throw new Error(
                    `${f.id} (${f.op}): ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        for (const part of wantedParts) {
            const source = features.get(part.feature)!;
            if (!source.isValid()) throw new Error(`${part.name}: OpenCascade reported invalid geometry`);
            const solids =
                source.shapeType === ShapeTypes.solid
                    ? [source as ISolid]
                    : (source.findSubShapes(ShapeTypes.solid) as ISolid[]);
            const volume = solids.reduce((sum, solid) => sum + solid.volume(), 0);
            if (source.shapeType !== ShapeTypes.solid) solids.forEach((s) => s.dispose());
            if (!Number.isFinite(volume) || volume <= 1e-9)
                throw new Error(`${part.name}: part must contain a solid with positive volume`);
            parts.set(part.id, source.clone());
        }
        return parts;
    } catch (error) {
        parts.forEach((shape) => shape.dispose());
        throw error;
    } finally {
        owned.forEach((shape) => shape.dispose());
    }
}

function partNodeId(part: ModelDesign["parts"][number]) {
    return part.nodeId ?? `design-${part.id}`;
}
type SourceSnapshot = { nodeId: string; brep: string };
function worldBrep(app: IApplication, node: ShapeNode): string {
    if (!node.shape.isOk) throw new Error(`${node.name}: geometry unavailable`);
    const world = node.shape.value.transformedMul(node.worldTransform());
    try {
        const converted = app.shapeFactory.converter.convertToBrep(world);
        if (!converted.isOk) throw new Error(String(converted.error));
        return converted.value;
    } finally {
        world.dispose();
    }
}

// Free/Modified/Checked are transient OCCT bookkeeping flags, not geometry.
// Ignore these when comparing BReps across validation, display and file reloads.
function geometrySignature(brep: string): string {
    return brep.replace(/^[01]{7}$/gm, (flags) => `000${flags.slice(3)}`);
}

function applyDesign(app: IApplication, document: IDocument, recipe: ModelDesign): number {
    validateModelDesign(recipe);
    const previous = document.userData ?? {};
    const old = previous["modelDesign"] as ModelDesign | undefined;
    const oldParts = new Map((old?.parts ?? []).map((p) => [p.id, p]));
    const sources: Record<string, SourceSnapshot> = Object.assign(
        Object.create(null),
        previous["modelDesignSources"] ?? {},
    );
    const outputs: Record<string, string> = Object.assign(
        Object.create(null),
        previous["modelDesignOutputs"] ?? {},
    );
    const changed = new Set<string>();
    const deleted = (old?.parts ?? []).filter((p) => !recipe.parts.some((n) => n.id === p.id));
    for (const part of deleted) {
        if (
            document.modelManager.findNode((n) => n.id === partNodeId(part)) &&
            !recipe.removedParts?.includes(part.id)
        )
            throw new Error(
                `Retain unaffected part ${part.id}; removing it requires an explicit removedParts entry`,
            );
    }
    for (const part of recipe.parts) {
        const prior = oldParts.get(part.id);
        if (prior && partNodeId(prior) !== partNodeId(part))
            throw new Error(`${part.id}: preserve the existing target node id`);
        if (!prior || !old || modelDesignPartSignature(old, prior) !== modelDesignPartSignature(recipe, part))
            changed.add(part.id);
        if (!changed.has(part.id)) continue;
        const live = document.modelManager.findNode((n) => n.id === partNodeId(part));
        if (prior && !live)
            throw new Error(
                `${part.name}: this part was manually deleted. Remove it from the recipe rather than recreating it`,
            );
        if (part.nodeId && !(live instanceof ShapeNode))
            throw new Error(`${part.name}: target node is unavailable`);
        if (
            live instanceof ShapeNode &&
            outputs[live.id] &&
            geometrySignature(worldBrep(app, live)) !== geometrySignature(outputs[live.id])
        ) {
            const byId = new Map(recipe.features.map((f) => [f.id, f]));
            const visited = new Set<string>();
            const rebased = (id: string): boolean => {
                if (visited.has(id)) return false;
                visited.add(id);
                const f = byId.get(id)!;
                return (
                    (f.op === "existing" && f.nodeId === live.id && !sources[f.id]) ||
                    (f.inputs ?? []).some(rebased)
                );
            };
            if (!rebased(part.feature))
                throw new Error(
                    `${part.name}: manual edits exist. Use a NEW existing feature for nodeId ${live.id} to edit its current geometry without discarding those edits`,
                );
        }
    }
    if (old && changed.size === 0 && deleted.length === 0 && JSON.stringify(old) === JSON.stringify(recipe))
        return 0;
    // Only evaluate dependencies of changed parts; keep all unrelated nodes untouched.
    const shapes = buildDesignShapes(app, recipe, {
        partIds: changed,
        existing: (feature) => {
            let snapshot = sources[feature.id];
            if (snapshot && snapshot.nodeId !== feature.nodeId)
                throw new Error("Existing feature IDs cannot change their source node");
            if (!snapshot) {
                const node = document.modelManager.findNode((n) => n.id === feature.nodeId);
                if (!(node instanceof ShapeNode)) throw new Error(`Missing existing node ${feature.nodeId}`);
                snapshot = { nodeId: node.id, brep: worldBrep(app, node) };
                sources[feature.id] = snapshot;
            }
            const shape = app.shapeFactory.converter.convertFromBrep(snapshot.brep);
            if (!shape.isOk) throw new Error(String(shape.error));
            return shape.value;
        },
    });
    const created = new Map<string, EditableShapeNode>();
    const selectedIds = new Set(document.selection.getSelectedNodes().map((n) => n.id));
    const next = {
        ...previous,
        modelDesign: structuredClone(recipe),
        modelDesignSources: sources,
        modelDesignOutputs: outputs,
    };
    try {
        // Prepare outputs before mutation so a failure leaves the document intact.
        for (const part of recipe.parts.filter((p) => changed.has(p.id))) {
            const converted = app.shapeFactory.converter.convertToBrep(shapes.get(part.id)!);
            if (!converted.isOk) throw new Error(String(converted.error));
            outputs[partNodeId(part)] = converted.value;
        }
        Transaction.execute(document, "AI design edit", () => {
            deleted.forEach((part) => {
                const node = document.modelManager.findNode((n) => n.id === partNodeId(part));
                node?.parent?.remove(node);
                delete outputs[partNodeId(part)];
            });
            for (const part of recipe.parts) {
                const existing = document.modelManager.findNode((n) => n.id === partNodeId(part));
                if (!changed.has(part.id)) {
                    if (existing && oldParts.get(part.id)?.name !== part.name) existing.name = part.name;
                    continue;
                }
                let shape = shapes.get(part.id)!;
                if (existing instanceof ShapeNode) {
                    const inverse = existing.worldTransform().invert();
                    if (!inverse) throw new Error("Cannot edit geometry with a singular transform");
                    const local = shape.transformedMul(inverse);
                    shape.dispose();
                    shape = local;
                    shapes.set(part.id, local);
                }
                const node = new EditableShapeNode({
                    document,
                    id: partNodeId(part),
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
                outputs[node.id] = worldBrep(app, node);
            }
            document.userData = next;
            Transaction.add(document, {
                name: "Design recipe",
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
        shapes.forEach((shape, id) => {
            if (!created.has(id)) shape.dispose();
        });
        throw error;
    }
    document.selection.setSelection(
        document.modelManager.findNodes((n) => selectedIds.has(n.id)),
        false,
    );
    document.visual.update();
    if (!old) app.activeView?.cameraController.fitContent();
    app.activeView?.update();
    return changed.size + deleted.length;
}

function modelState(app: IApplication, document: IDocument) {
    const selected = new Set(document.selection.getSelectedNodes().map((n) => n.id));
    const detailed = new Set([...selected].slice(0, 2));
    const stored = document.userData?.["modelDesign"] as ModelDesign | undefined;
    const outputs = document.userData?.["modelDesignOutputs"] as Record<string, string> | undefined;
    return {
        recipe: stored
            ? {
                  ...stored,
                  parts: stored.parts.filter((p) =>
                      document.modelManager.findNode((n) => n.id === partNodeId(p)),
                  ),
              }
            : null,
        history: document.userData?.["designConversation"] ?? [],
        name: document.name,
        kernelVersion: wasm.kernelVersion(),
        nodes: document.modelManager
            .findNodes((n) => n instanceof ShapeNode)
            .slice(0, 200)
            .map((node) => {
                const typed = node as ShapeNode;
                if (!typed.shape.isOk)
                    return { id: node.id, name: node.name, error: String(typed.shape.error) };
                const world = typed.shape.value.transformedMul(typed.worldTransform());
                try {
                    const box = world.boundingBox();
                    const topology = (type: typeof ShapeTypes.edge | typeof ShapeTypes.face, max: number) => {
                        const subshapes = world.findSubShapes(type);
                        try {
                            return subshapes.slice(0, max).map((shape, index) => {
                                const b = shape.boundingBox();
                                return {
                                    index,
                                    minMm: [b.min.x, b.min.y, b.min.z],
                                    maxMm: [b.max.x, b.max.y, b.max.z],
                                };
                            });
                        } finally {
                            subshapes.forEach((s) => s.dispose());
                        }
                    };
                    return {
                        id: node.id,
                        name: node.name,
                        selected: selected.has(node.id),
                        sizeMm: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
                        minMm: [box.min.x, box.min.y, box.min.z],
                        maxMm: [box.max.x, box.max.y, box.max.z],
                        manuallyModified: Boolean(
                            outputs?.[node.id] &&
                                geometrySignature(worldBrep(app, typed)) !==
                                    geometrySignature(outputs[node.id]),
                        ),
                        ...(detailed.has(node.id)
                            ? { edges: topology(ShapeTypes.edge, 80), faces: topology(ShapeTypes.face, 40) }
                            : {}),
                    };
                } finally {
                    world.dispose();
                }
            }),
    };
}

export function installModelDesignBridge(app: IApplication): () => void {
    const receive = (event: MessageEvent) => {
        if (
            event.origin !== window.location.origin ||
            (event.source !== window.parent && event.source !== window.opener)
        )
            return;
        const request = event.data;
        if (
            request?.source !== "bidwright-host" ||
            request.type !== "bidwright:model-design-request" ||
            typeof request.requestId !== "string"
        )
            return;
        const target = event.source as Window;
        try {
            if (window.document.body.dataset["bidwrightModelLoading"] === "true")
                throw new Error("The model is still opening");
            const document = app.activeView?.document;
            if (!document) throw new Error("The model is still opening");
            const editedParts =
                request.action === "apply" ? applyDesign(app, document, request.recipe) : undefined;
            if (request.action === "apply") {
                /* applied above */
            } else if (request.action === "conversation") {
                if (
                    !Array.isArray(request.history) ||
                    request.history.length > 100 ||
                    request.history.some(
                        (m: { role?: string; content?: string }) =>
                            !["user", "assistant"].includes(m.role ?? "") ||
                            typeof m.content !== "string" ||
                            m.content.length > 12000,
                    )
                )
                    throw new Error("Invalid design conversation");
                document.userData = { ...document.userData, designConversation: request.history };
            } else if (request.action === "undo") {
                document.history.undo();
                document.visual.update();
                app.activeView?.update();
            } else if (request.action === "export") {
                const shapes: IShape[] = [];
                try {
                    for (const node of document.modelManager.findNodes((n) => n instanceof ShapeNode)) {
                        const typed = node as ShapeNode;
                        if (typed.shape.isOk)
                            shapes.push(typed.shape.value.transformedMul(typed.worldTransform()));
                    }
                    if (!shapes.length) throw new Error("Create geometry before exporting");
                    const exported = app.shapeFactory.converter.convertToSTEP(...shapes);
                    if (!exported.isOk) throw new Error(String(exported.error));
                    target.postMessage(
                        {
                            type: "bidwright:model-design-result",
                            source: "bidwright-model-editor",
                            requestId: request.requestId,
                            ok: true,
                            step: exported.value,
                            ...modelState(app, document),
                        },
                        window.location.origin,
                    );
                    return;
                } finally {
                    shapes.forEach((shape) => shape.dispose());
                }
            } else if (request.action !== "state") throw new Error("Unsupported model action");
            target.postMessage(
                {
                    type: "bidwright:model-design-result",
                    source: "bidwright-model-editor",
                    requestId: request.requestId,
                    ok: true,
                    editedParts,
                    ...modelState(app, document),
                },
                window.location.origin,
            );
        } catch (error) {
            target.postMessage(
                {
                    type: "bidwright:model-design-result",
                    source: "bidwright-model-editor",
                    requestId: request.requestId,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                },
                window.location.origin,
            );
        }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
}
