import { describe, it, expect, vi } from 'vitest';

import {
	CLIP_HUGE,
	applyClipShapes,
	combineClip,
	combineClipRegions,
	emptyClipShape,
	infiniteClipShape,
	reapplyClipRegion,
	rectClipShape,
	rectsClipShape,
	translateClipRegion,
	translateClipShape,
	type ClipShape,
} from './emf-clip-region';
import type { CanvasContext } from './emf-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx() {
	const calls: Array<{ fn: string; args: unknown[] }> = [];
	const record =
		(fn: string) =>
		(...args: unknown[]) => {
			calls.push({ fn, args });
		};
	const ctx = {
		save: record('save'),
		restore: record('restore'),
		beginPath: record('beginPath'),
		closePath: record('closePath'),
		rect: record('rect'),
		moveTo: record('moveTo'),
		lineTo: record('lineTo'),
		bezierCurveTo: record('bezierCurveTo'),
		clip: record('clip'),
		setTransform: record('setTransform'),
	};
	return { ctx: ctx as unknown as CanvasContext, calls };
}

const rect = (x = 0, y = 0, w = 10, h = 10) => rectClipShape(x, y, w, h);

// ---------------------------------------------------------------------------
// Shape builders
// ---------------------------------------------------------------------------

describe('clip shape builders', () => {
	it('builds a simple nonzero rect shape', () => {
		const s = rect(1, 2, 3, 4);
		expect(s).toEqual({
			cmds: [{ op: 'rect', x: 1, y: 2, w: 3, h: 4 }],
			fillRule: 'nonzero',
			simple: true,
		});
	});

	it('builds a multi-rect shape that stays simple (disjoint scanline rects)', () => {
		const s = rectsClipShape([
			{ x: 0, y: 0, w: 10, h: 10 },
			{ x: 20, y: 0, w: 10, h: 10 },
		]);
		expect(s.cmds).toHaveLength(2);
		expect(s.simple).toBe(true);
	});

	it('empty and infinite shapes are well-formed', () => {
		expect(emptyClipShape().cmds).toEqual([{ op: 'rect', x: 0, y: 0, w: 0, h: 0 }]);
		const inf = infiniteClipShape();
		expect(inf.cmds[0]).toMatchObject({ op: 'rect', x: -CLIP_HUGE, y: -CLIP_HUGE });
	});
});

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

describe('translateClipShape / translateClipRegion', () => {
	it('translates rect, line, and bezier commands', () => {
		const shape: ClipShape = {
			cmds: [
				{ op: 'rect', x: 1, y: 1, w: 5, h: 5 },
				{ op: 'moveTo', x: 0, y: 0 },
				{ op: 'lineTo', x: 2, y: 3 },
				{
					op: 'bezierCurveTo',
					cp1x: 1,
					cp1y: 1,
					cp2x: 2,
					cp2y: 2,
					x: 3,
					y: 3,
				},
				{ op: 'closePath' },
			],
			fillRule: 'nonzero',
			simple: true,
		};
		const t = translateClipShape(shape, 10, 20);
		expect(t.cmds[0]).toMatchObject({ op: 'rect', x: 11, y: 21 });
		expect(t.cmds[1]).toMatchObject({ op: 'moveTo', x: 10, y: 20 });
		expect(t.cmds[2]).toMatchObject({ op: 'lineTo', x: 12, y: 23 });
		expect(t.cmds[3]).toMatchObject({ cp1x: 11, cp1y: 21, cp2x: 12, cp2y: 22, x: 13, y: 23 });
		expect(t.cmds[4]).toEqual({ op: 'closePath' });
		// Original untouched
		expect(shape.cmds[0]).toMatchObject({ x: 1, y: 1 });
	});

	it('translates every shape of a region and keeps null as null', () => {
		expect(translateClipRegion(null, 5, 5)).toBeNull();
		const region = translateClipRegion([rect(), rect(100, 100)], 1, 2);
		expect(region![0].cmds[0]).toMatchObject({ x: 1, y: 2 });
		expect(region![1].cmds[0]).toMatchObject({ x: 101, y: 102 });
	});
});

// ---------------------------------------------------------------------------
// combineClip
// ---------------------------------------------------------------------------

