import { AcGePoint3d } from '@mlightcad/geometry-engine'

import type { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbSystemVariables } from '../database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../database/AcDbSysVarManager'
import {
  ACDB_COMPAREHATCH_MAX,
  ACDB_COMPAREHATCH_MIN,
  ACDB_COMPARERCMARGIN_MAX,
  ACDB_COMPARERCMARGIN_MIN,
  ACDB_COMPARETEXT_MAX,
  ACDB_COMPARETEXT_MIN,
  ACDB_COMPARETOLERANCE_MAX,
  ACDB_COMPARETOLERANCE_MIN,
  acdbIntegerSysVarIfInRange,
  ByLayer,
  DEFAULT_MLEADER_STYLE,
  DEFAULT_MLINE_STYLE,
  DEFAULT_TEXT_STYLE
} from '../misc/AcDbConstants'

/**
 * Stream HEADER section variables into {@link AcDbDatabase}.
 * Expects the filer to be positioned after `(0,SECTION)/(2,HEADER)`.
 * Stops at `(0,ENDSEC)` without consuming pairs belonging to the next section.
 */
export function acdbDxfInHeader(filer: AcDbDxfFiler, db: AcDbDatabase): void {
  while (!filer.atEof) {
    const item = filer.peekItem()
    if (!item) break
    if (Number(item.code) === 0) {
      const name = String(item.value).toUpperCase()
      if (name === 'ENDSEC') {
        filer.readItem()
        break
      }
      // Unexpected object start inside HEADER — stop.
      break
    }

    filer.readItem()
    if (Number(item.code) !== 9) continue

    const varName = String(item.value).toUpperCase()
    applyHeaderVar(filer, db, varName)
  }
}

function applyHeaderVar(
  filer: AcDbDxfFiler,
  db: AcDbDatabase,
  varName: string
): void {
  switch (varName) {
    case '$ACADVER': {
      const v = readHeaderString(filer)
      if (v) db.version = v
      break
    }
    case '$CECOLOR': {
      const n = readHeaderNumber(filer)
      db.cecolor.colorIndex = n ?? 256
      break
    }
    case '$ANGBASE':
      db.angbase = readHeaderNumber(filer) ?? 0
      break
    case '$ANGDIR':
      db.angdir = readHeaderNumber(filer) ?? 0
      break
    case '$AUNITS': {
      const n = readHeaderNumber(filer)
      if (n != null) db.aunits = n
      break
    }
    case '$AUPREC': {
      const n = readHeaderNumber(filer)
      if (n != null) db.auprec = n
      break
    }
    case '$LUNITS': {
      const n = readHeaderNumber(filer)
      if (n != null) db.lunits = n
      break
    }
    case '$LUPREC': {
      const n = readHeaderNumber(filer)
      if (n != null) db.luprec = n
      break
    }
    case '$UNITMODE': {
      const n = readHeaderNumber(filer)
      if (n != null) db.unitmode = n
      break
    }
    case '$MEASUREMENT': {
      const n = readHeaderNumber(filer)
      if (n != null) db.measurement = n
      break
    }
    case '$CELTYPE':
      db.celtype = readHeaderString(filer) || ByLayer
      break
    case '$CETRANSPARENCY': {
      readTransparencyHeaderVar(filer, db, AcDbSystemVariables.CETRANSPARENCY)
      break
    }
    case '$CELTSCALE':
      db.celtscale = readHeaderNumber(filer) ?? 1
      break
    case '$CELWEIGHT': {
      const n = readHeaderNumber(filer)
      if (n != null) db.celweight = n
      break
    }
    case '$LWDISPLAY':
      db.lwdisplay = (readHeaderNumber(filer) ?? 0) !== 0
      break
    case '$TILEMODE':
      db.tilemode = (readHeaderNumber(filer) ?? 1) !== 0
      break
    case '$PSLTSCALE':
      db.psltscale = (readHeaderNumber(filer) ?? 1) !== 0
      break
    case '$CMLSTYLE':
    case 'CMLSTYLE':
      db.cmlstyle = readHeaderString(filer) || DEFAULT_MLINE_STYLE
      break
    case '$CMLSCALE':
    case 'CMLSCALE': {
      const n = readHeaderNumber(filer)
      if (n != null && Number.isFinite(n)) db.cmlscale = n
      break
    }
    case '$CMLEADERSTYLE':
    case 'CMLEADERSTYLE':
      db.cmleaderstyle = readHeaderString(filer) || DEFAULT_MLEADER_STYLE
      break
    case '$HPLAYER':
    case 'HPLAYER':
      db.hplayer = readHeaderString(filer) || '.'
      break
    case '$HPTRANSPARENCY': {
      readTransparencyHeaderVar(filer, db, AcDbSystemVariables.HPTRANSPARENCY)
      break
    }
    case '$LTSCALE':
      db.ltscale = readHeaderNumber(filer) ?? 1
      break
    case '$EXTMAX': {
      const p = readHeaderPoint3d(filer)
      if (p) db.extmax = p
      break
    }
    case '$EXTMIN': {
      const p = readHeaderPoint3d(filer)
      if (p) db.extmin = p
      break
    }
    case '$INSUNITS': {
      const n = readHeaderNumber(filer)
      if (n != null) db.insunits = n
      break
    }
    case '$OSMODE':
      db.osmode = readHeaderNumber(filer) ?? 0
      break
    case '$ORTHOMODE':
      db.orthomode = readHeaderNumber(filer) ?? 0
      break
    case '$COMPAREHATCH': {
      const n = acdbIntegerSysVarIfInRange(
        readHeaderNumber(filer),
        ACDB_COMPAREHATCH_MIN,
        ACDB_COMPAREHATCH_MAX
      )
      if (n != null) db.comparehatch = n
      break
    }
    case '$COMPARERCMARGIN': {
      const n = acdbIntegerSysVarIfInRange(
        readHeaderNumber(filer),
        ACDB_COMPARERCMARGIN_MIN,
        ACDB_COMPARERCMARGIN_MAX
      )
      if (n != null) db.comparercmargin = n
      break
    }
    case '$COMPARETEXT': {
      const n = acdbIntegerSysVarIfInRange(
        readHeaderNumber(filer),
        ACDB_COMPARETEXT_MIN,
        ACDB_COMPARETEXT_MAX
      )
      if (n != null) db.comparetext = n
      break
    }
    case '$COMPARETOLERANCE': {
      const n = acdbIntegerSysVarIfInRange(
        readHeaderNumber(filer),
        ACDB_COMPARETOLERANCE_MIN,
        ACDB_COMPARETOLERANCE_MAX
      )
      if (n != null) db.comparetolerance = n
      break
    }
    case '$PDMODE':
      db.pdmode = readHeaderNumber(filer) ?? 0
      break
    case '$PDSIZE':
      db.pdsize = readHeaderNumber(filer) ?? 0
      break
    case '$TEXTSTYLE':
      db.textstyle = readHeaderString(filer) || DEFAULT_TEXT_STYLE
      break
    case '$DIMSTYLE':
      db.dimstyle = readHeaderString(filer) || DEFAULT_TEXT_STYLE
      break
    case '$CLAYER':
      db.clayer = readHeaderString(filer) || '0'
      break
    case '$HANDSEED': {
      const v = readHeaderString(filer)
      if (v) db.initializeHandleSeed(v)
      break
    }
    default:
      // Skip unknown header value pair(s). Point vars may span multiple codes;
      // consume until the next code 9 or 0.
      skipHeaderValue(filer)
      break
  }
}

