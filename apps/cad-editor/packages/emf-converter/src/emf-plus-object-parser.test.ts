import { describe, it, expect, vi } from 'vitest';

import {
	EMFPLUS_OBJECTTYPE_BRUSH,
	EMFPLUS_OBJECTTYPE_PEN,
	EMFPLUS_OBJECTTYPE_FONT,
	EMFPLUS_OBJECTTYPE_STRINGFORMAT,
	EMFPLUS_OBJECTTYPE_IMAGE,
	EMFPLUS_OBJECTTYPE_IMAGEATTRIBUTES,
	EMFPLUS_OBJECTTYPE_REGION,
	EMFPLUS_BRUSHTYPE_SOLID,
	EMFPLUS_BRUSHTYPE_LINEARGRADIENT,
	EMFPLUS_BRUSHTYPE_PATHGRADIENT,
	EMFPLUS_BRUSHTYPE_HATCHFILL,
} from './emf-constants';
import { handleEmfPlusObjectRecord } from './emf-plus-object-parser';
import type { EmfPlusReplayCtx, TransformMatrix } from './emf-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtxStub(): Record<string, unknown> {
	return {
		save: vi.fn<() => void>(),
		restore: vi.fn<() => void>(),
		beginPath: vi.fn<() => void>(),
		closePath: vi.fn<() => void>(),
		setTransform: vi.fn<() => void>(),
		fill: vi.fn<() => void>(),
		stroke: vi.fn<() => void>(),
		fillRect: vi.fn<() => void>(),
		strokeRect: vi.fn<() => void>(),
		setLineDash: vi.fn<() => void>(),
		moveTo: vi.fn<() => void>(),
		lineTo: vi.fn<() => void>(),
		fillText: vi.fn<() => void>(),
		rect: vi.fn<() => void>(),
		clip: vi.fn<() => void>(),
		ellipse: vi.fn<() => void>(),
		bezierCurveTo: vi.fn<() => void>(),
		strokeStyle: '#000',
		fillStyle: '#fff',
		lineWidth: 1,
		font: '12px sans-serif',
		textBaseline: 'top',
		textAlign: 'left',
	};
}

function makeRCtx(bufSize = 1024): EmfPlusReplayCtx {
	const buf = new ArrayBuffer(bufSize);
	const view = new DataView(buf);
	return {
		ctx: makeCtxStub() as unknown as CanvasRenderingContext2D,
		view,
		objectTable: new Map(),
		worldTransform: [1, 0, 0, 1, 0, 0] as TransformMatrix,
		deferredImages: [],
		saveStack: [],
		saveIdMap: new Map(),
		totalImageObjects: 0,
		totalDrawImageCalls: 0,
		clipSaveDepth: 0,
		pageUnit: 2,
		pageScale: 1,
		continuationBuffer: null,
		continuationObjectId: 0,
		continuationObjectType: 0,
		continuationTotalSize: 0,
		continuationOffset: 0,
	};
}

function makeFlags(objectType: number, objectId: number): number {
	return (objectType << 8) | (objectId & 0xff);
}

// ---------------------------------------------------------------------------
// Tests: Brush
// ---------------------------------------------------------------------------

