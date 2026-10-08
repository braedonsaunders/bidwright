/**
 * EMF+ state / transform / save / restore / clip record handlers.
 *
 * Also exports shared utility functions used by other handler modules.
 */

import {
	combineClipRegions,
	emptyClipShape,
	reapplyClipRegion,
	translateClipRegion,
	type ClipCombineOp,
	type ClipCombineResult,
	type ClipPathCmd,
	type ClipRegion,
	type ClipShape,
} from './emf-clip-region';
import { argbToRgba } from './emf-color-helpers';
import {
	EMFPLUS_SETWORLDTRANSFORM,
	EMFPLUS_RESETWORLDTRANSFORM,
	EMFPLUS_MULTIPLYWORLDTRANSFORM,
	EMFPLUS_TRANSLATEWORLDTRANSFORM,
	EMFPLUS_SCALEWORLDTRANSFORM,
	EMFPLUS_ROTATEWORLDTRANSFORM,
	EMFPLUS_SAVE,
	EMFPLUS_RESTORE,
	EMFPLUS_SETCLIPRECT,
	EMFPLUS_RESETCLIP,
	EMFPLUS_BEGINCONTAINERNOPARAMS,
	EMFPLUS_ENDCONTAINER,
	EMFPLUS_SETPAGETRANSFORM,
	EMFPLUS_SETANTIALIASMODE,
	EMFPLUS_SETTEXTRENDERINGHINT,
	EMFPLUS_SETINTERPOLATIONMODE,
	EMFPLUS_SETPIXELOFFSETMODE,
	EMFPLUS_SETCOMPOSITINGQUALITY,
	EMFPLUS_SETCLIPREGION,
	EMFPLUS_SETCLIPPATH,
	EMFPLUS_OFFSETCLIP,
} from './emf-constants';
import { emfLog, emfWarn } from './emf-logging';
import { emfPlusPathToClipCmds } from './emf-plus-path';
import type {
	EmfPlusGradient,
	EmfPlusRegionNode,
	EmfPlusReplayCtx,
	TransformMatrix,
} from './emf-types';

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Multiply two affine matrices [a,b,c,d,e,f]. */
export function multiplyMatrix(m1: TransformMatrix, m2: TransformMatrix): TransformMatrix {
	return [
		m1[0] * m2[0] + m1[1] * m2[2],
		m1[0] * m2[1] + m1[1] * m2[3],
		m1[2] * m2[0] + m1[3] * m2[2],
		m1[2] * m2[1] + m1[3] * m2[3],
		m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
		m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
	];
}

/** Resolve a brush (either inline ARGB colour or object-table ref). */
export function resolveBrushColor(
	rCtx: EmfPlusReplayCtx,
	flags: number,
	brushIdOrColor: number,
): string {
	if (flags & 0x8000) {
		return argbToRgba(brushIdOrColor);
	}
	const obj = rCtx.objectTable.get(brushIdOrColor & 0xff);
	if (obj && obj.kind === 'plus-brush') {
		return obj.color;
	}
	return 'rgba(0,0,0,1)';
}

/**
 * Build a CanvasGradient from a parsed EMF+ gradient descriptor. Returns
 * null when the context lacks gradient support (e.g. test stubs) or the
 * geometry is degenerate, in which case callers fall back to the flat colour.
 */
function createBrushGradient(rCtx: EmfPlusReplayCtx, grad: EmfPlusGradient): CanvasGradient | null {
	const ctx = rCtx.ctx;
	try {
		let g: CanvasGradient | null = null;
		if (grad.type === 'linear' && typeof ctx.createLinearGradient === 'function') {
			if (grad.x1 === grad.x2 && grad.y1 === grad.y2) {
				return null;
			}
			g = ctx.createLinearGradient(grad.x1, grad.y1, grad.x2, grad.y2);
		} else if (grad.type === 'radial' && typeof ctx.createRadialGradient === 'function') {
			if (!(grad.r > 0)) {
				return null;
			}
			g = ctx.createRadialGradient(grad.cx, grad.cy, 0, grad.cx, grad.cy, grad.r);
		}
		if (!g) {
			return null;
		}
		for (const stop of grad.stops) {
			g.addColorStop(stop.offset, stop.color);
		}
		return g;
	} catch {
		return null;
	}
}

