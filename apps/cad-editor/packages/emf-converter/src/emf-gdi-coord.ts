/**
 * GDI coordinate mapping functions for the EMF record replay.
 *
 * The full GDI pipeline is: world transform (EMR_SETWORLDTRANSFORM /
 * EMR_MODIFYWORLDTRANSFORM) → page space → window/viewport (or bounds-based)
 * device mapping. The scale and translation components of the world transform
 * are applied here; the rare skew/rotation components (b, c) cannot be
 * expressed through per-axis scalar mapping and are ignored.
 *
 * Applying the world transform matters in practice: GDI+ writes EMF files
 * whose polygon coordinates are pre-multiplied by 16 with a compensating
 * 0.0625 world-transform scale (sub-pixel precision), so ignoring the
 * transform renders those files 16× too large.
 */

import type { EmfGdiReplayCtx } from './emf-types';

/** Map a logical X coordinate to canvas X. */
export function gmx(r: EmfGdiReplayCtx, x: number): number {
	const wt = r.state.worldTransform;
	const px = wt[0] * x + wt[4];
	if (r.useMappingMode) {
		return (
			((px - r.windowOrg.x) / (r.windowExt.cx || 1)) * (r.viewportExt.cx || 1) + r.viewportOrg.x
		);
	}
	return (px - r.bounds.left) * r.sx;
}

/** Map a logical Y coordinate to canvas Y. */
export function gmy(r: EmfGdiReplayCtx, y: number): number {
	const wt = r.state.worldTransform;
	const py = wt[3] * y + wt[5];
	if (r.useMappingMode) {
		return (
			((py - r.windowOrg.y) / (r.windowExt.cy || 1)) * (r.viewportExt.cy || 1) + r.viewportOrg.y
		);
	}
	return (py - r.bounds.top) * r.sy;
}

/** Map a logical width to canvas width. */
export function gmw(r: EmfGdiReplayCtx, w: number): number {
	const pw = r.state.worldTransform[0] * w;
	if (r.useMappingMode) {
		return (pw / (r.windowExt.cx || 1)) * (r.viewportExt.cx || 1);
	}
	return pw * r.sx;
}

/** Map a logical height to canvas height. */
export function gmh(r: EmfGdiReplayCtx, h: number): number {
	const ph = r.state.worldTransform[3] * h;
	if (r.useMappingMode) {
		return (ph / (r.windowExt.cy || 1)) * (r.viewportExt.cy || 1);
	}
	return ph * r.sy;
}

/** Switch to window/viewport mapping mode. */
export function activateGdiMappingMode(r: EmfGdiReplayCtx): void {
	r.useMappingMode = true;
}
