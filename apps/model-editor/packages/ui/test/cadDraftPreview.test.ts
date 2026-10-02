import { type IApplication, type IDocument, ShapeTypes } from "@chili3d/core";
import { CadDraftPreview } from "../src/cadProgramBridge";
import type { CadPart } from "../../../../../packages/domain/src/cad-program";

const part: CadPart = {
    id: "body",
    name: "Body",
    brep: "CASCADE Topology V3\n".repeat(5),
    fingerprint: "a".repeat(64),
    volumeMm3: 6,
    minMm: [0, 0, 0],
    maxMm: [1, 2, 3],
    sizeMm: [1, 2, 3],
};
function fixture() {
    const displayed: number[] = [],
        removed: number[] = [];
    let disposed = 0,
        fitted = 0,
        valid = true;
    const nodes: unknown[] = [];
    const data = { cadOutputs: {} };
    const history = { revision: 0 };
    const document = {
        userData: data,
        history,
        modelManager: { findNode: () => undefined, addNode: (n: unknown) => nodes.push(n) },
        visual: {
            update: () => {},
            context: {
                displayMesh: () => {
                    const id = displayed.length + 1;
                    displayed.push(id);
                    return id;
                },
                removeMesh: (id: number) => removed.push(id),
            },
        },
    } as unknown as IDocument;
    const app = {
        activeView: {
            document,
            update: () => {},
            cameraController: {
                fitContent: (temporary: boolean) => {
                    expect(temporary).toBe(true);
                    fitted++;
                },
            },
        },
        shapeFactory: {
            converter: {
                convertFromBrep: () => ({
                    isOk: true,
                    value: {
                        shapeType: ShapeTypes.solid,
                        isNull: () => false,
                        isValid: () => valid,
                        volume: () => 6,
                        dispose: () => disposed++,
                        mesh: { faces: {}, edges: {} },
                    },
                }),
            },
        },
    } as unknown as IApplication;
    return {
        document,
        preview: new CadDraftPreview(app),
        nodes,
        data,
        history,
        displayed,
        removed,
        disposed: () => disposed,
        fitted: () => fitted,
        invalid: () => {
            valid = false;
        },
    };
}

test("drafts display real temporary meshes without changing nodes, metadata or history", () => {
    const f = fixture();
    f.preview.show(f.document, [part]);
    expect(f.displayed).toEqual([1]);
    expect(f.nodes).toEqual([]);
    expect(f.document.userData).toBe(f.data);
    expect(f.history.revision).toBe(0);
    expect(f.disposed()).toBe(1);
    expect(f.fitted()).toBe(1);
    f.preview.show(f.document, [part]);
    expect(f.removed).toEqual([1]);
    f.preview.clear();
    expect(f.removed).toEqual([1, 2]);
    f.preview.clear();
    expect(f.removed).toEqual([1, 2]);
});
test("invalid draft geometry is disposed and clears the preceding preview", () => {
    const f = fixture();
    f.preview.show(f.document, [part]);
    f.invalid();
    expect(() => f.preview.show(f.document, [part])).toThrow(/invalid draft/);
    expect(f.disposed()).toBe(2);
    expect(f.removed).toEqual([1]);
    expect(f.nodes).toEqual([]);
});