function readHeaderString(filer: AcDbDxfFiler): string | undefined {
  const item = filer.readItem()
  if (!item) return undefined
  if (Number(item.code) === 9 || Number(item.code) === 0) {
    filer.pushBackItem(item)
    return undefined
  }
  return String(item.value)
}

function readHeaderNumber(filer: AcDbDxfFiler): number | undefined {
  const item = filer.readItem()
  if (!item) return undefined
  if (Number(item.code) === 9 || Number(item.code) === 0) {
    filer.pushBackItem(item)
    return undefined
  }
  const n = Number(item.value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Reads a transparency header variable (`$CETRANSPARENCY` / `$HPTRANSPARENCY`).
 *
 * Spec-compliant writers (and this library's own `dxfOut`) store these as
 * group-440 32-bit bitfield integers (high byte = method, low byte = alpha).
 * Feeding that integer as a *string* into `AcCmTransparency.fromString`
 * rejects values above 255 and throws "Invalid transparency value!" — so a
 * file written by `dxfOut` could not be re-opened.
 *
 * Dispatch by group code, not by `Number()` heuristics:
 * - **440** → pass as a number so `setVar` takes the `deserialize` path
 * - **anything else** (textual "ByLayer"/"ByBlock"/percentage) → string /
 *   `fromString` path. Do not coerce bare percentages like `"25"` via
 *   `Number()`, which would incorrectly go through `deserialize`.
 * - **missing value** → fall back to `'ByLayer'` (matches prior reader
 *   behavior and AutoCAD's default).
 */
function readTransparencyHeaderVar(
  filer: AcDbDxfFiler,
  db: AcDbDatabase,
  varName: string
): void {
  const item = filer.readItem()
  if (!item || Number(item.code) === 9 || Number(item.code) === 0) {
    if (item) filer.pushBackItem(item)
    AcDbSysVarManager.instance().setVar(varName, 'ByLayer', db)
    return
  }

  const code = Number(item.code)
  const raw = String(item.value).trim()
  if (raw === '') {
    AcDbSysVarManager.instance().setVar(varName, 'ByLayer', db)
    return
  }

  if (code === 440) {
    const n = Number(raw)
    AcDbSysVarManager.instance().setVar(
      varName,
      Number.isFinite(n) ? n : 'ByLayer',
      db
    )
    return
  }

  AcDbSysVarManager.instance().setVar(varName, raw, db)
}

function readHeaderPoint3d(filer: AcDbDxfFiler): AcGePoint3d | undefined {
  let x = 0
  let y = 0
  let z = 0
  let got = false
  while (!filer.atEof) {
    const item = filer.peekItem()
    if (!item) break
    const code = Number(item.code)
    if (code === 9 || code === 0) break
    filer.readItem()
    const n = Number(item.value)
    if (code === 10) {
      x = n
      got = true
    } else if (code === 20) {
      y = n
      got = true
    } else if (code === 30) {
      z = n
      got = true
    }
  }
  return got ? new AcGePoint3d(x, y, z) : undefined
}

function skipHeaderValue(filer: AcDbDxfFiler): void {
  while (!filer.atEof) {
    const item = filer.peekItem()
    if (!item) break
    const code = Number(item.code)
    if (code === 9 || code === 0) break
    filer.readItem()
  }
}
