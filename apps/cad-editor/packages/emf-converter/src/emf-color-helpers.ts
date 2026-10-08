/**
 * Colour conversion helpers for the EMF/WMF converter.
 */

export function colorRefToHex(r: number, g: number, b: number): string {
	const toHex = (v: number) => v.toString(16).padStart(2, '0');
	return `#${toHex(r & 0xff)}${toHex(g & 0xff)}${toHex(b & 0xff)}`;
}

export function readColorRef(view: DataView, offset: number): string {
	const r = view.getUint8(offset);
	const g = view.getUint8(offset + 1);
	const b = view.getUint8(offset + 2);
	return colorRefToHex(r, g, b);
}

/** Convert an ARGB 32-bit integer to a CSS rgba() string. */
export function argbToRgba(argb: number): string {
	const a = ((argb >>> 24) & 0xff) / 255;
	const r = (argb >>> 16) & 0xff;
	const g = (argb >>> 8) & 0xff;
	const b = argb & 0xff;
	return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/**
 * Linearly interpolate between two ARGB 32-bit colours and return a CSS
 * rgba() string. Used to expand GDI+ gradient blend factors into concrete
 * colour stops. `t` is clamped to 0..1.
 */
export function lerpArgbToRgba(argbA: number, argbB: number, t: number): string {
	const tc = Math.min(1, Math.max(0, t));
	const mix = (a: number, b: number) => Math.round(a + (b - a) * tc);
	const aA = (argbA >>> 24) & 0xff;
	const aB = (argbB >>> 24) & 0xff;
	const r = mix((argbA >>> 16) & 0xff, (argbB >>> 16) & 0xff);
	const g = mix((argbA >>> 8) & 0xff, (argbB >>> 8) & 0xff);
	const b = mix(argbA & 0xff, argbB & 0xff);
	const a = mix(aA, aB) / 255;
	return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/**
 * Bitwise-invert the RGB channels of a CSS colour (`#rrggbb`, `#rgb`, or
 * `rgb()`/`rgba()`), preserving alpha. Colours that cannot be parsed are
 * returned unchanged. Used to emulate the NOT-family ROP2 raster modes, where
 * GDI applies the drawing operation with the ones-complement of the pen/brush.
 */
export function invertCssColor(color: string): string {
	const hex = /^#([0-9a-f]{6})$/i.exec(color);
	if (hex) {
		const v = parseInt(hex[1], 16);
		const inv = 0xffffff ^ v;
		return `#${inv.toString(16).padStart(6, '0')}`;
	}
	const shortHex = /^#([0-9a-f]{3})$/i.exec(color);
	if (shortHex) {
		const [r, g, b] = shortHex[1].split('').map((c) => parseInt(c + c, 16));
		const toHex = (v: number) => (255 - v).toString(16).padStart(2, '0');
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}
	const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
	if (rgba) {
		const r = 255 - Math.min(255, parseInt(rgba[1], 10));
		const g = 255 - Math.min(255, parseInt(rgba[2], 10));
		const b = 255 - Math.min(255, parseInt(rgba[3], 10));
		return rgba[4] !== undefined
			? `rgba(${r},${g},${b},${rgba[4]})`
			: `rgb(${r},${g},${b})`;
	}
	return color;
}
