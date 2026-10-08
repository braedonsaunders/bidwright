/**
 * EMF+ Brush object parser.
 *
 * Parses solid, hatch, linear-gradient, and path-gradient brushes
 * (MS-EMFPLUS 2.2.1.1) including gradient colour stops from preset blend
 * colours and blend factors. Gradient brushes carry an
 * {@link EmfPlusGradient} descriptor that the renderer turns into a
 * CanvasGradient; the `color` field always holds the primary colour as a
 * fallback for environments without gradient support.
 *
 * Real GDI+ files prefix the object data with an EmfPlusGraphicsVersion
 * field; the synthetic layout used by earlier versions of this library (and
 * its tests) omits it. Both layouts are accepted by sniffing the metafile
 * signature in the version field.
 */

import { argbToRgba, lerpArgbToRgba } from './emf-color-helpers';
import {
	EMFPLUS_BRUSHTYPE_SOLID,
	EMFPLUS_BRUSHTYPE_HATCHFILL,
	EMFPLUS_BRUSHTYPE_LINEARGRADIENT,
	EMFPLUS_BRUSHTYPE_PATHGRADIENT,
} from './emf-constants';
import { emfLog } from './emf-logging';
import { parseEmfPlusPath } from './emf-plus-path';
import type {
	EmfPlusBrush,
	EmfPlusGradientStop,
	TransformMatrix,
} from './emf-types';

// BrushData flags (MS-EMFPLUS 2.1.2.1)
const BRUSH_DATA_PATH = 0x00000001;
const BRUSH_DATA_TRANSFORM = 0x00000002;
const BRUSH_DATA_PRESET_COLORS = 0x00000004;
const BRUSH_DATA_BLEND_FACTORS_H = 0x00000008;

/** Sanity cap for blend-stop / surrounding-colour / boundary-point counts. */
const MAX_GRADIENT_ELEMENTS = 4096;

/**
 * True when a 32-bit value looks like an EmfPlusGraphicsVersion field
 * (top 20 bits carry the 0xDBC01 metafile signature).
 */
