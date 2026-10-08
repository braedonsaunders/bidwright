/**
 * Shared colour fixtures for the EMF/WMF colour-helper tests.
 */

/** A colour-ref sample: raw RGB bytes and the expected #rrggbb output. */
export interface ColorRefSample {
	readonly name: string;
	readonly rgb: readonly [number, number, number];
	readonly hex: string;
}

export const COLOR_REF_SAMPLES: readonly ColorRefSample[] = [
	{ name: 'black', rgb: [0, 0, 0], hex: '#000000' },
	{ name: 'white', rgb: [255, 255, 255], hex: '#ffffff' },
	{ name: 'pure red', rgb: [255, 0, 0], hex: '#ff0000' },
	{ name: 'mixed', rgb: [16, 32, 48], hex: '#102030' },
	{ name: 'low bytes zero-padded', rgb: [1, 2, 3], hex: '#010203' },
];

/** An ARGB sample: packed 32-bit value and the expected rgba() string. */
export interface ArgbSample {
	readonly name: string;
	readonly argb: number;
	readonly rgba: string;
}

export const ARGB_SAMPLES: readonly ArgbSample[] = [
	{ name: 'opaque black', argb: 0xff000000, rgba: 'rgba(0,0,0,1.000)' },
	{ name: 'opaque red', argb: 0xffff0000, rgba: 'rgba(255,0,0,1.000)' },
	{ name: 'transparent white', argb: 0x00ffffff, rgba: 'rgba(255,255,255,0.000)' },
	{ name: 'half-alpha orange', argb: 0x80ff8040, rgba: 'rgba(255,128,64,0.502)' },
];

/** Build a DataView over the given bytes, optionally with leading padding. */
export function viewFromBytes(bytes: readonly number[], leadingPad = 0): DataView {
	const buf = new Uint8Array(leadingPad + bytes.length);
	buf.set(bytes, leadingPad);
	return new DataView(buf.buffer);
}