describe('combineClip', () => {
	it('replace: region becomes exactly the shape', () => {
		const res = combineClip([rect(50, 50)], rect(), 'replace');
		expect(res).toEqual({ region: [rect()], exact: true });
	});

	it('intersect: appends the shape to the list', () => {
		expect(combineClip(null, rect(), 'intersect').region).toEqual([rect()]);
		const res = combineClip([rect()], rect(5, 5), 'intersect');
		expect(res.region).toHaveLength(2);
		expect(res.exact).toBe(true);
	});

	it('exclude: appends an even-odd inversion of the shape', () => {
		const res = combineClip([rect()], rect(2, 2, 4, 4), 'exclude');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(2);
		const inv = res.region![1];
		expect(inv.fillRule).toBe('evenodd');
		// Huge covering rect followed by the excluded shape
		expect(inv.cmds[0]).toMatchObject({ op: 'rect', x: -CLIP_HUGE });
		expect(inv.cmds[1]).toMatchObject({ op: 'rect', x: 2, y: 2 });
	});

	it('exclude on no clip yields ¬shape', () => {
		const res = combineClip(null, rect(), 'exclude');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(1);
		expect(res.region![0].fillRule).toBe('evenodd');
	});

	it('xor of two simple shapes is even-odd over the concatenation (exact)', () => {
		const res = combineClip([rect(0, 0, 10, 10)], rect(5, 0, 10, 10), 'xor');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(1);
		expect(res.region![0].fillRule).toBe('evenodd');
		expect(res.region![0].cmds).toHaveLength(2);
	});

	it('xor on no clip is the inversion of the shape', () => {
		const res = combineClip(null, rect(), 'xor');
		expect(res.exact).toBe(true);
		expect(res.region![0].fillRule).toBe('evenodd');
	});

	it('xor over a complex region falls back to exclude (not exact)', () => {
		const res = combineClip([rect(), rect(1, 1)], rect(5, 5), 'xor');
		expect(res.exact).toBe(false);
		expect(res.region).toHaveLength(3);
		expect(res.region![2].fillRule).toBe('evenodd');
	});

	it('union with no clip stays unclipped; union of simple shapes concatenates nonzero', () => {
		expect(combineClip(null, rect(), 'union')).toEqual({ region: null, exact: true });
		const res = combineClip([rect()], rect(20, 20), 'union');
		expect(res.region).toHaveLength(1);
		expect(res.region![0].fillRule).toBe('nonzero');
		expect(res.region![0].cmds).toHaveLength(2);
	});

	it('union over a complex region keeps the current clip (conservative)', () => {
		const current = [rect(), rect(1, 1)];
		const res = combineClip(current, rect(50, 50), 'union');
		expect(res.region).toBe(current);
		expect(res.exact).toBe(false);
	});

	it('complement: shape minus current', () => {
		const res = combineClip([rect(0, 0, 10, 10)], rect(0, 0, 30, 30), 'complement');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(2);
		expect(res.region![0]).toEqual(rect(0, 0, 30, 30));
		expect(res.region![1].fillRule).toBe('evenodd');
	});

	it('complement of no clip is empty', () => {
		const res = combineClip(null, rect(), 'complement');
		expect(res.region).toEqual([emptyClipShape()]);
	});
});

// ---------------------------------------------------------------------------
// combineClipRegions
// ---------------------------------------------------------------------------

describe('combineClipRegions', () => {
	it('replace returns the incoming region verbatim', () => {
		const incoming = [rect(), rect(1, 1)];
		expect(combineClipRegions([rect(9, 9)], incoming, 'replace')).toEqual({
			region: incoming,
			exact: true,
		});
	});

	it('delegates single-shape incoming regions to combineClip', () => {
		const res = combineClipRegions([rect()], [rect(5, 5)], 'exclude');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(2);
	});

	it('intersect concatenates multi-shape regions exactly', () => {
		const res = combineClipRegions([rect()], [rect(1, 1), rect(2, 2)], 'intersect');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(3);
	});

	it('handles the infinite incoming operand identities', () => {
		expect(combineClipRegions([rect()], null, 'intersect')).toEqual({
			region: [rect()],
			exact: true,
		});
		expect(combineClipRegions([rect()], null, 'union')).toEqual({ region: null, exact: true });
		expect(combineClipRegions([rect()], null, 'exclude').region).toEqual([emptyClipShape()]);
		// xor/complement with infinite reduce to ¬current
		const inv = combineClipRegions([rect()], null, 'xor');
		expect(inv.region![0].fillRule).toBe('evenodd');
		expect(combineClipRegions(null, null, 'complement').region).toEqual([emptyClipShape()]);
	});

	it('complement with multi-shape incoming excludes the current region from it', () => {
		const res = combineClipRegions([rect()], [rect(1, 1), rect(2, 2)], 'complement');
		expect(res.exact).toBe(true);
		expect(res.region).toHaveLength(3);
		expect(res.region![2].fillRule).toBe('evenodd');
	});
});

// ---------------------------------------------------------------------------
// Canvas application
// ---------------------------------------------------------------------------

describe('applyClipShapes / reapplyClipRegion', () => {
	it('replays each shape as beginPath + cmds + clip(fillRule)', () => {
		const { ctx, calls } = makeCtx();
		applyClipShapes(ctx, [rect(), combineClip(null, rect(), 'exclude').region![0]]);
		const clips = calls.filter((c) => c.fn === 'clip');
		expect(clips).toHaveLength(2);
		expect(clips[0].args).toEqual(['nonzero']);
		expect(clips[1].args).toEqual(['evenodd']);
		expect(calls.filter((c) => c.fn === 'beginPath')).toHaveLength(2);
	});

	it('reapplyClipRegion unwinds previous clip saves and opens a single fresh bracket', () => {
		const { ctx, calls } = makeCtx();
		const holder = { ctx, clipSaveDepth: 3 };
		reapplyClipRegion(holder, [rect()]);
		expect(calls.filter((c) => c.fn === 'restore')).toHaveLength(3);
		expect(calls.filter((c) => c.fn === 'save')).toHaveLength(1);
		expect(holder.clipSaveDepth).toBe(1);
	});

	it('reapplyClipRegion with null region just unwinds', () => {
		const { ctx, calls } = makeCtx();
		const holder = { ctx, clipSaveDepth: 2 };
		reapplyClipRegion(holder, null);
		expect(calls.filter((c) => c.fn === 'restore')).toHaveLength(2);
		expect(calls.filter((c) => c.fn === 'save')).toHaveLength(0);
		expect(holder.clipSaveDepth).toBe(0);
	});

	it('resets the transform to identity when requested (device-space shapes)', () => {
		const { ctx, calls } = makeCtx();
		reapplyClipRegion({ ctx, clipSaveDepth: 0 }, [rect()], true);
		const st = calls.find((c) => c.fn === 'setTransform');
		expect(st?.args).toEqual([1, 0, 0, 1, 0, 0]);
	});

	it('survives a ctx whose clip throws', () => {
		const { ctx } = makeCtx();
		(ctx as unknown as Record<string, unknown>).clip = vi.fn(() => {
			throw new Error('boom');
		});
		expect(() => applyClipShapes(ctx, [rect()])).not.toThrow();
	});
});
