/**
 * Clip-region tracking and boolean combination for Canvas 2D.
 *
 * Canvas 2D natively supports only *intersection* clipping (each `ctx.clip()`
 * call intersects the active clip with the current path). GDI and GDI+ however
 * allow the clip region to be combined with Replace, Intersect, Union, Xor,
 * Exclude, and Complement semantics, plus translation (OffsetClipRgn).
 *
 * This module makes those operations possible by tracking the active clip as a
 * list of {@link ClipShape}s — device-space path-command lists that are
 * replayed with `ctx.clip(fillRule)` — instead of relying on the opaque canvas
 * clip state. Two properties of the even-odd fill rule do the heavy lifting:
 *
 * - **Subtraction**: clipping with `[huge covering rect] + [shape]` under the
 *   `'evenodd'` rule keeps everything *except* the shape, so `A − B` becomes
 *   an ordinary intersection with the inverse of `B`.
 * - **Symmetric difference**: concatenating two simple shapes under
 *   `'evenodd'` yields exactly `A XOR B` (points inside both have winding
 *   count 2 and are excluded).
 *
 * Union and Complement are rebuilt from the tracked shape lists. When the
 * current clip is too complex to recombine exactly (e.g. it is already an
 * intersection of several shapes), the operation falls back to the closest
 * conservative approximation and reports `exact: false`.
 *
 * @module emf-clip-region
 */

import type { CanvasContext } from './emf-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded path command in device (canvas pixel) space. */
export type ClipPathCmd =
	| { op: 'rect'; x: number; y: number; w: number; h: number }
	| { op: 'moveTo'; x: number; y: number }
	| { op: 'lineTo'; x: number; y: number }
	| {
			op: 'bezierCurveTo';
			cp1x: number;
			cp1y: number;
			cp2x: number;
			cp2y: number;
			x: number;
			y: number;
	  }
	| { op: 'closePath' };

/**
 * One clip layer: a path (as replayable commands) plus the fill rule to clip
 * with. The active clip region is the intersection of all layers in a list.
 */
export interface ClipShape {
	/** Device-space path commands. */
	cmds: ClipPathCmd[];
	/** Fill rule passed to `ctx.clip()`. */
	fillRule: CanvasFillRule;
	/**
	 * True when the commands form non-overlapping figure(s) filled with the
	 * nonzero rule, i.e. the shape can be safely inverted / composed via the
	 * even-odd trick. Disjoint rectangle lists and typical single closed
	 * figures qualify.
	 */
	simple: boolean;
}

/**
 * The tracked clip region: a list of shapes applied as successive intersecting
 * `ctx.clip()` calls, or `null` for "no clip" (the infinite region).
 */
export type ClipRegion = ClipShape[] | null;

/** Boolean combination operators, matching GDI RGN_* / GDI+ CombineMode. */
export type ClipCombineOp = 'replace' | 'intersect' | 'union' | 'xor' | 'exclude' | 'complement';

/** Result of a clip combination: the new region and whether it is exact. */
export interface ClipCombineResult {
	region: ClipRegion;
	/** False when the op could only be approximated (see module docs). */
	exact: boolean;
}

// ---------------------------------------------------------------------------
// Shape builders
// ---------------------------------------------------------------------------

/**
 * Half-extent of the "covers everything" rectangle used to express shape
 * inversion under the even-odd rule. Far larger than any canvas (max
 * dimension is capped at 8192 by default) yet small enough to stay exact in
 * float32/float64 arithmetic.
 */
export const CLIP_HUGE = 1 << 24; // 16,777,216 px

/** A single-rectangle clip shape. */
export function rectClipShape(x: number, y: number, w: number, h: number): ClipShape {
	return { cmds: [{ op: 'rect', x, y, w, h }], fillRule: 'nonzero', simple: true };
}

/**
 * A clip shape from a list of rectangles. RGNDATA scanline rectangles are
 * pairwise disjoint, so the result remains `simple`.
 */
export function rectsClipShape(
	rects: Array<{ x: number; y: number; w: number; h: number }>,
): ClipShape {
	return {
		cmds: rects.map((r) => ({ op: 'rect', x: r.x, y: r.y, w: r.w, h: r.h }) as ClipPathCmd),
		fillRule: 'nonzero',
		simple: true,
	};
}

/** An empty clip shape (clips everything away). */
export function emptyClipShape(): ClipShape {
	return { cmds: [{ op: 'rect', x: 0, y: 0, w: 0, h: 0 }], fillRule: 'nonzero', simple: true };
}

/** A clip shape covering the entire drawable plane. */
export function infiniteClipShape(): ClipShape {
	return rectClipShape(-CLIP_HUGE, -CLIP_HUGE, 2 * CLIP_HUGE, 2 * CLIP_HUGE);
}

