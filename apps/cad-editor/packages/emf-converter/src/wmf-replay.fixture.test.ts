/**
 * End-to-end colour-fidelity regression test driven by a real-world WMF file.
 *
 * `sample-crown.wmf` is a multi-colour clipart crown (red / gold / green /
 * black / white) exported by a real application. It exercises the GDI object
 * table the way production metafiles actually do: every coloured region is
 * drawn by creating a solid brush, selecting it into slot 0, filling a
 * POLYPOLYGON, then deleting slot 0 so the next brush reuses that slot.
 *
 * A previous bug assigned object slots with a monotonically increasing counter
 * instead of reusing the lowest freed slot. SELECTOBJECT then referenced an
 * empty slot, the coloured brush was never applied, and the crown rendered as
 * black-and-grey. This test replays the fixture and asserts the coloured
 * brushes actually reach the canvas as fill styles, guarding against any
 * regression in slot allocation / colour handling over time.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { parseWmfHeader } from './emf-header-parser';
import { replayWmfRecords } from './wmf-replay';

/** Load the binary fixture as a DataView. */
function loadFixture(name: string): DataView {
	const path = fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
	const bytes = readFileSync(path);
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Mock 2D context that records the `fillStyle` in effect at every fill
 * operation, so we can assert which brush colours actually got painted.
 */
function makeRecordingCtx(): {
	ctx: CanvasRenderingContext2D;
	fillColors: string[];
} {
	const fillColors: string[] = [];
	const ctx: Record<string, unknown> = {
		fillStyle: '#000000',
		strokeStyle: '#000000',
		lineWidth: 1,
		font: '12px sans-serif',
		save() {},
		restore() {},
		beginPath() {},
		closePath() {},
		moveTo() {},
		lineTo() {},
		arc() {},
		arcTo() {},
		ellipse() {},
		rect() {},
		stroke() {},
		strokeRect() {},
		clip() {},
		setTransform() {},
		setLineDash() {},
		fillText() {},
		drawImage() {},
		fill() {
			fillColors.push(String(ctx.fillStyle));
		},
		fillRect() {
			fillColors.push(String(ctx.fillStyle));
		},
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, fillColors };
}

describe('wmf-replay fixture: sample-crown.wmf', () => {
	it('parses the placeable WMF header', () => {
		const view = loadFixture('sample-crown.wmf');
		const header = parseWmfHeader(view);
		expect(header).not.toBeNull();
		// Logical bounds must be a non-empty rectangle for a renderable canvas.
		expect(header!.boundsRight - header!.boundsLeft).toBeGreaterThan(0);
		expect(header!.boundsBottom - header!.boundsTop).toBeGreaterThan(0);
	});

	it('applies the coloured brushes (no colour loss from slot reuse)', () => {
		const view = loadFixture('sample-crown.wmf');
		const header = parseWmfHeader(view)!;
		const { ctx, fillColors } = makeRecordingCtx();

		replayWmfRecords(view, ctx, header, 1000, 1000);

		const used = new Set(fillColors.map((c) => c.toLowerCase()));

		// The crown's signature colours must all reach the canvas. If slot
		// reuse regresses, the coloured brushes never get selected and these
		// fills collapse to black/white — exactly the bug this guards.
		expect(used.has('#cc0000')).toBe(true); // royal red velvet
		expect(used.has('#f4c316')).toBe(true); // gold frame
		expect(used.has('#990000')).toBe(true); // deep-red shadow
		expect(used.has('#008b01')).toBe(true); // green gemstones

		// And the image must not have collapsed to a grayscale palette: at
		// least a handful of distinct chromatic fills should be present.
		const chromatic = [...used].filter((hex) => {
			const r = parseInt(hex.slice(1, 3), 16);
			const g = parseInt(hex.slice(3, 5), 16);
			const b = parseInt(hex.slice(5, 7), 16);
			return Math.max(r, g, b) - Math.min(r, g, b) > 40;
		});
		expect(chromatic.length).toBeGreaterThanOrEqual(3);
	});
});