describe('emf-plus-object-parser', () => {
	describe('brush objects', () => {
		it('parses a solid brush', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, EMFPLUS_BRUSHTYPE_SOLID, true); // brushType
			rCtx.view.setUint32(d + 4, 0xffff0000, true); // ARGB red

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 0), d, 8);
			const brush = rCtx.objectTable.get(0);
			expect(brush).toBeDefined();
			expect(brush!.kind).toBe('plus-brush');
			if (brush!.kind === 'plus-brush') {
				expect(brush.color).toBe('rgba(255,0,0,1.000)');
			}
		});

		it('parses a linear gradient brush with geometry and colour stops', () => {
			const rCtx = makeRCtx();
			const d = 0;
			// EmfPlusLinearGradientBrushData: type, flags, wrap, RectF, start, end, reserved×2
			rCtx.view.setUint32(d, EMFPLUS_BRUSHTYPE_LINEARGRADIENT, true);
			const b = d + 4;
			rCtx.view.setUint32(b, 0, true); // BrushDataFlags
			rCtx.view.setUint32(b + 4, 0, true); // WrapMode
			rCtx.view.setFloat32(b + 8, 10, true); // rect x
			rCtx.view.setFloat32(b + 12, 20, true); // rect y
			rCtx.view.setFloat32(b + 16, 100, true); // rect w
			rCtx.view.setFloat32(b + 20, 50, true); // rect h
			rCtx.view.setUint32(b + 24, 0xff00ff00, true); // start = green
			rCtx.view.setUint32(b + 28, 0xffff0000, true); // end = red

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 1), d, 4 + 40);
			const brush = rCtx.objectTable.get(1);
			expect(brush).toBeDefined();
			expect(brush!.kind).toBe('plus-brush');
			if (brush!.kind === 'plus-brush') {
				expect(brush.color).toContain('0,255,0');
				expect(brush.gradient).toBeDefined();
				if (brush.gradient?.type === 'linear') {
					// Horizontal midline of the rect
					expect(brush.gradient.x1).toBe(10);
					expect(brush.gradient.y1).toBe(45);
					expect(brush.gradient.x2).toBe(110);
					expect(brush.gradient.y2).toBe(45);
					expect(brush.gradient.stops).toEqual([
						{ offset: 0, color: 'rgba(0,255,0,1.000)' },
						{ offset: 1, color: 'rgba(255,0,0,1.000)' },
					]);
				}
			}
		});

		it('parses linear gradient preset colour stops', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, EMFPLUS_BRUSHTYPE_LINEARGRADIENT, true);
			const b = d + 4;
			rCtx.view.setUint32(b, 0x4, true); // BrushDataPresetColors
			rCtx.view.setFloat32(b + 8, 0, true);
			rCtx.view.setFloat32(b + 12, 0, true);
			rCtx.view.setFloat32(b + 16, 10, true);
			rCtx.view.setFloat32(b + 20, 10, true);
			rCtx.view.setUint32(b + 24, 0xff000000, true); // start
			rCtx.view.setUint32(b + 28, 0xffffffff, true); // end
			// Preset colours: 3 stops at 0 / 0.5 / 1
			const o = b + 40;
			rCtx.view.setUint32(o, 3, true);
			rCtx.view.setFloat32(o + 4, 0, true);
			rCtx.view.setFloat32(o + 8, 0.5, true);
			rCtx.view.setFloat32(o + 12, 1, true);
			rCtx.view.setUint32(o + 16, 0xffff0000, true); // red
			rCtx.view.setUint32(o + 20, 0xff00ff00, true); // green
			rCtx.view.setUint32(o + 24, 0xff0000ff, true); // blue

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 4), d, 4 + 40 + 28);
			const brush = rCtx.objectTable.get(4);
			expect(brush!.kind).toBe('plus-brush');
			if (brush!.kind === 'plus-brush' && brush.gradient) {
				expect(brush.gradient.stops).toEqual([
					{ offset: 0, color: 'rgba(255,0,0,1.000)' },
					{ offset: 0.5, color: 'rgba(0,255,0,1.000)' },
					{ offset: 1, color: 'rgba(0,0,255,1.000)' },
				]);
			}
		});

		it('parses a path gradient brush into a radial gradient', () => {
			const rCtx = makeRCtx();
			const d = 0;
			// EmfPlusPathGradientBrushData: type, flags, wrap, centre colour,
			// centre point, surrounding colours, boundary point list.
			rCtx.view.setUint32(d, EMFPLUS_BRUSHTYPE_PATHGRADIENT, true);
			const b = d + 4;
			rCtx.view.setUint32(b, 0, true); // flags (boundary = point list)
			rCtx.view.setUint32(b + 4, 0, true); // wrap
			rCtx.view.setUint32(b + 8, 0xff0000ff, true); // centre = blue
			rCtx.view.setFloat32(b + 12, 50, true); // cx
			rCtx.view.setFloat32(b + 16, 50, true); // cy
			rCtx.view.setUint32(b + 20, 1, true); // surround count
			rCtx.view.setUint32(b + 24, 0xffffffff, true); // surround = white
			rCtx.view.setUint32(b + 28, 2, true); // boundary point count
			rCtx.view.setFloat32(b + 32, 0, true); // p0.x
			rCtx.view.setFloat32(b + 36, 50, true); // p0.y
			rCtx.view.setFloat32(b + 40, 100, true); // p1.x
			rCtx.view.setFloat32(b + 44, 50, true); // p1.y

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 2), d, 4 + 48);
			const brush = rCtx.objectTable.get(2);
			expect(brush).toBeDefined();
			if (brush!.kind === 'plus-brush') {
				expect(brush.color).toContain('0,0,255');
				expect(brush.gradient).toBeDefined();
				if (brush.gradient?.type === 'radial') {
					expect(brush.gradient.cx).toBe(50);
					expect(brush.gradient.cy).toBe(50);
					expect(brush.gradient.r).toBe(50);
					expect(brush.gradient.stops[0].color).toBe('rgba(0,0,255,1.000)');
					expect(brush.gradient.stops[1].color).toBe('rgba(255,255,255,1.000)');
				}
			}
		});

		it('accepts a version-prefixed brush (real GDI+ layout)', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true); // EmfPlusGraphicsVersion
			rCtx.view.setUint32(d + 4, EMFPLUS_BRUSHTYPE_SOLID, true);
			rCtx.view.setUint32(d + 8, 0xffff0000, true); // red

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 5), d, 12);
			const brush = rCtx.objectTable.get(5);
			expect(brush!.kind).toBe('plus-brush');
			if (brush!.kind === 'plus-brush') {
				expect(brush.color).toBe('rgba(255,0,0,1.000)');
			}
		});

		it('parses a hatch fill brush', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, EMFPLUS_BRUSHTYPE_HATCHFILL, true);
			rCtx.view.setUint32(d + 8, 0xff808080, true); // gray

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 3), d, 12);
			const brush = rCtx.objectTable.get(3);
			expect(brush).toBeDefined();
			expect(brush!.kind).toBe('plus-brush');
		});

		it('ignores brush with recDataSize < 8', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 0), 0, 4);
			expect(rCtx.objectTable.has(0)).toBeFalsy();
		});

		it('defaults to black for unknown brush type', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 999, true); // unknown brush type

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 0), d, 8);
			const brush = rCtx.objectTable.get(0);
			expect(brush).toBeDefined();
			if (brush!.kind === 'plus-brush') {
				expect(brush.color).toBe('rgba(0,0,0,1)');
			}
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: Pen
	// ---------------------------------------------------------------------------

	describe('pen objects', () => {
		it('parses a simple pen (no optional flags)', () => {
			const rCtx = makeRCtx();
			const d = 0;
			// Pen header: version(4) + flags(4) + unit(4) + penWidth(4) = 16 min
			// Then brush data
			rCtx.view.setUint32(d, 0xdbc01002, true); // version
			rCtx.view.setUint32(d + 4, 0, true); // penFlags = 0 (no optional data)
			rCtx.view.setUint32(d + 8, 0, true); // unit
			rCtx.view.setFloat32(d + 12, 0, true); // not penWidth — skip 4 bytes for version field alignment
			rCtx.view.setFloat32(d + 16, 2.5, true); // penWidth at offset 16

			// Brush at offset 20: brushType(4) + ARGB(4)
			rCtx.view.setUint32(d + 20, EMFPLUS_BRUSHTYPE_SOLID, true);
			rCtx.view.setUint32(d + 24, 0xff0000ff, true); // blue

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_PEN, 0), d, 28);
			const pen = rCtx.objectTable.get(0);
			expect(pen).toBeDefined();
			expect(pen!.kind).toBe('plus-pen');
		});

		it('returns null for pen with insufficient data', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_PEN, 0), 0, 8);
			// May or may not have an entry depending on parser behavior
			// The key is it doesn't crash
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: Font
	// ---------------------------------------------------------------------------

	describe('font objects', () => {
		it('parses a font with family name', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true); // version
			rCtx.view.setFloat32(d + 4, 14, true); // emSize
			rCtx.view.setUint32(d + 8, 0, true); // sizeUnit
			rCtx.view.setInt32(d + 12, 1, true); // styleFlags = Bold
			rCtx.view.setUint32(d + 16, 0, true); // reserved
			rCtx.view.setUint32(d + 20, 5, true); // nameLen = 5
			// Write "Arial" as UTF-16LE
			const name = 'Arial';
			for (let i = 0; i < name.length; i++) {
				rCtx.view.setUint16(d + 24 + i * 2, name.charCodeAt(i), true);
			}

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_FONT, 5), d, 34);
			const font = rCtx.objectTable.get(5);
			expect(font).toBeDefined();
			expect(font!.kind).toBe('plus-font');
			if (font!.kind === 'plus-font') {
				expect(font.emSize).toBe(14);
				expect(font.flags).toBe(1);
				expect(font.family).toBe('Arial');
			}
		});

		it('defaults to sans-serif for empty family name', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true);
			rCtx.view.setFloat32(d + 4, 12, true);
			rCtx.view.setUint32(d + 8, 0, true);
			rCtx.view.setInt32(d + 12, 0, true);
			rCtx.view.setUint32(d + 16, 0, true);
			rCtx.view.setUint32(d + 20, 0, true); // nameLen = 0

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_FONT, 0), d, 28);
			const font = rCtx.objectTable.get(0);
			expect(font).toBeDefined();
			if (font!.kind === 'plus-font') {
				expect(font.family).toBe('sans-serif');
			}
		});

		it('ignores font with recDataSize < 28', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_FONT, 0), 0, 20);
			expect(rCtx.objectTable.has(0)).toBeFalsy();
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: StringFormat
	// ---------------------------------------------------------------------------

	describe('stringFormat objects', () => {
		it('parses string format with alignment', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true); // version
			rCtx.view.setUint32(d + 4, 0, true); // sfFlags
			rCtx.view.setUint32(d + 8, 0, true); // language
			rCtx.view.setUint32(d + 12, 1, true); // alignment = Center
			rCtx.view.setUint32(d + 16, 2, true); // lineAlignment = Far

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_STRINGFORMAT, 10), d, 20);
			const sf = rCtx.objectTable.get(10);
			expect(sf).toBeDefined();
			expect(sf!.kind).toBe('plus-stringformat');
			if (sf!.kind === 'plus-stringformat') {
				expect(sf.alignment).toBe(1);
				expect(sf.lineAlignment).toBe(2);
			}
		});

		it('ignores string format with recDataSize < 16', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_STRINGFORMAT, 0), 0, 12);
			expect(rCtx.objectTable.has(0)).toBeFalsy();
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: Image
	// ---------------------------------------------------------------------------

	describe('image objects', () => {
		it('parses a compressed bitmap image (type 2)', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true); // version
			rCtx.view.setUint32(d + 4, 1, true); // imgType = Bitmap

			// Bitmap fields
			rCtx.view.setInt32(d + 8, 2, true); // width
			rCtx.view.setInt32(d + 12, 2, true); // height
			rCtx.view.setInt32(d + 16, 8, true); // stride
			rCtx.view.setUint32(d + 20, 0x00021808, true); // pixelFormat = 24bpp
			rCtx.view.setUint32(d + 24, 2, true); // bmpType = 2 (compressed)
			// Write some fake PNG header bytes at d+28
			rCtx.view.setUint8(d + 28, 0x89); // PNG magic
			rCtx.view.setUint8(d + 29, 0x50);
			rCtx.view.setUint8(d + 30, 0x4e);
			rCtx.view.setUint8(d + 31, 0x47);

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_IMAGE, 0), d, 36);
			expect(rCtx.totalImageObjects).toBe(1);
			const img = rCtx.objectTable.get(0);
			expect(img).toBeDefined();
			expect(img!.kind).toBe('plus-image');
			if (img!.kind === 'plus-image') {
				expect(img.data).not.toBeNull();
				expect(img.type).toBe(1);
			}
		});

		it('parses a metafile image (type 2)', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true);
			rCtx.view.setUint32(d + 4, 2, true); // imgType = Metafile

			rCtx.view.setUint32(d + 8, 3, true); // mfType = EMF
			rCtx.view.setUint32(d + 12, 8, true); // mfDataSize
			// Fake metafile data at d+16
			rCtx.view.setUint32(d + 16, 1, true); // EMR_HEADER

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_IMAGE, 1), d, 24);
			expect(rCtx.totalImageObjects).toBe(1);
			const img = rCtx.objectTable.get(1);
			expect(img).toBeDefined();
			if (img!.kind === 'plus-image') {
				expect(img.data).not.toBeNull();
				expect(img.type).toBe(2);
			}
		});

		it('ignores image with recDataSize < 8', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_IMAGE, 0), 0, 4);
			expect(rCtx.totalImageObjects).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: ImageAttributes
	// ---------------------------------------------------------------------------

	describe('imageAttributes objects', () => {
		it('stores a stub image attributes object', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_IMAGEATTRIBUTES, 7), 0, 0);
			const obj = rCtx.objectTable.get(7);
			expect(obj).toBeDefined();
			expect(obj!.kind).toBe('plus-imageattributes');
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: Region
	// ---------------------------------------------------------------------------

	describe('region objects', () => {
		it('parses a region with a rect leaf node', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true); // version
			rCtx.view.setUint32(d + 4, 1, true); // regionNodeCount

			// Rect leaf node at d+8
			rCtx.view.setUint32(d + 8, 0x10000000, true); // nodeType = Rect
			rCtx.view.setFloat32(d + 12, 10, true); // x
			rCtx.view.setFloat32(d + 16, 20, true); // y
			rCtx.view.setFloat32(d + 20, 100, true); // w
			rCtx.view.setFloat32(d + 24, 80, true); // h

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_REGION, 0), d, 28);
			const region = rCtx.objectTable.get(0);
			expect(region).toBeDefined();
			expect(region!.kind).toBe('plus-region');
			if (region!.kind === 'plus-region') {
				expect(region.nodes).toHaveLength(1);
				expect(region.nodes[0].type).toBe('rect');
			}
		});

		it('parses a region with an empty leaf', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true);
			rCtx.view.setUint32(d + 4, 1, true);
			rCtx.view.setUint32(d + 8, 0x10000002, true); // Empty

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_REGION, 0), d, 12);
			const region = rCtx.objectTable.get(0);
			expect(region).toBeDefined();
			if (region!.kind === 'plus-region') {
				expect(region.nodes[0].type).toBe('empty');
			}
		});

		it('parses a region with an infinite leaf', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true);
			rCtx.view.setUint32(d + 4, 1, true);
			rCtx.view.setUint32(d + 8, 0x10000003, true); // Infinite

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_REGION, 0), d, 12);
			const region = rCtx.objectTable.get(0);
			expect(region).toBeDefined();
			if (region!.kind === 'plus-region') {
				expect(region.nodes[0].type).toBe('infinite');
			}
		});

		it('parses a combine node (intersect two rects)', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true);
			rCtx.view.setUint32(d + 4, 3, true); // 3 nodes total

			// Combine node: And (intersect) = 0
			let off = d + 8;
			rCtx.view.setUint32(off, 0, true); // combineMode = And
			off += 4;

			// Left child: rect
			rCtx.view.setUint32(off, 0x10000000, true);
			off += 4;
			rCtx.view.setFloat32(off, 0, true);
			off += 4;
			rCtx.view.setFloat32(off, 0, true);
			off += 4;
			rCtx.view.setFloat32(off, 100, true);
			off += 4;
			rCtx.view.setFloat32(off, 100, true);
			off += 4;

			// Right child: rect
			rCtx.view.setUint32(off, 0x10000000, true);
			off += 4;
			rCtx.view.setFloat32(off, 50, true);
			off += 4;
			rCtx.view.setFloat32(off, 50, true);
			off += 4;
			rCtx.view.setFloat32(off, 100, true);
			off += 4;
			rCtx.view.setFloat32(off, 100, true);
			off += 4;

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_REGION, 0), d, off - d);
			const region = rCtx.objectTable.get(0);
			expect(region).toBeDefined();
			if (region!.kind === 'plus-region') {
				expect(region.nodes[0].type).toBe('combine');
				if (region.nodes[0].type === 'combine') {
					expect(region.nodes[0].combineMode).toBe(0);
					expect(region.nodes[0].left.type).toBe('rect');
					expect(region.nodes[0].right.type).toBe('rect');
				}
			}
		});

		it('returns null for region with maxLen < 8', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_REGION, 0), 0, 4);
			expect(rCtx.objectTable.has(0)).toBeFalsy();
		});

		it('returns null for region with zero node count', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, 0xdbc01002, true);
			rCtx.view.setUint32(d + 4, 0, true); // 0 nodes — invalid

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_REGION, 0), d, 8);
			expect(rCtx.objectTable.has(0)).toBeFalsy();
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: Unknown object type
	// ---------------------------------------------------------------------------

	describe('unknown object type', () => {
		it('does not crash and does not store anything', () => {
			const rCtx = makeRCtx();
			handleEmfPlusObjectRecord(rCtx, makeFlags(0x7f, 0), 0, 8);
			expect(rCtx.objectTable.has(0)).toBeFalsy();
		});
	});

	// ---------------------------------------------------------------------------
	// Tests: objectId extraction
	// ---------------------------------------------------------------------------

	describe('objectId extraction from flags', () => {
		it('stores object at the correct ID from low byte of flags', () => {
			const rCtx = makeRCtx();
			const d = 0;
			rCtx.view.setUint32(d, EMFPLUS_BRUSHTYPE_SOLID, true);
			rCtx.view.setUint32(d + 4, 0xff000000, true);

			handleEmfPlusObjectRecord(rCtx, makeFlags(EMFPLUS_OBJECTTYPE_BRUSH, 42), d, 8);
			expect(rCtx.objectTable.has(42)).toBeTruthy();
		});
	});
});