/**
 * Resolve a brush to a canvas paint style: an inline ARGB colour, a solid
 * brush colour, or a CanvasGradient for linear/path gradient brushes.
 * Gradient geometry is defined in brush (world) space — the same space fills
 * execute in after {@link applyPlusWorldTransform} — so the gradient can be
 * assigned directly to `fillStyle`.
 */
export function resolveBrushPaint(
	rCtx: EmfPlusReplayCtx,
	flags: number,
	brushIdOrColor: number,
): string | CanvasGradient {
	if (flags & 0x8000) {
		return argbToRgba(brushIdOrColor);
	}
	const obj = rCtx.objectTable.get(brushIdOrColor & 0xff);
	if (obj && obj.kind === 'plus-brush') {
		if (obj.gradient) {
			const g = createBrushGradient(rCtx, obj.gradient);
			if (g) {
				return g;
			}
		}
		return obj.color;
	}
	return 'rgba(0,0,0,1)';
}

/**
 * Compute the multiplier that converts from the current page unit to pixels
 * (assuming a 96 DPI canvas), scaled by the page scale factor.
 */
export function getPageUnitMultiplier(pageUnit: number, pageScale: number): number {
	const DPI = 96;
	let unitToPixel: number;
	switch (pageUnit) {
		case 3:
			unitToPixel = DPI / 72;
			break; // Point
		case 4:
			unitToPixel = DPI;
			break; // Inch
		case 5:
			unitToPixel = DPI / 300;
			break; // Document
		case 6:
			unitToPixel = DPI / 25.4;
			break; // Millimeter
		default:
			unitToPixel = 1;
			break; // World, Display, Pixel
	}
	return unitToPixel * pageScale;
}

/** Apply the current EMF+ world transform to the canvas, incorporating page units and DPI scale. */
export function applyPlusWorldTransform(rCtx: EmfPlusReplayCtx): void {
	const wt = rCtx.worldTransform;
	const m = getPageUnitMultiplier(rCtx.pageUnit, rCtx.pageScale);
	const d = rCtx.dpiScale;
	rCtx.ctx.setTransform(
		wt[0] * m * d,
		wt[1] * m * d,
		wt[2] * m * d,
		wt[3] * m * d,
		wt[4] * m * d,
		wt[5] * m * d,
	);
}

// ---------------------------------------------------------------------------
// Internal helper: save/restore logic shared between Save/Container ops
// ---------------------------------------------------------------------------

function pushState(rCtx: EmfPlusReplayCtx, stackId: number): void {
	rCtx.saveStack.push({
		transform: [...rCtx.worldTransform] as TransformMatrix,
	});
	rCtx.saveIdMap.set(stackId, rCtx.saveStack.length - 1);
}

function popState(rCtx: EmfPlusReplayCtx, stackId: number): void {
	const idx = rCtx.saveIdMap.get(stackId);
	if (idx !== undefined && idx < rCtx.saveStack.length) {
		rCtx.worldTransform = [...rCtx.saveStack[idx].transform] as TransformMatrix;
		rCtx.saveStack.length = idx;
		const newMap = new Map<number, number>();
		for (const [k, v] of rCtx.saveIdMap) {
			if (v < idx) {
				newMap.set(k, v);
			}
		}
		rCtx.saveIdMap = newMap;
	}
}

// ---------------------------------------------------------------------------
// Clip tracking (full CombineMode support via emf-clip-region)
// ---------------------------------------------------------------------------

/**
 * The effective device matrix for EMF+ drawing: world transform × page-unit
 * multiplier × DPI scale — the same matrix {@link applyPlusWorldTransform}
 * installs on the canvas. Clip shapes are recorded in this (device) space so
 * they survive later transform changes, exactly like a native canvas clip.
 */
function plusDeviceMatrix(rCtx: EmfPlusReplayCtx): TransformMatrix {
	const wt = rCtx.worldTransform;
	const s = getPageUnitMultiplier(rCtx.pageUnit, rCtx.pageScale) * rCtx.dpiScale;
	return [wt[0] * s, wt[1] * s, wt[2] * s, wt[3] * s, wt[4] * s, wt[5] * s];
}

