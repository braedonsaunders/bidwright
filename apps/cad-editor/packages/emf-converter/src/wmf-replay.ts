/**
 * WMF (Windows Metafile) record replay.
 *
 * Simpler than EMF `u2014` 16-bit records with a smaller set of drawing primitives.
 */

import { readColorRef } from './emf-color-helpers';
import {
	META_EOF,
	META_SETWINDOWORG,
	META_SETWINDOWEXT,
	META_SAVEDC,
	META_RESTOREDC,
	META_SETTEXTCOLOR,
	META_SETBKCOLOR,
	META_SETBKMODE,
	META_SETROP2,
	META_SETPOLYFILLMODE,
	META_SETTEXTALIGN,
	META_CREATEPENINDIRECT,
	META_CREATEBRUSHINDIRECT,
	META_CREATEFONTINDIRECT,
	META_SELECTOBJECT,
	META_DELETEOBJECT,
	MAX_RECORDS_DEFAULT,
} from './emf-constants';
import type {
	CanvasContext,
	GdiObject,
	DrawState,
	WmfCoord,
	WmfReplayCtx,
	WmfHeader,
	ReplayOptions,
} from './emf-types';
import { defaultState, cloneState } from './emf-types';
import { handleWmfDrawRecord } from './wmf-draw-handlers';

// ---------------------------------------------------------------------------
// WMF coordinate helpers (closures over mutable state)
// ---------------------------------------------------------------------------

function createWmfCoord(
	windowOrg: { x: number; y: number },
	windowExt: { cx: number; cy: number },
	canvasW: number,
	canvasH: number,
): WmfCoord {
	return {
		mx: (x: number) => ((x - windowOrg.x) / (windowExt.cx || 1)) * canvasW,
		my: (y: number) => ((y - windowOrg.y) / (windowExt.cy || 1)) * canvasH,
		mw: (w: number) => (w / (windowExt.cx || 1)) * canvasW,
		mh: (h: number) => (h / (windowExt.cy || 1)) * canvasH,
	};
}

// ---------------------------------------------------------------------------
// Main WMF replay
// ---------------------------------------------------------------------------