export function looksLikeGraphicsVersion(v: number): boolean {
	return v >>> 12 === 0xdbc01;
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

function readTransform(view: DataView, off: number): TransformMatrix {
	return [
		view.getFloat32(off, true),
		view.getFloat32(off + 4, true),
		view.getFloat32(off + 8, true),
		view.getFloat32(off + 12, true),
		view.getFloat32(off + 16, true),
		view.getFloat32(off + 20, true),
	];
}

function applyMatrix(m: TransformMatrix, x: number, y: number): { x: number; y: number } {
	return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function clamp01(v: number): number {
	return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Normalise stops: clamp offsets, sort ascending. */
function normaliseStops(stops: EmfPlusGradientStop[]): EmfPlusGradientStop[] {
	return stops
		.map((s) => ({ offset: clamp01(s.offset), color: s.color }))
		.sort((a, b) => a.offset - b.offset);
}

/**
 * Read an EmfPlusBlendColors block (preset colour stops): count, positions
 * (float32 × count), colours (ARGB × count). Returns null when out of bounds.
 */
function readPresetColors(
	view: DataView,
	off: number,
	end: number,
): { stops: EmfPlusGradientStop[]; next: number } | null {
	if (off + 4 > end) {
		return null;
	}
	const count = view.getUint32(off, true);
	if (count === 0 || count > MAX_GRADIENT_ELEMENTS) {
		return null;
	}
	const posOff = off + 4;
	const colOff = posOff + count * 4;
	const next = colOff + count * 4;
	if (next > end) {
		return null;
	}
	const stops: EmfPlusGradientStop[] = [];
	for (let i = 0; i < count; i++) {
		stops.push({
			offset: view.getFloat32(posOff + i * 4, true),
			color: argbToRgba(view.getUint32(colOff + i * 4, true)),
		});
	}
	return { stops, next };
}

/**
 * Read an EmfPlusBlendFactors block: count, positions (float32 × count),
 * factors (float32 × count). Returns null when out of bounds.
 */
function readBlendFactors(
	view: DataView,
	off: number,
	end: number,
): { entries: Array<{ pos: number; factor: number }>; next: number } | null {
	if (off + 4 > end) {
		return null;
	}
	const count = view.getUint32(off, true);
	if (count === 0 || count > MAX_GRADIENT_ELEMENTS) {
		return null;
	}
	const posOff = off + 4;
	const facOff = posOff + count * 4;
	const next = facOff + count * 4;
	if (next > end) {
		return null;
	}
	const entries: Array<{ pos: number; factor: number }> = [];
	for (let i = 0; i < count; i++) {
		entries.push({
			pos: view.getFloat32(posOff + i * 4, true),
			factor: view.getFloat32(facOff + i * 4, true),
		});
	}
	return { entries, next };
}

// ---------------------------------------------------------------------------
// Gradient brush data parsers
// ---------------------------------------------------------------------------

/** Parse EmfPlusLinearGradientBrushData (MS-EMFPLUS 2.2.2.24). */
function parseLinearGradient(view: DataView, b: number, end: number): EmfPlusBrush | null {
	if (b + 40 > end) {
		return null;
	}
	const flags = view.getUint32(b, true);
	const rx = view.getFloat32(b + 8, true);
	const ry = view.getFloat32(b + 12, true);
	const rw = view.getFloat32(b + 16, true);
	const rh = view.getFloat32(b + 20, true);
	const startArgb = view.getUint32(b + 24, true);
	const endArgb = view.getUint32(b + 28, true);
	// Reserved1/Reserved2 occupy b+32..b+39; optional data follows.
	let o = b + 40;

	let transform: TransformMatrix | null = null;
	if (flags & BRUSH_DATA_TRANSFORM && o + 24 <= end) {
		transform = readTransform(view, o);
		o += 24;
	}

	let stops: EmfPlusGradientStop[] = [
		{ offset: 0, color: argbToRgba(startArgb) },
		{ offset: 1, color: argbToRgba(endArgb) },
	];
	if (flags & BRUSH_DATA_PRESET_COLORS) {
		const preset = readPresetColors(view, o, end);
		if (preset) {
			stops = preset.stops;
		}
	} else if (flags & BRUSH_DATA_BLEND_FACTORS_H) {
		const blend = readBlendFactors(view, o, end);
		if (blend) {
			stops = blend.entries.map((e) => ({
				offset: e.pos,
				color: lerpArgbToRgba(startArgb, endArgb, e.factor),
			}));
		}
	}

	// The gradient runs across the rect horizontally; direction/rotation is
	// carried by the optional brush transform.
	let p1 = { x: rx, y: ry + rh / 2 };
	let p2 = { x: rx + rw, y: ry + rh / 2 };
	if (transform) {
		p1 = applyMatrix(transform, p1.x, p1.y);
		p2 = applyMatrix(transform, p2.x, p2.y);
	}

	emfLog(
		`parseEmfPlusBrushObject: linear gradient (${p1.x.toFixed(1)},${p1.y.toFixed(1)})→(${p2.x.toFixed(1)},${p2.y.toFixed(1)}), ${stops.length} stop(s)`,
	);
	return {
		kind: 'plus-brush',
		color: argbToRgba(startArgb),
		gradient: {
			type: 'linear',
			x1: p1.x,
			y1: p1.y,
			x2: p2.x,
			y2: p2.y,
			stops: normaliseStops(stops),
		},
	};
}

/** Parse EmfPlusPathGradientBrushData (MS-EMFPLUS 2.2.2.29). */
function parsePathGradient(view: DataView, b: number, end: number): EmfPlusBrush | null {
	if (b + 24 > end) {
		return null;
	}
	const flags = view.getUint32(b, true);
	const centerArgb = view.getUint32(b + 8, true);
	let cx = view.getFloat32(b + 12, true);
	let cy = view.getFloat32(b + 16, true);
	const surroundCount = view.getUint32(b + 20, true);
	if (surroundCount > MAX_GRADIENT_ELEMENTS) {
		return { kind: 'plus-brush', color: argbToRgba(centerArgb) };
	}
	const surround: number[] = [];
	let o = b + 24;
	for (let i = 0; i < surroundCount && o + 4 <= end; i++) {
		surround.push(view.getUint32(o, true));
		o += 4;
	}

	// Boundary: either an embedded path object or an explicit point list.
	let boundaryPts: Array<{ x: number; y: number }> = [];
	if (flags & BRUSH_DATA_PATH) {
		if (o + 4 <= end) {
			const pathSize = view.getInt32(o, true);
			o += 4;
			if (pathSize > 0 && o + pathSize <= end) {
				const path = parseEmfPlusPath(view, o, pathSize);
				if (path) {
					boundaryPts = path.points;
				}
				o += pathSize;
			}
		}
	} else if (o + 4 <= end) {
		const ptCount = view.getUint32(o, true);
		o += 4;
		if (ptCount > 0 && ptCount <= MAX_GRADIENT_ELEMENTS && o + ptCount * 8 <= end) {
			for (let i = 0; i < ptCount; i++) {
				boundaryPts.push({
					x: view.getFloat32(o + i * 8, true),
					y: view.getFloat32(o + i * 8 + 4, true),
				});
			}
			o += ptCount * 8;
		}
	}

	let transform: TransformMatrix | null = null;
	if (flags & BRUSH_DATA_TRANSFORM && o + 24 <= end) {
		transform = readTransform(view, o);
		o += 24;
	}
	if (transform) {
		({ x: cx, y: cy } = applyMatrix(transform, cx, cy));
		boundaryPts = boundaryPts.map((p) => applyMatrix(transform as TransformMatrix, p.x, p.y));
	}

	const surroundArgb = surround.length > 0 ? surround[0] : centerArgb;

	// Colour stops: canvas radial gradients run centre (0) → edge (1); GDI+
	// path-gradient positions run boundary (0) → centre (1), so invert.
	let stops: EmfPlusGradientStop[] = [
		{ offset: 0, color: argbToRgba(centerArgb) },
		{ offset: 1, color: argbToRgba(surroundArgb) },
	];
	if (flags & BRUSH_DATA_PRESET_COLORS) {
		const preset = readPresetColors(view, o, end);
		if (preset) {
			stops = preset.stops.map((s) => ({ offset: 1 - s.offset, color: s.color }));
		}
	} else if (flags & BRUSH_DATA_BLEND_FACTORS_H) {
		const blend = readBlendFactors(view, o, end);
		if (blend) {
			stops = blend.entries.map((e) => ({
				offset: 1 - e.pos,
				color: lerpArgbToRgba(surroundArgb, centerArgb, e.factor),
			}));
		}
	}

	// Radius: farthest boundary point from the centre.
	let r = 0;
	for (const p of boundaryPts) {
		const d = Math.hypot(p.x - cx, p.y - cy);
		if (d > r) {
			r = d;
		}
	}
	if (!(r > 0)) {
		// No usable boundary — fall back to the centre colour.
		return { kind: 'plus-brush', color: argbToRgba(centerArgb) };
	}

	emfLog(
		`parseEmfPlusBrushObject: path gradient centre=(${cx.toFixed(1)},${cy.toFixed(1)}), r=${r.toFixed(1)}, ${stops.length} stop(s)`,
	);
	return {
		kind: 'plus-brush',
		color: argbToRgba(centerArgb),
		gradient: { type: 'radial', cx, cy, r, stops: normaliseStops(stops) },
	};
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse an EMF+ Brush object. Never returns null for structurally valid
 * input — unknown brush types degrade to a solid black brush, matching GDI+
 * fallback behaviour.
 */
export function parseEmfPlusBrushObject(
	view: DataView,
	dataOff: number,
	recDataSize: number,
): EmfPlusBrush | null {
	if (recDataSize < 8) {
		return null;
	}
	const end = dataOff + recDataSize;
	const hasVersion = looksLikeGraphicsVersion(view.getUint32(dataOff, true));
	const typeOff = dataOff + (hasVersion ? 4 : 0);
	if (typeOff + 8 > end) {
		return null;
	}
	const brushType = view.getUint32(typeOff, true);
	const b = typeOff + 4; // start of the type-specific brush data

	switch (brushType) {
		case EMFPLUS_BRUSHTYPE_SOLID:
			return { kind: 'plus-brush', color: argbToRgba(view.getUint32(b, true)) };

		case EMFPLUS_BRUSHTYPE_HATCHFILL:
			// HatchStyle at b, foreground colour at b+4 (background at b+8 unused).
			if (b + 8 <= end) {
				return { kind: 'plus-brush', color: argbToRgba(view.getUint32(b + 4, true)) };
			}
			return { kind: 'plus-brush', color: 'rgba(0,0,0,1)' };

		case EMFPLUS_BRUSHTYPE_LINEARGRADIENT: {
			const brush = parseLinearGradient(view, b, end);
			return brush ?? { kind: 'plus-brush', color: 'rgba(0,0,0,1)' };
		}

		case EMFPLUS_BRUSHTYPE_PATHGRADIENT: {
			const brush = parsePathGradient(view, b, end);
			return brush ?? { kind: 'plus-brush', color: 'rgba(0,0,0,1)' };
		}

		default:
			return { kind: 'plus-brush', color: 'rgba(0,0,0,1)' };
	}
}