/** Build a device-space polygon shape from a world-space rectangle. */
function transformedRectShape(
	x: number,
	y: number,
	w: number,
	h: number,
	m: TransformMatrix,
): ClipShape {
	const tx = (px: number, py: number) => m[0] * px + m[2] * py + m[4];
	const ty = (px: number, py: number) => m[1] * px + m[3] * py + m[5];
	const cmds: ClipPathCmd[] = [
		{ op: 'moveTo', x: tx(x, y), y: ty(x, y) },
		{ op: 'lineTo', x: tx(x + w, y), y: ty(x + w, y) },
		{ op: 'lineTo', x: tx(x + w, y + h), y: ty(x + w, y + h) },
		{ op: 'lineTo', x: tx(x, y + h), y: ty(x, y + h) },
		{ op: 'closePath' },
	];
	return { cmds, fillRule: 'nonzero', simple: true };
}

/** Build a device-space clip shape from an EMF+ path object. */
function pathClipShape(path: EmfPlusRegionNode & { type: 'path' }, m: TransformMatrix): ClipShape {
	return { cmds: emfPlusPathToClipCmds(path.path, m), fillRule: 'nonzero', simple: true };
}

/** RegionNodeDataType (MS-EMFPLUS 2.1.1.27) → boolean combine op. */
const REGION_NODE_OPS: Record<number, ClipCombineOp> = {
	0: 'intersect', // legacy/lenient: treat 0 as And
	1: 'intersect', // RegionNodeDataTypeAnd
	2: 'union', // RegionNodeDataTypeOr
	3: 'xor', // RegionNodeDataTypeXor
	4: 'exclude', // RegionNodeDataTypeExclude
	5: 'complement', // RegionNodeDataTypeComplement
};

const MAX_REGION_FLATTEN_DEPTH = 64;

/**
 * Flatten an EMF+ region node tree into a tracked clip region (a list of
 * intersecting shapes, or `null` for the infinite region). Boolean combine
 * nodes are resolved through {@link combineClipRegions}; combinations that
 * cannot be expressed exactly set `exact: false`.
 */
export function flattenRegionNode(
	node: EmfPlusRegionNode,
	m: TransformMatrix,
	depth: number = 0,
): ClipCombineResult {
	if (depth > MAX_REGION_FLATTEN_DEPTH) {
		emfWarn(`flattenRegionNode: depth limit (${MAX_REGION_FLATTEN_DEPTH}) exceeded`);
		return { region: [emptyClipShape()], exact: false };
	}
	switch (node.type) {
		case 'rect':
			return { region: [transformedRectShape(node.x, node.y, node.width, node.height, m)], exact: true };
		case 'path':
			return { region: [pathClipShape(node, m)], exact: true };
		case 'infinite':
			return { region: null, exact: true };
		case 'empty':
			return { region: [emptyClipShape()], exact: true };
		case 'combine': {
			const left = flattenRegionNode(node.left, m, depth + 1);
			const right = flattenRegionNode(node.right, m, depth + 1);
			const op = REGION_NODE_OPS[node.combineMode] ?? 'intersect';
			const combined = combineClipRegions(left.region, right.region, op);
			return { region: combined.region, exact: combined.exact && left.exact && right.exact };
		}
	}
}

/** SetClip* CombineMode (MS-EMFPLUS 2.1.1.4) → boolean combine op. */
const PLUS_COMBINE_OPS: Record<number, ClipCombineOp> = {
	0: 'replace',
	1: 'intersect',
	2: 'union',
	3: 'xor',
	4: 'exclude',
	5: 'complement',
};

/** Rebuild the canvas clip from the tracked EMF+ clip region. */
function reapplyPlusClip(rCtx: EmfPlusReplayCtx): void {
	reapplyClipRegion(rCtx, rCtx.clipRegion ?? null, true);
}

/**
 * Combine the tracked clip with an incoming region per the CombineMode and
 * rebuild the canvas clip state.
 */
function applyPlusClipRegion(
	rCtx: EmfPlusReplayCtx,
	incoming: ClipRegion,
	combineMode: number,
	opName: string,
): void {
	const op = PLUS_COMBINE_OPS[combineMode];
	if (!op) {
		emfWarn(`${opName}: unknown CombineMode ${combineMode}, falling back to Intersect`);
	}
	const res = combineClipRegions(rCtx.clipRegion ?? null, incoming, op ?? 'intersect');
	if (!res.exact) {
		emfWarn(`${opName}: CombineMode ${combineMode} approximated (region too complex)`);
	}
	rCtx.clipRegion = res.region;
	reapplyPlusClip(rCtx);
}