// ---------------------------------------------------------------------------
// Shape transforms
// ---------------------------------------------------------------------------

/** Translate a shape by (dx, dy) device pixels; returns a new shape. */
export function translateClipShape(shape: ClipShape, dx: number, dy: number): ClipShape {
	return {
		...shape,
		cmds: shape.cmds.map((c): ClipPathCmd => {
			switch (c.op) {
				case 'rect':
					return { ...c, x: c.x + dx, y: c.y + dy };
				case 'moveTo':
				case 'lineTo':
					return { ...c, x: c.x + dx, y: c.y + dy };
				case 'bezierCurveTo':
					return {
						...c,
						cp1x: c.cp1x + dx,
						cp1y: c.cp1y + dy,
						cp2x: c.cp2x + dx,
						cp2y: c.cp2y + dy,
						x: c.x + dx,
						y: c.y + dy,
					};
				case 'closePath':
					return c;
			}
		}),
	};
}

/** Translate every shape of a region by (dx, dy); `null` stays `null`. */
export function translateClipRegion(region: ClipRegion, dx: number, dy: number): ClipRegion {
	if (!region) {
		return null;
	}
	return region.map((s) => translateClipShape(s, dx, dy));
}

// ---------------------------------------------------------------------------
// Boolean combination
// ---------------------------------------------------------------------------

/** True when the shape can participate in even-odd inversion/composition. */
function isComposable(shape: ClipShape): boolean {
	return shape.simple && shape.fillRule === 'nonzero';
}

/**
 * The inverse of a simple shape: a huge covering rect concatenated with the
 * shape's own commands, filled even-odd. Points inside the shape gain winding
 * count 2 (excluded); everything else stays included.
 */
function invertClipShape(shape: ClipShape): ClipShape {
	return {
		cmds: [
			{ op: 'rect', x: -CLIP_HUGE, y: -CLIP_HUGE, w: 2 * CLIP_HUGE, h: 2 * CLIP_HUGE },
			...shape.cmds,
		],
		fillRule: 'evenodd',
		simple: false,
	};
}

/**
 * Combine the current clip region with a new shape.
 *
 * Semantics (matching GDI `ExtSelectClipRgn` / GDI+ `CombineMode`):
 * - `replace`    → new = shape
 * - `intersect`  → new = current ∩ shape
 * - `union`      → new = current ∪ shape
 * - `xor`        → new = (current ∪ shape) − (current ∩ shape)
 * - `exclude`    → new = current − shape
 * - `complement` → new = shape − current
 *
 * All ops are exact when the tracked region is at most one composable shape;
 * more complex regions degrade gracefully (see {@link ClipCombineResult}).
 */
export function combineClip(
	current: ClipRegion,
	shape: ClipShape,
	op: ClipCombineOp,
): ClipCombineResult {
	switch (op) {
		case 'replace':
			return { region: [shape], exact: true };

		case 'intersect':
			return { region: current ? [...current, shape] : [shape], exact: true };

		case 'exclude': {
			// current − shape ≡ current ∩ ¬shape
			if (!isComposable(shape)) {
				// Cannot invert a complex shape; approximating with intersection.
				return { region: current ? [...current, shape] : [shape], exact: false };
			}
			const inv = invertClipShape(shape);
			return { region: current ? [...current, inv] : [inv], exact: true };
		}

		case 'union': {
			if (!current) {
				// infinite ∪ anything = infinite
				return { region: null, exact: true };
			}
			if (current.length === 1 && isComposable(current[0]) && isComposable(shape)) {
				// Nonzero winding over concatenated figures approximates the union;
				// figures wound in opposite directions could cancel, hence not exact.
				return {
					region: [
						{ cmds: [...current[0].cmds, ...shape.cmds], fillRule: 'nonzero', simple: false },
					],
					exact: false,
				};
			}
			// The union is a superset of the current clip; keeping the current clip
			// unchanged is the closest conservative approximation.
			return { region: current, exact: false };
		}

		case 'xor': {
			if (!current) {
				// infinite XOR shape = ¬shape
				if (isComposable(shape)) {
					return { region: [invertClipShape(shape)], exact: true };
				}
				return { region: [shape], exact: false };
			}
			if (current.length === 1 && isComposable(current[0]) && isComposable(shape)) {
				// Even-odd over the concatenation is exactly the symmetric difference.
				return {
					region: [
						{ cmds: [...current[0].cmds, ...shape.cmds], fillRule: 'evenodd', simple: false },
					],
					exact: true,
				};
			}
			// Fall back to current − shape, a subset of the true XOR.
			if (isComposable(shape)) {
				return { region: [...current, invertClipShape(shape)], exact: false };
			}
			return { region: [...current, shape], exact: false };
		}

		case 'complement': {
			// shape − current
			if (!current) {
				// shape − infinite = empty
				return { region: [emptyClipShape()], exact: true };
			}
			if (current.length === 1 && isComposable(current[0])) {
				return { region: [shape, invertClipShape(current[0])], exact: true };
			}
			// Fall back to replacing with the new shape (superset of the result).
			return { region: [shape], exact: false };
		}
	}
}

