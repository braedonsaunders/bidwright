import { describe, it, expect } from 'vitest';

import {
	applyPen,
	applyBrush,
	applyFont,
	cssFontWeight,
	drawTextDecorations,
	mapFontFamily,
	readUtf16LE,
	rop2Paint,
	rop2ToGco,
	getStockObject,
} from './emf-canvas-helpers';
import type { DrawState } from './emf-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockCtx {
	strokeStyle: string;
	lineWidth: number;
	fillStyle: string;
	font: string;
	_lineDash: number[];
	setLineDash(dash: number[]): void;
}

function createMockCtx(): MockCtx {
	return {
		strokeStyle: '',
		lineWidth: 0,
		fillStyle: '',
		font: '',
		_lineDash: [] as number[],
		setLineDash(dash: number[]) {
			this._lineDash = dash;
		},
	};
}

const asCtx = (ctx: MockCtx): CanvasRenderingContext2D =>
	ctx as unknown as CanvasRenderingContext2D;

function createDefaultDrawState(overrides: Partial<DrawState> = {}): DrawState {
	return {
		penColor: '#000000',
		penWidth: 1,
		penStyle: 0,
		brushColor: '#ffffff',
		brushStyle: 0,
		textColor: '#000000',
		bkColor: '#ffffff',
		bkMode: 1,
		fontHeight: 12,
		fontWeight: 400,
		fontItalic: false,
		fontFamily: 'Arial',
		textAlign: 0,
		polyFillMode: 1,
		mapMode: 1,
		...overrides,
	} as DrawState;
}

// ---------------------------------------------------------------------------
// applyPen
// ---------------------------------------------------------------------------

describe('applyPen', () => {
	it('sets transparent stroke for null pen (style 5)', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penStyle: 5 });
		applyPen(asCtx(ctx), state);
		expect(ctx.strokeStyle).toBe('rgba(0,0,0,0)');
		expect(ctx.lineWidth).toBe(0);
	});

	it('sets solid stroke with pen color and width', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penColor: '#ff0000', penWidth: 3, penStyle: 0 });
		applyPen(asCtx(ctx), state);
		expect(ctx.strokeStyle).toBe('#ff0000');
		expect(ctx.lineWidth).toBe(3);
		expect(ctx._lineDash).toStrictEqual([]);
	});

	it('sets dash pattern for pen style 1', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penStyle: 1 });
		applyPen(asCtx(ctx), state);
		expect(ctx._lineDash).toStrictEqual([8, 4]);
	});

	it('sets dot pattern for pen style 2', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penStyle: 2 });
		applyPen(asCtx(ctx), state);
		expect(ctx._lineDash).toStrictEqual([2, 2]);
	});

	it('sets dash-dot pattern for pen style 3', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penStyle: 3 });
		applyPen(asCtx(ctx), state);
		expect(ctx._lineDash).toStrictEqual([8, 4, 2, 4]);
	});

	it('sets dash-dot-dot pattern for pen style 4', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penStyle: 4 });
		applyPen(asCtx(ctx), state);
		expect(ctx._lineDash).toStrictEqual([8, 4, 2, 4, 2, 4]);
	});

	it('enforces minimum line width of 1', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ penWidth: 0, penStyle: 0 });
		applyPen(asCtx(ctx), state);
		expect(ctx.lineWidth).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// applyBrush
// ---------------------------------------------------------------------------

describe('applyBrush', () => {
	it('sets transparent fill for hollow brush (style 1)', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ brushStyle: 1 });
		applyBrush(asCtx(ctx), state);
		expect(ctx.fillStyle).toBe('rgba(0,0,0,0)');
	});

	it('sets solid fill with brush color for style 0', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ brushColor: '#00ff00', brushStyle: 0 });
		applyBrush(asCtx(ctx), state);
		expect(ctx.fillStyle).toBe('#00ff00');
	});

	it('uses brush color for non-null non-hollow styles', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ brushColor: '#123456', brushStyle: 2 });
		applyBrush(asCtx(ctx), state);
		expect(ctx.fillStyle).toBe('#123456');
	});
});

// ---------------------------------------------------------------------------
// applyFont
// ---------------------------------------------------------------------------