/** Convenience wrapper for single-shape clip records (SetClipRect/SetClipPath). */
function applyPlusClipShape(
	rCtx: EmfPlusReplayCtx,
	shape: ClipShape,
	combineMode: number,
	opName: string,
): void {
	applyPlusClipRegion(rCtx, [shape], combineMode, opName);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleEmfPlusStateRecord(
	rCtx: EmfPlusReplayCtx,
	recType: number,
	recFlags: number,
	dataOff: number,
	recDataSize: number,
): boolean {
	const { view } = rCtx;

	switch (recType) {
		// ---- transforms ----
		case EMFPLUS_SETWORLDTRANSFORM: {
			if (recDataSize >= 24) {
				rCtx.worldTransform = [
					view.getFloat32(dataOff, true),
					view.getFloat32(dataOff + 4, true),
					view.getFloat32(dataOff + 8, true),
					view.getFloat32(dataOff + 12, true),
					view.getFloat32(dataOff + 16, true),
					view.getFloat32(dataOff + 20, true),
				];
			}
			return true;
		}

		case EMFPLUS_RESETWORLDTRANSFORM: {
			rCtx.worldTransform = [1, 0, 0, 1, 0, 0];
			return true;
		}

		case EMFPLUS_MULTIPLYWORLDTRANSFORM: {
			if (recDataSize >= 24) {
				const xf: TransformMatrix = [
					view.getFloat32(dataOff, true),
					view.getFloat32(dataOff + 4, true),
					view.getFloat32(dataOff + 8, true),
					view.getFloat32(dataOff + 12, true),
					view.getFloat32(dataOff + 16, true),
					view.getFloat32(dataOff + 20, true),
				];
				if (recFlags & 0x2000) {
					rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
				} else {
					rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
				}
			}
			return true;
		}

		case EMFPLUS_TRANSLATEWORLDTRANSFORM: {
			if (recDataSize >= 8) {
				const dx = view.getFloat32(dataOff, true);
				const dy = view.getFloat32(dataOff + 4, true);
				const xf: TransformMatrix = [1, 0, 0, 1, dx, dy];
				if (recFlags & 0x2000) {
					rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
				} else {
					rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
				}
			}
			return true;
		}

		case EMFPLUS_SCALEWORLDTRANSFORM: {
			if (recDataSize >= 8) {
				const sx = view.getFloat32(dataOff, true);
				const sy = view.getFloat32(dataOff + 4, true);
				const xf: TransformMatrix = [sx, 0, 0, sy, 0, 0];
				if (recFlags & 0x2000) {
					rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
				} else {
					rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
				}
			}
			return true;
		}

		case EMFPLUS_ROTATEWORLDTRANSFORM: {
			if (recDataSize >= 4) {
				const angle = (view.getFloat32(dataOff, true) * Math.PI) / 180;
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				const xf: TransformMatrix = [cos, sin, -sin, cos, 0, 0];
				if (recFlags & 0x2000) {
					rCtx.worldTransform = multiplyMatrix(rCtx.worldTransform, xf);
				} else {
					rCtx.worldTransform = multiplyMatrix(xf, rCtx.worldTransform);
				}
			}
			return true;
		}

		// ---- save / restore ----
		case EMFPLUS_SAVE: {
			if (recDataSize >= 4) {
				pushState(rCtx, view.getUint32(dataOff, true));
			}
			return true;
		}

		case EMFPLUS_RESTORE: {
			if (recDataSize >= 4) {
				popState(rCtx, view.getUint32(dataOff, true));
			}
			return true;
		}

		// ---- clipping ----
		case EMFPLUS_SETCLIPRECT: {
			if (recDataSize >= 16) {
				const combineMode = (recFlags >> 8) & 0x0f;
				const cx = view.getFloat32(dataOff, true);
				const cy = view.getFloat32(dataOff + 4, true);
				const cw = view.getFloat32(dataOff + 8, true);
				const ch = view.getFloat32(dataOff + 12, true);
				const shape = transformedRectShape(cx, cy, cw, ch, plusDeviceMatrix(rCtx));
				applyPlusClipShape(rCtx, shape, combineMode, 'SetClipRect');
			}
			return true;
		}

		case EMFPLUS_RESETCLIP: {
			rCtx.clipRegion = null;
			reapplyPlusClip(rCtx);
			emfLog('ResetClip: clip region cleared');
			return true;
		}

		case EMFPLUS_SETCLIPREGION: {
			const regionId = recFlags & 0xff;
			const combineMode = (recFlags >> 8) & 0x0f;
			const regionObj = rCtx.objectTable.get(regionId);
			if (regionObj && regionObj.kind === 'plus-region' && regionObj.nodes.length > 0) {
				const flattened = flattenRegionNode(regionObj.nodes[0], plusDeviceMatrix(rCtx));
				if (!flattened.exact) {
					emfWarn('SetClipRegion: region tree approximated (unsupported boolean combination)');
				}
				applyPlusClipRegion(rCtx, flattened.region, combineMode, 'SetClipRegion');
			}
			return true;
		}

		case EMFPLUS_SETCLIPPATH: {
			const pathId = recFlags & 0xff;
			const combineMode = (recFlags >> 8) & 0x0f;
			const pathObj = rCtx.objectTable.get(pathId);
			if (pathObj && pathObj.kind === 'plus-path') {
				const shape: ClipShape = {
					cmds: emfPlusPathToClipCmds(pathObj, plusDeviceMatrix(rCtx)),
					fillRule: 'nonzero',
					simple: true,
				};
				applyPlusClipShape(rCtx, shape, combineMode, 'SetClipPath');
			}
			return true;
		}

		case EMFPLUS_OFFSETCLIP: {
			if (recDataSize >= 8) {
				const dx = view.getFloat32(dataOff, true);
				const dy = view.getFloat32(dataOff + 4, true);
				if (rCtx.clipRegion) {
					// The offset is specified in world units; convert to a device
					// delta via the linear part of the effective matrix.
					const m = plusDeviceMatrix(rCtx);
					const ddx = m[0] * dx + m[2] * dy;
					const ddy = m[1] * dx + m[3] * dy;
					rCtx.clipRegion = translateClipRegion(rCtx.clipRegion, ddx, ddy);
					reapplyPlusClip(rCtx);
					emfLog(`OffsetClip: clip translated by world (${dx},${dy}) → device (${ddx},${ddy})`);
				} else {
					emfLog(`OffsetClip: dx=${dx}, dy=${dy} — no active clip, nothing to offset`);
				}
			}
			return true;
		}

		// ---- containers ----
		case EMFPLUS_BEGINCONTAINERNOPARAMS: {
			if (recDataSize >= 4) {
				pushState(rCtx, view.getUint32(dataOff, true));
			}
			return true;
		}

		case EMFPLUS_ENDCONTAINER: {
			if (recDataSize >= 4) {
				popState(rCtx, view.getUint32(dataOff, true));
			}
			return true;
		}

		// ---- page transform ----
		case EMFPLUS_SETPAGETRANSFORM: {
			const pageUnit = recFlags & 0xff;
			const pageScale = recDataSize >= 4 ? view.getFloat32(dataOff, true) : 1;
			rCtx.pageUnit = pageUnit;
			rCtx.pageScale = pageScale;
			const UNIT_NAMES: Record<number, string> = {
				0: 'World',
				1: 'Display',
				2: 'Pixel',
				3: 'Point',
				4: 'Inch',
				5: 'Document',
				6: 'Millimeter',
			};
			emfLog(`SetPageTransform: unit=${UNIT_NAMES[pageUnit] ?? pageUnit}, scale=${pageScale}`);
			return true;
		}

		// ---- rendering hints (accepted, ignored) ----
		case EMFPLUS_SETANTIALIASMODE:
		case EMFPLUS_SETTEXTRENDERINGHINT:
		case EMFPLUS_SETINTERPOLATIONMODE:
		case EMFPLUS_SETPIXELOFFSETMODE:
		case EMFPLUS_SETCOMPOSITINGQUALITY:
			return true;

		default:
			return false;
	}
}