/**
 * Combine two full regions (each an intersection list or `null` = infinite).
 *
 * Delegates to {@link combineClip} when the incoming region is a single
 * shape; multi-shape incoming regions are handled exactly for `replace` /
 * `intersect` (and several infinite-operand identities) and degrade to a
 * conservative approximation otherwise.
 */
export function combineClipRegions(
	current: ClipRegion,
	incoming: ClipRegion,
	op: ClipCombineOp,
): ClipCombineResult {
	if (op === 'replace') {
		return { region: incoming, exact: true };
	}
	if (incoming && incoming.length === 1) {
		return combineClip(current, incoming[0], op);
	}

	if (!incoming) {
		// Incoming operand is the infinite region.
		switch (op) {
			case 'intersect':
				return { region: current, exact: true };
			case 'union':
				return { region: null, exact: true };
			case 'exclude':
				// current − infinite = empty
				return { region: [emptyClipShape()], exact: true };
			case 'xor':
			case 'complement': {
				// Both reduce to ¬current (infinite − current / symmetric difference).
				if (!current) {
					return { region: [emptyClipShape()], exact: true };
				}
				if (current.length === 1) {
					return combineClip(null, current[0], 'exclude');
				}
				return { region: current, exact: false };
			}
		}
	}

	// Incoming region is an intersection of two or more shapes.
	switch (op) {
		case 'intersect':
			return { region: current ? [...current, ...incoming] : incoming, exact: true };
		case 'union':
			// Union is a superset of the current clip; keep the current clip.
			return { region: current, exact: false };
		case 'xor':
			return { region: current ?? incoming, exact: false };
		case 'exclude':
			return { region: current, exact: false };
		case 'complement': {
			// incoming − current ≡ incoming ∩ ¬current
			if (!current) {
				return { region: [emptyClipShape()], exact: true };
			}
			if (current.length === 1) {
				return combineClip(incoming, current[0], 'exclude');
			}
			return { region: incoming, exact: false };
		}
	}
}

// ---------------------------------------------------------------------------
// Canvas application
// ---------------------------------------------------------------------------

/** Replay recorded path commands onto a canvas context (no beginPath). */
export function replayClipCmds(ctx: CanvasContext, cmds: ClipPathCmd[]): void {
	for (const c of cmds) {
		switch (c.op) {
			case 'rect':
				ctx.rect(c.x, c.y, c.w, c.h);
				break;
			case 'moveTo':
				ctx.moveTo(c.x, c.y);
				break;
			case 'lineTo':
				ctx.lineTo(c.x, c.y);
				break;
			case 'bezierCurveTo':
				ctx.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, c.x, c.y);
				break;
			case 'closePath':
				ctx.closePath();
				break;
		}
	}
}

/**
 * Apply every shape of a region as successive `ctx.clip()` calls.
 * The caller is responsible for the surrounding `ctx.save()` bracket.
 */
export function applyClipShapes(ctx: CanvasContext, shapes: ClipShape[]): void {
	for (const s of shapes) {
		ctx.beginPath();
		replayClipCmds(ctx, s.cmds);
		try {
			ctx.clip(s.fillRule);
		} catch {
			/* ignore clip errors (e.g. degenerate paths) */
		}
	}
}

/**
 * Rebuild the canvas clip state from a tracked region.
 *
 * Unwinds every save made for clipping (restoring the pre-clip canvas state),
 * then — when a region is active — opens a single fresh save bracket and
 * replays all clip shapes into it. Contexts that never touch clipping keep a
 * `clipSaveDepth` of 0 and are unaffected.
 */
export function reapplyClipRegion(
	holder: { ctx: CanvasContext; clipSaveDepth: number },
	region: ClipRegion,
	identityTransform = false,
): void {
	const { ctx } = holder;
	while (holder.clipSaveDepth > 0) {
		ctx.restore();
		holder.clipSaveDepth--;
	}
	if (region) {
		ctx.save();
		holder.clipSaveDepth = 1;
		if (identityTransform) {
			// Clip shapes are recorded in device space; neutralise any active
			// world transform so they clip where they were recorded.
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		}
		applyClipShapes(ctx, region);
	}
}
