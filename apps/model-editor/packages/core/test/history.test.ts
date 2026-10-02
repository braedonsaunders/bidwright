// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ArrayRecord, History, PropertyHistoryRecord } from "@chili3d/core";

describe("test history", () => {
    class TestClass {
        property: string;
        arrItems: number[];
        setItems: Set<number>;

        constructor() {
            this.property = "p1";
            this.arrItems = [1];
            this.setItems = new Set();
        }
    }

    test("edit revisions advance past the undo limit, including undo and redo", () => {
        const history = new History();
        history.undoLimits = 1;
        const revisions: number[] = [];
        const unsubscribe = history.onChanged(() => {
            revisions.push(history.revision);
        });
        const record = () => ({ name: "edit", undo() {}, redo() {}, dispose() {} });
        history.add(record());
        history.add(record());
        expect(history.undoCount()).toBe(1);
        history.undo();
        history.redo();
        expect(revisions).toEqual([1, 2, 3, 4]);
        history.disabled = true;
        history.add(record());
        expect(history.revision).toBe(4);
        unsubscribe();
        history.undo();
        expect(revisions).toHaveLength(4);
        history.dispose();
    });

    test("test modify history", () => {
        const obj = new TestClass();
        const history = new History();
        const h: PropertyHistoryRecord = new PropertyHistoryRecord(obj, "property", "p1", "p2");
        const action = new ArrayRecord("test");
        action.records.push(h);
        history.add(action);
        expect(history.undoCount()).toBe(1);
        expect(history.redoCount()).toBe(0);
        history.undo();
        expect(obj.property).toBe("p1");
        expect(history.undoCount()).toBe(0);
        expect(history.redoCount()).toBe(1);
        history.redo();
        expect(obj.property).toBe("p2");
        expect(history.undoCount()).toBe(1);
        expect(history.redoCount()).toBe(0);
        history.undo();
        expect(history.redoCount()).toBe(1);
        history.add(action);
        expect(history.undoCount()).toBe(1);
        expect(history.redoCount()).toBe(0);
    });
});