describe('applyFont', () => {
	it('sets basic font string', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({
			fontHeight: 16,
			fontWeight: 400,
			fontItalic: false,
			fontFamily: 'Arial',
		});
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toBe('16px Arial');
	});

	it('includes italic prefix when fontItalic is true', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: 14, fontItalic: true, fontFamily: 'Times' });
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toContain('italic');
	});

	it('includes bold prefix for weight >= 700', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({
			fontHeight: 12,
			fontWeight: 700,
			fontFamily: 'Verdana',
		});
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toContain('bold');
	});

	it('uses minimum font size of 8', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: 3, fontFamily: 'Courier' });
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toContain('8px');
	});

	it('scales the logical height by the mapping factor', () => {
		// A font height is a logical height like any other length, so it goes through the
		// window/viewport mapping. An EMF with a window extent of 2540 against a viewport
		// extent of 132 maps one logical unit to ~0.052 canvas pixels, so lfHeight -635
		// is a 33px font - not a 635px one painted over the rest of the picture.
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: -635, fontFamily: 'Arial' });
		applyFont(asCtx(ctx), state, 132 / 2540);
		expect(ctx.font).toBe('33px Arial');
	});

	it('leaves the size alone when the mapping is the identity', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: 16, fontFamily: 'Arial' });
		applyFont(asCtx(ctx), state, 1);
		expect(ctx.font).toBe('16px Arial');
	});

	it('keeps the 8px floor after scaling', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: 100, fontFamily: 'Arial' });
		applyFont(asCtx(ctx), state, 0.01);
		expect(ctx.font).toBe('8px Arial');
	});

	it('handles negative fontHeight by taking absolute value', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: -20, fontFamily: 'Helvetica' });
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toContain('20px');
	});

	it('combines italic and numeric weight for heavy italic font', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({
			fontHeight: 18,
			fontWeight: 800,
			fontItalic: true,
			fontFamily: 'Georgia',
		});
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toBe('italic 800 18px Georgia');
	});

	it('quotes multi-word face names', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({ fontHeight: 10, fontFamily: 'Times New Roman' });
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toBe('10px "Times New Roman"');
	});

	it('applies a fontFamilyMap override (case-insensitive)', () => {
		const ctx = createMockCtx();
		const state = createDefaultDrawState({
			fontHeight: 10,
			fontFamily: 'Calibri',
			fontFamilyMap: { calibri: 'Carlito' },
		});
		applyFont(asCtx(ctx), state);
		expect(ctx.font).toBe('10px Carlito');
	});
});

// ---------------------------------------------------------------------------
// cssFontWeight
// ---------------------------------------------------------------------------

describe('cssFontWeight', () => {
	it('returns empty string for normal weight', () => {
		expect(cssFontWeight(400)).toBe('');
		expect(cssFontWeight(0)).toBe('');
	});

	it('returns "bold" for 700', () => {
		expect(cssFontWeight(700)).toBe('bold');
	});

	it('emits numeric tokens for other weights, rounded to nearest 100', () => {
		expect(cssFontWeight(300)).toBe('300');
		expect(cssFontWeight(600)).toBe('600');
		expect(cssFontWeight(900)).toBe('900');
		expect(cssFontWeight(820)).toBe('800');
	});
});

// ---------------------------------------------------------------------------
// mapFontFamily
// ---------------------------------------------------------------------------

describe('mapFontFamily', () => {
	it('returns the face unchanged when no map is supplied', () => {
		expect(mapFontFamily('Arial')).toBe('Arial');
	});

	it('quotes names containing whitespace', () => {
		expect(mapFontFamily('MS Shell Dlg')).toBe('"MS Shell Dlg"');
	});

	it('remaps via a case-insensitive lookup before quoting', () => {
		expect(mapFontFamily('MS Shell Dlg', { 'ms shell dlg': 'Tahoma' })).toBe('Tahoma');
	});

	it('does not double-quote an already-quoted family', () => {
		expect(mapFontFamily('"Already Quoted"')).toBe('"Already Quoted"');
	});
});

// ---------------------------------------------------------------------------
// rop2ToGco
// ---------------------------------------------------------------------------

