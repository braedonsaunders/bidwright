import { describe, expect, it } from 'vitest';

import { viewFromBytes } from './__fixtures__/color-samples';
import { GRAYSCALE_SAMPLES } from './__fixtures__/grayscale-samples';
import { colorRefToHex, readColorRef } from './emf-color-helpers';

describe('emf colour helpers — grayscale ramp (fixtures)', () => {
	it.each(GRAYSCALE_SAMPLES)('colorRefToHex($level, $level, $level) -> $hex', ({ level, hex }) => {
		expect(colorRefToHex(level, level, level)).toBe(hex);
	});

	it.each(GRAYSCALE_SAMPLES)('readColorRef round-trips $hex', ({ level, hex }) => {
		expect(readColorRef(viewFromBytes([level, level, level]), 0)).toBe(hex);
	});
});
