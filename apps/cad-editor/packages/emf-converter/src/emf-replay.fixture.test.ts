/**
 * End-to-end regression tests driven by real GDI+/GDI EMF files.
 *
 * Both fixtures were produced on Windows by System.Drawing (GDI+), i.e. they
 * use the genuine on-disk record layouts — including the leading
 * EmfPlusGraphicsVersion field in EMF+ objects that synthetic test buffers
 * historically omitted.
 *
 * - `sample-gradient-clip.emf` (EmfPlusOnly): a horizontal red→blue
 *   LinearGradientBrush fill, a white→green PathGradientBrush ellipse fill,
 *   an Exclude clip combination, and an Xor clip combination.
 * - `sample-clip-gdi.emf` (EmfOnly): clip region set + exclude combination
 *   recorded as plain GDI clip records, then fills inside/outside the clip.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { parseEmfHeader, getRenderableEmfBounds } from './emf-header-parser';
import { replayEmfRecords } from './emf-record-replay';

function loadFixture(name: string): DataView {
	const path = fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
	const bytes = readFileSync(path);
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

interface RecordedGradient {
	type: 'linear' | 'radial';
	stops: Array<{ offset: number; color: string }>;
}

/**
 * Mock 2D context recording gradient creation, fill styles at fill time, and
 * clip fill rules — enough to verify gradient + clip behaviour without a real
 * canvas.
 */
function makeRecordingCtx() {
	const gradients: RecordedGradient[] = [];
	const fills: Array<string | RecordedGradient> = [];
	const clipRules: Array<string> = [];
	const makeGradient = (type: 'linear' | 'radial'): RecordedGradient => {
		const grad: RecordedGradient = { type, stops: [] };
		(grad as unknown as Record<string, unknown>).addColorStop = (
			offset: number,
			color: string,
		) => {
			grad.stops.push({ offset, color });
		};
		gradients.push(grad);
		return grad;
	};
	const ctx: Record<string, unknown> = {
		fillStyle: '#000000',
		strokeStyle: '#000000',
		lineWidth: 1,
		font: '12px sans-serif',
		globalCompositeOperation: 'source-over',
		save() {},
		restore() {},
		beginPath() {},
		closePath() {},
		moveTo() {},
		lineTo() {},
		bezierCurveTo() {},
		arc() {},
		arcTo() {},
		ellipse() {},
		rect() {},
		stroke() {},
		strokeRect() {},
		setTransform() {},
		setLineDash() {},
		fillText() {},
		measureText: () => ({ width: 10 }),
		drawImage() {},
		clip(rule?: string) {
			clipRules.push(rule ?? 'nonzero');
		},
		createLinearGradient: () => makeGradient('linear'),
		createRadialGradient: () => makeGradient('radial'),
		fill() {
			fills.push(ctx.fillStyle as string | RecordedGradient);
		},
		fillRect() {
			fills.push(ctx.fillStyle as string | RecordedGradient);
		},
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, gradients, fills, clipRules };
}

function replayFixture(name: string) {
	const view = loadFixture(name);
	const header = parseEmfHeader(view);
	expect(header).not.toBeNull();
	const bounds = getRenderableEmfBounds(header!);
	expect(bounds).not.toBeNull();
	const rec = makeRecordingCtx();
	replayEmfRecords(view, rec.ctx, bounds!, 400, 400);
	return rec;
}

describe('emf-replay fixture: sample-gradient-clip.emf (EMF+ from GDI+)', () => {
	it('renders the linear gradient brush as a CanvasGradient with red→blue stops', () => {
		const { fills } = replayFixture('sample-gradient-clip.emf');
		const gradFills = fills.filter(
			(f): f is RecordedGradient => typeof f === 'object' && f.type === 'linear',
		);
		expect(gradFills.length).toBeGreaterThan(0);
		const colors = gradFills[0].stops.map((s) => s.color);
		expect(colors.some((c) => c.includes('255,0,0'))).toBe(true); // red stop
		expect(colors.some((c) => c.includes('0,0,255'))).toBe(true); // blue stop
	});

	it('renders the path gradient brush as a radial CanvasGradient (white centre → green edge)', () => {
		const { fills } = replayFixture('sample-gradient-clip.emf');
		const radialFills = fills.filter(
			(f): f is RecordedGradient => typeof f === 'object' && f.type === 'radial',
		);
		expect(radialFills.length).toBeGreaterThan(0);
		const stops = radialFills[0].stops;
		expect(stops[0].color).toContain('255,255,255'); // centre = white
		expect(stops[stops.length - 1].color).toContain('128'); // edge = green (0,128,0)
	});

	it('applies the Exclude/Xor clip combinations via even-odd clipping', () => {
		const { clipRules, fills } = replayFixture('sample-gradient-clip.emf');
		// The Exclude combination and the Xor combination both require the
		// even-odd trick; at least one evenodd clip must have been applied.
		expect(clipRules).toContain('evenodd');
		// The orange and purple fills (drawn under those clips) must still land.
		const flat = fills.filter((f): f is string => typeof f === 'string');
		expect(flat.some((c) => c.includes('255,165,0'))).toBe(true); // orange
		expect(flat.some((c) => c.includes('128,0,128'))).toBe(true); // purple
	});
});

describe('emf-replay fixture: sample-clip-gdi.emf (plain GDI records)', () => {
	it('applies clip regions and fills inside/outside them', () => {
		const { fills, clipRules } = replayFixture('sample-clip-gdi.emf');
		// GDI+ records the excluded band as a multi-figure clip path whose hole
		// only exists under the ALTERNATE (even-odd) fill rule.
		expect(clipRules).toContain('evenodd');
		const flat = fills.filter((f): f is string => typeof f === 'string');
		// Teal fill (clipped) and crimson fill (after clip reset) both reach the
		// canvas (GDI brushes resolve to hex colour strings).
		expect(flat.some((c) => c.toLowerCase() === '#008080')).toBe(true); // teal
		expect(flat.some((c) => c.toLowerCase() === '#dc143c')).toBe(true); // crimson
	});
});