describe('rop2Paint / rop2ToGco', () => {
	it('maps bitwise pen ops to their nearest composite operations', () => {
		expect(rop2ToGco(7)).toBe('difference'); // R2_XORPEN
		expect(rop2ToGco(9)).toBe('darken'); // R2_MASKPEN
		expect(rop2ToGco(15)).toBe('lighten'); // R2_MERGEPEN
		expect(rop2ToGco(6)).toBe('difference'); // R2_NOT
	});

	it('falls back to source-over for the default and unknown modes', () => {
		expect(rop2ToGco(13)).toBe('source-over'); // R2_COPYPEN (default)
		expect(rop2ToGco(0)).toBe('source-over');
		expect(rop2ToGco(99)).toBe('source-over');
	});

	it('reports exact emulation for the faithful modes', () => {
		for (const mode of [1, 4, 6, 11, 13, 16]) {
			expect(rop2Paint(mode).exact).toBe(true);
		}
		for (const mode of [2, 3, 5, 7, 8, 9, 10, 12, 14, 15]) {
			expect(rop2Paint(mode).exact).toBe(false);
		}
	});

	it('applies colour transforms for the NOT-family modes', () => {
		expect(rop2Paint(1)).toMatchObject({ gco: 'source-over', colorTransform: 'black' }); // R2_BLACK
		expect(rop2Paint(16)).toMatchObject({ gco: 'source-over', colorTransform: 'white' }); // R2_WHITE
		expect(rop2Paint(11)).toMatchObject({ colorTransform: 'skip' }); // R2_NOP
		expect(rop2Paint(4)).toMatchObject({ gco: 'source-over', colorTransform: 'invert' }); // R2_NOTCOPYPEN
		expect(rop2Paint(6)).toMatchObject({ gco: 'difference', colorTransform: 'white' }); // R2_NOT
		expect(rop2Paint(2)).toMatchObject({ gco: 'darken', colorTransform: 'invert' }); // R2_NOTMERGEPEN
		expect(rop2Paint(8)).toMatchObject({ gco: 'lighten', colorTransform: 'invert' }); // R2_NOTMASKPEN
	});

	it('is applied by applyPen/applyBrush from state.rop2', () => {
		const pen = createMockCtx() as MockCtx & { globalCompositeOperation: string };
		applyPen(asCtx(pen), createDefaultDrawState({ rop2: 7 }));
		expect(pen.globalCompositeOperation).toBe('difference');

		const brush = createMockCtx() as MockCtx & { globalCompositeOperation: string };
		applyBrush(asCtx(brush), createDefaultDrawState({ rop2: 13 }));
		expect(brush.globalCompositeOperation).toBe('source-over');
	});

	it('inverts the pen colour for R2_NOTCOPYPEN and forces white for R2_NOT', () => {
		const pen = createMockCtx() as MockCtx & {
			globalCompositeOperation: string;
			strokeStyle: string;
		};
		applyPen(asCtx(pen), createDefaultDrawState({ rop2: 4, penColor: '#ff0000' }));
		expect(pen.strokeStyle).toBe('#00ffff');

		const notPen = createMockCtx() as MockCtx & {
			globalCompositeOperation: string;
			strokeStyle: string;
		};
		applyPen(asCtx(notPen), createDefaultDrawState({ rop2: 6, penColor: '#ff0000' }));
		expect(notPen.strokeStyle).toBe('#ffffff');
		expect(notPen.globalCompositeOperation).toBe('difference');
	});

	it('draws nothing for R2_NOP via a fully transparent brush', () => {
		const brush = createMockCtx() as MockCtx & { fillStyle: string };
		applyBrush(asCtx(brush), createDefaultDrawState({ rop2: 11, brushColor: '#123456' }));
		expect(brush.fillStyle).toBe('rgba(0,0,0,0)');
	});
});

// ---------------------------------------------------------------------------
// drawTextDecorations
// ---------------------------------------------------------------------------

