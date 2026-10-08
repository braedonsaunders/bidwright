/**
 * EMF GDI state record handlers: save/restore and drawing-mode settings.
 *
 * Coordinate/transform records are delegated to ./emf-gdi-transform-handlers.
 * Object creation/selection records are delegated to ./emf-gdi-object-handlers.
 */

import { reapplyClipRegion } from './emf-clip-region';
import { readColorRef } from './emf-color-helpers';
import { emfLog } from './emf-logging';
import {
	EMR_SAVEDC,
	EMR_RESTOREDC,
	EMR_SETTEXTCOLOR,
	EMR_SETBKCOLOR,
	EMR_SETBKMODE,
	EMR_SETPOLYFILLMODE,
	EMR_SETROP2,
	EMR_SETSTRETCHBLTMODE,
	EMR_SETMITERLIMIT,
	EMR_SETTEXTALIGN,
} from './emf-constants';
import { handleEmfObjectRecord } from './emf-gdi-object-handlers';
import { handleEmfTransformRecord } from './emf-gdi-transform-handlers';
import type { EmfGdiReplayCtx } from './emf-types';
import { cloneState } from './emf-types';

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleEmfGdiStateRecord(
	rCtx: EmfGdiReplayCtx,
	recType: number,
	_offset: number,
	dataOff: number,
	recSize: number,
): boolean {
	// Delegate to coordinate / world-transform handler
	if (handleEmfTransformRecord(rCtx, recType, dataOff, recSize)) {
		return true;
	}

	// Delegate to object creation / selection / deletion handler
	if (handleEmfObjectRecord(rCtx, recType, dataOff, recSize)) {
		return true;
	}

	const { ctx, view, state } = rCtx;

	switch (recType) {
		// ---- save / restore ----
		case EMR_SAVEDC: {
			// Unwind clip saves so the DC save() captures the pre-clip canvas
			// state, snapshot the tracked clip region, then re-apply the clip on
			// top of the fresh DC bracket.
			while (rCtx.clipSaveDepth > 0) {
				ctx.restore();
				rCtx.clipSaveDepth--;
			}
			rCtx.clipStack ??= [];
			rCtx.clipStack.push({
				region: rCtx.clipRegion ?? null,
				untracked: rCtx.clipUntracked ?? false,
			});
			rCtx.stateStack.push(cloneState(state));
			ctx.save();
			if (rCtx.clipUntracked) {
				emfLog('EMR_SAVEDC: untracked clip (SELECTCLIPPATH) cannot be re-applied — dropped');
				rCtx.clipUntracked = false;
				rCtx.clipRegion = null;
			} else if (rCtx.clipRegion) {
				reapplyClipRegion(rCtx, rCtx.clipRegion);
			}
			return true;
		}
		case EMR_RESTOREDC: {
			if (recSize >= 12) {
				while (rCtx.clipSaveDepth > 0) {
					ctx.restore();
					rCtx.clipSaveDepth--;
				}
				// Positive values address a 1-based save level; negative values are
				// relative to the current level (-1 = most recent SaveDC). Convert to
				// the 1-based level so `restored` pops the addressed snapshot itself.
				let rel = view.getInt32(dataOff, true);
				if (rel < 0) {
					rel = rCtx.stateStack.length + rel + 1;
				}
				while (rCtx.stateStack.length > rel && rCtx.stateStack.length > 0) {
					rCtx.stateStack.pop();
					rCtx.clipStack?.pop();
					ctx.restore();
				}
				const restored = rCtx.stateStack.pop();
				if (restored) {
					const clipSnapshot = rCtx.clipStack?.pop();
					Object.assign(state, restored);
					ctx.restore();
					// Restore the clip that was active when the DC was saved. An
					// untracked snapshot cannot be rebuilt; leave the clip cleared.
					rCtx.clipRegion = clipSnapshot?.region ?? null;
					rCtx.clipUntracked = false;
					if (rCtx.clipRegion) {
						reapplyClipRegion(rCtx, rCtx.clipRegion);
					}
				}
			}
			return true;
		}

		// ---- drawing mode / color settings ----
		case EMR_SETTEXTCOLOR: {
			if (recSize >= 12) {
				state.textColor = readColorRef(view, dataOff);
			}
			return true;
		}
		case EMR_SETBKCOLOR: {
			if (recSize >= 12) {
				state.bkColor = readColorRef(view, dataOff);
			}
			return true;
		}
		case EMR_SETBKMODE: {
			if (recSize >= 12) {
				state.bkMode = view.getUint32(dataOff, true);
			}
			return true;
		}
		case EMR_SETPOLYFILLMODE: {
			if (recSize >= 12) {
				state.polyFillMode = view.getUint32(dataOff, true);
			}
			return true;
		}
		case EMR_SETROP2: {
			if (recSize >= 12) {
				state.rop2 = view.getUint32(dataOff, true);
			}
			return true;
		}
		case EMR_SETSTRETCHBLTMODE:
		case EMR_SETMITERLIMIT:
		case EMR_SETTEXTALIGN: {
			if (recType === EMR_SETTEXTALIGN && recSize >= 12) {
				state.textAlign = view.getUint32(dataOff, true);
			}
			return true;
		}

		default:
			return false;
	}
}
