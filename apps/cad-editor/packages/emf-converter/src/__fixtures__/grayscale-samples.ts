/**
 * Grayscale colour-ref fixtures for the EMF/WMF colour-helper tests.
 */

export interface GrayscaleSample {
	/** Equal R=G=B channel level. */
	readonly level: number;
	/** Expected #rrggbb output. */
	readonly hex: string;
}

/** A short grayscale ramp with the expected #rrggbb output. */
export const GRAYSCALE_SAMPLES: readonly GrayscaleSample[] = [
	{ level: 0, hex: '#000000' },
	{ level: 64, hex: '#404040' },
	{ level: 128, hex: '#808080' },
	{ level: 192, hex: '#c0c0c0' },
	{ level: 255, hex: '#ffffff' },
];