export function replayWmfRecords(
	view: DataView,
	ctx: CanvasContext,
	header: WmfHeader,
	canvasW: number,
	canvasH: number,
	replayOptions: ReplayOptions = {},
): void {
	const logicalW = header.boundsRight - header.boundsLeft || 1;
	const logicalH = header.boundsBottom - header.boundsTop || 1;

	const windowOrg = { x: header.boundsLeft, y: header.boundsTop };
	const windowExt = { cx: logicalW, cy: logicalH };
	const coord = createWmfCoord(windowOrg, windowExt, canvasW, canvasH);

	const objectTable = new Map<number, GdiObject>();
	// WMF object-creation records carry no explicit index: GDI assigns each new
	// object to the LOWEST currently-free slot, and SELECTOBJECT/DELETEOBJECT
	// reference that slot by number. Metafiles routinely create→select→delete a
	// rotating brush at slot 0, so we must reuse freed slots (a monotonic
	// counter would orphan every reused-slot object and drop its colour).
	const allocObjectSlot = (): number => {
		let slot = 0;
		while (objectTable.has(slot)) {
			slot++;
		}
		return slot;
	};
	const state: DrawState = { ...defaultState(), fontFamilyMap: replayOptions.fontFamilyMap };
	const stateStack: DrawState[] = [];

	const wCtx: WmfReplayCtx = { view, ctx, state, coord };

	let offset = header.headerSize;
	const maxOffset = view.byteLength;
	const maxRecords = replayOptions.maxRecords ?? MAX_RECORDS_DEFAULT;
	let recordCount = 0;

	while (offset + 6 <= maxOffset && recordCount < maxRecords) {
		const recSizeWords = view.getUint32(offset, true);
		const recType = view.getUint16(offset + 4, true);
		const recSize = recSizeWords * 2;

		if (recSize < 6 || offset + recSize > maxOffset) {
			break;
		}
		if (recType === META_EOF) {
			break;
		}
		recordCount++;

		const dataOff = offset + 6;

		// Try draw handler first
		if (handleWmfDrawRecord(wCtx, recType, offset, dataOff, recSize)) {
			offset += recSize;
			continue;
		}

		// State / object records
		switch (recType) {
			case META_SETWINDOWORG:
				if (recSize >= 10) {
					windowOrg.y = view.getInt16(dataOff, true);
					windowOrg.x = view.getInt16(dataOff + 2, true);
				}
				break;
			case META_SETWINDOWEXT:
				if (recSize >= 10) {
					windowExt.cy = view.getInt16(dataOff, true);
					windowExt.cx = view.getInt16(dataOff + 2, true);
				}
				break;
			case META_SAVEDC:
				stateStack.push(cloneState(state));
				break;
			case META_RESTOREDC: {
				const restored = stateStack.pop();
				if (restored) {
					Object.assign(state, restored);
				}
				break;
			}
			case META_SETTEXTCOLOR:
				if (recSize >= 10) {
					state.textColor = readColorRef(view, dataOff);
				}
				break;
			case META_SETBKCOLOR:
				if (recSize >= 10) {
					state.bkColor = readColorRef(view, dataOff);
				}
				break;
			case META_SETBKMODE:
				if (recSize >= 8) {
					state.bkMode = view.getUint16(dataOff, true);
				}
				break;
			case META_SETROP2:
				if (recSize >= 8) {
					state.rop2 = view.getUint16(dataOff, true);
				}
				break;
			case META_SETPOLYFILLMODE:
				if (recSize >= 8) {
					state.polyFillMode = view.getUint16(dataOff, true);
				}
				break;
			case META_SETTEXTALIGN:
				if (recSize >= 8) {
					state.textAlign = view.getUint16(dataOff, true);
				}
				break;
			case META_CREATEPENINDIRECT:
				if (recSize >= 16) {
					const slot = allocObjectSlot();
					objectTable.set(slot, {
						kind: 'pen',
						style: view.getUint16(dataOff, true) & 0xff,
						widthX: view.getInt16(dataOff + 2, true),
						color: readColorRef(view, dataOff + 6),
					});
				}
				break;
			case META_CREATEBRUSHINDIRECT:
				if (recSize >= 14) {
					const slot = allocObjectSlot();
					objectTable.set(slot, {
						kind: 'brush',
						style: view.getUint16(dataOff, true),
						color: readColorRef(view, dataOff + 2),
					});
				}
				break;
			case META_CREATEFONTINDIRECT:
				if (recSize >= 24) {
					let family = '';
					for (let i = 0; i < 32 && dataOff + 14 + i < offset + recSize; i++) {
						const ch = view.getUint8(dataOff + 14 + i);
						if (ch === 0) {
							break;
						}
						family += String.fromCharCode(ch);
					}
					const slot = allocObjectSlot();
					objectTable.set(slot, {
						kind: 'font',
						height: Math.abs(view.getInt16(dataOff, true)),
						weight: view.getInt16(dataOff + 8, true),
						italic: view.getUint8(dataOff + 10) !== 0,
						underline: view.getUint8(dataOff + 11) !== 0,
						strikeOut: view.getUint8(dataOff + 12) !== 0,
						family: family || 'sans-serif',
					});
				}
				break;
			case META_SELECTOBJECT:
				if (recSize >= 8) {
					const obj = objectTable.get(view.getUint16(dataOff, true));
					if (obj) {
						switch (obj.kind) {
							case 'pen':
								state.penStyle = obj.style;
								state.penWidth = obj.widthX;
								state.penColor = obj.color;
								break;
							case 'brush':
								state.brushStyle = obj.style;
								state.brushColor = obj.color;
								break;
							case 'font':
								state.fontHeight = obj.height;
								state.fontWeight = obj.weight;
								state.fontItalic = obj.italic;
								state.fontUnderline = obj.underline;
								state.fontStrikeOut = obj.strikeOut;
								state.fontFamily = obj.family;
								break;
						}
					}
				}
				break;
			case META_DELETEOBJECT:
				if (recSize >= 8) {
					objectTable.delete(view.getUint16(dataOff, true));
				}
				break;
			default:
				break;
		}

		offset += recSize;
	}

	if (recordCount >= maxRecords) {
		console.warn(
			`[emf-converter] WMF record limit reached (${maxRecords}). Output may be incomplete.`,
		);
	}
}
