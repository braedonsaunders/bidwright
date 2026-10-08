import { describe, expect, it } from 'vitest';

import { ARGB_SAMPLES, COLOR_REF_SAMPLES, viewFromBytes } from './__fixtures__/color-samples';
import { argbToRgba, colorRefToHex, readColorRef } from './emf-color-helpers';

describe('emf colour helpers (fixtures)', () => {
	it.each(COLOR_REF_SAMPLES)('colorRefToHex $name -> $hex', ({ rgb, hex }) => {
		expect(colorRefToHex(rgb[0], rgb[1], rgb[2])).toBe(hex);
	});

	it('colorRefToHex masks each channel to a single byte', () => {
		expect(colorRefToHex(0x105, 0x2ff, -1)).toBe('#05ffff');
	});

	it.each(COLOR_REF_SAMPLES)('readColorRef reads $name at offset 0', ({ rgb, hex }) => {
		expect(readColorRef(viewFromBytes(rgb), 0)).toBe(hex);
	});

	it('readColorRef honours a non-zero offset', () => {
		const view = viewFromBytes([16, 32, 48], 2);
		expect(readColorRef(view, 2)).toBe('#102030');
	});

	it.each(ARGB_SAMPLES)('argbToRgba $name -> $rgba', ({ argb, rgba }) => {
		expect(argbToRgba(argb)).toBe(rgba);
	});
});