describe('drawTextDecorations', () => {
	interface RectCtx {
		fillStyle: string;
		rects: Array<{ x: number; y: number; w: number; h: number }>;
		fillRect(x: number, y: number, w: number, h: number): void;
	}
	const makeRectCtx = (): RectCtx => ({
		fillStyle: '',
		rects: [],
		fillRect(x, y, w, h) {
			this.rects.push({ x, y, w, h });
		},
	});

	it('draws nothing when neither decoration is set', () => {
		const ctx = makeRectCtx();
		const state = createDefaultDrawState({ fontUnderline: false, fontStrikeOut: false });
		drawTextDecorations(ctx as unknown as CanvasRenderingContext2D, state, 0, 20, 50);
		expect(ctx.rects).toHaveLength(0);
	});

	it('draws an underline rectangle below the baseline', () => {
		const ctx = makeRectCtx();
		const state = createDefaultDrawState({ fontUnderline: true, textColor: '#112233' });
		drawTextDecorations(ctx as unknown as CanvasRenderingContext2D, state, 5, 20, 40);
		expect(ctx.rects).toHaveLength(1);
		expect(ctx.rects[0].x).toBe(5);
		expect(ctx.rects[0].w).toBe(40);
		expect(ctx.rects[0].y).toBeGreaterThan(20);
	});

	it('draws both underline and strike-out when both are set', () => {
		const ctx = makeRectCtx();
		const state = createDefaultDrawState({ fontUnderline: true, fontStrikeOut: true });
		drawTextDecorations(ctx as unknown as CanvasRenderingContext2D, state, 0, 30, 60);
		expect(ctx.rects).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// readUtf16LE
// ---------------------------------------------------------------------------

describe('readUtf16LE', () => {
	function makeView(chars: number[]): DataView {
		const buf = new ArrayBuffer(chars.length * 2);
		const view = new DataView(buf);
		for (let i = 0; i < chars.length; i++) {
			view.setUint16(i * 2, chars[i], true);
		}
		return view;
	}

	it('reads ASCII characters encoded as UTF-16LE', () => {
		const view = makeView([72, 101, 108, 108, 111]); // "Hello"
		expect(readUtf16LE(view, 0, 5)).toBe('Hello');
	});

	it('stops at null terminator', () => {
		const view = makeView([65, 66, 0, 67]); // "AB\0C"
		expect(readUtf16LE(view, 0, 4)).toBe('AB');
	});

	it('reads from specified offset', () => {
		const view = makeView([0, 0, 72, 105]); // skip 2 chars, then "Hi"
		expect(readUtf16LE(view, 4, 2)).toBe('Hi');
	});

	it('returns empty string for zero charCount', () => {
		const view = makeView([65]);
		expect(readUtf16LE(view, 0, 0)).toBe('');
	});

	it('handles offset beyond buffer without crashing', () => {
		const view = makeView([65]);
		expect(readUtf16LE(view, 100, 5)).toBe('');
	});

	it('reads Unicode characters', () => {
		// U+00E9 = e with accent, U+00F1 = n with tilde
		const view = makeView([0x00e9, 0x00f1]);
		expect(readUtf16LE(view, 0, 2)).toBe('\u00e9\u00f1');
	});
});

// ---------------------------------------------------------------------------
// getStockObject
// ---------------------------------------------------------------------------

describe('getStockObject', () => {
	it('returns white brush for index 0', () => {
		const obj = getStockObject(0);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('brush');
		expect((obj as Record<string, unknown>).color).toBe('#ffffff');
	});

	it('returns black brush for index 4', () => {
		const obj = getStockObject(4);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('brush');
		expect((obj as Record<string, unknown>).color).toBe('#000000');
	});

	it('returns hollow brush for index 5', () => {
		const obj = getStockObject(5);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('brush');
		expect((obj as Record<string, unknown>).style).toBe(1);
	});

	it('returns white pen for index 6', () => {
		const obj = getStockObject(6);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('pen');
		expect((obj as Record<string, unknown>).color).toBe('#ffffff');
	});

	it('returns black pen for index 7', () => {
		const obj = getStockObject(7);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('pen');
		expect((obj as Record<string, unknown>).color).toBe('#000000');
	});

	it('returns null pen for index 8', () => {
		const obj = getStockObject(8);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('pen');
		expect((obj as Record<string, unknown>).style).toBe(5);
	});

	it('returns monospace font for index 10', () => {
		const obj = getStockObject(10);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('font');
		expect((obj as Record<string, unknown>).family).toBe('monospace');
	});

	it('returns sans-serif font for index 13', () => {
		const obj = getStockObject(13);
		expect(obj).not.toBeNull();
		expect(obj!.kind).toBe('font');
		expect((obj as Record<string, unknown>).family).toBe('sans-serif');
	});

	it('returns null for unknown index', () => {
		expect(getStockObject(99)).toBeNull();
		expect(getStockObject(9)).toBeNull();
	});
});
