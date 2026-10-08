import {
  ACCM_DEFAULT_UI_YIELD_BUDGET_MS,
  AcCmUiYieldGate,
  accmYieldForPaint
} from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbDatabase } from '../database/AcDbDatabase'
import {
  type AcDbConversionProgressCallback,
  AcDbDatabaseConverter,
  type AcDbDatabaseConverterConfig,
  type AcDbDatabaseConverterReadOptions
} from '../database/AcDbDatabaseConverter'
import { AcDbDxfDocumentReader } from './AcDbDxfDocumentReader'

/**
 * Progress weights mirror typical open cost: a small PARSE slice, then most of
 * the bar for ENTITY add/render (same idea as the old converter where ENTITY
 * carried the largest step).
 */
const PARSE_START_PCT = 1
const PARSE_END_PCT = 18
const ENTITY_START_PCT = 20
const ENTITY_END_PCT = 98

/**
 * Native DXF → database converter.
 *
 * Streams DXF pairs through {@link AcDbDxfFiler} / {@link AcDbDxfDocumentReader}
 * directly into {@link AcDbDatabase}, avoiding the ParsedDxf JSON intermediate
 * used by `@mlightcad/dxf-json-converter`.
 *
 * Conversion stages: `START → PARSE → ENTITY → END`. The reader fills the
 * database quietly (entity-appended events batched); then the batch flushes so
 * the first draw happens after parse completes. Fonts are loaded on demand by
 * the mtext renderer when a font is first needed.
 *
 * Mid-PARSE byte progress, chunked ENTITY flush, and time-budgeted UI yields
 * keep the status bar / spinner responsive without stalling large files on
 * per-chunk `requestAnimationFrame` waits.
 */
export class AcDbNativeDxfConverter extends AcDbDatabaseConverter<null> {
  constructor(config: AcDbDatabaseConverterConfig = {}) {
    super({
      useWorker: false,
      ...config
    })
  }

  override async read(
    data: ArrayBuffer,
    db: AcDbDatabase,
    options: AcDbDatabaseConverterReadOptions = {}
  ) {
    const {
      minimumChunkSize = 10,
      progress,
      encoding
    } = options

    this.progress = progress

    const emit = async (
      percentage: number,
      stage: Parameters<AcDbConversionProgressCallback>[1],
      status: Parameters<AcDbConversionProgressCallback>[2],
      stageData?: unknown
    ) => {
      if (!progress) return
      await progress(percentage, stage, status, stageData)
    }

    await emit(0, 'START', 'START')
    await emit(PARSE_START_PCT, 'PARSE', 'START')
    // Let the open-file overlay paint before sync-heavy parse work (once).
    await accmYieldForPaint()

    // Suppress entityAppended (and related) until parse finishes so the viewer
    // does not worldDraw mid-stream while the open-file progress bar is still
    // in PARSE.
    db.beginEventBatch()
    let batchOpen = true
    try {
      const filer = AcDbDxfFiler.fromBuffer(data, {
        database: db,
        encoding
      })
      const totalBytes = data.byteLength
      let lastParsePct = PARSE_START_PCT

      const reader = new AcDbDxfDocumentReader(db, {
        entityBatchSize: Math.max(1, minimumChunkSize || 200),
        yieldBudgetMs: ACCM_DEFAULT_UI_YIELD_BUDGET_MS,
        totalBytes,
        onProgress: async ratio => {
          const pct = Math.min(
            PARSE_END_PCT - 1,
            PARSE_START_PCT +
              Math.floor(ratio * (PARSE_END_PCT - PARSE_START_PCT))
          )
          if (pct <= lastParsePct) return
          lastParsePct = pct
          await emit(pct, 'PARSE', 'IN-PROGRESS')
        }
      })
      const result = await reader.read(filer)

      await emit(PARSE_END_PCT, 'PARSE', 'END', {
        unknownEntityCount: result.unknownEntityCount
      })

      await emit(ENTITY_START_PCT, 'ENTITY', 'START')
      const chunkSize = Math.max(1, minimumChunkSize || 200)
      let lastEntityPct = ENTITY_START_PCT
      const yieldGate = new AcCmUiYieldGate(ACCM_DEFAULT_UI_YIELD_BUDGET_MS)
      // Flush queued entityAppended in chunks while advancing most of the
      // open-file progress bar.
      await db.endEventBatchChunked(chunkSize, async (flushed, total) => {
        const pct =
          total <= 0
            ? ENTITY_END_PCT
            : Math.min(
                ENTITY_END_PCT,
                ENTITY_START_PCT +
                  Math.floor(
                    (flushed / total) * (ENTITY_END_PCT - ENTITY_START_PCT)
                  )
              )
        if (pct > lastEntityPct) {
          lastEntityPct = pct
          await emit(pct, 'ENTITY', 'IN-PROGRESS')
        }
        // Time-budgeted single-frame yield — not per progress percent.
        await yieldGate.maybeYield()
      })
      batchOpen = false
      await emit(ENTITY_END_PCT, 'ENTITY', 'END')

      await emit(100, 'END', 'END')
    } catch (error) {
      if (batchOpen) {
        db.endEventBatch()
      }
      throw error
    }
  }

  protected override async parse(_data: ArrayBuffer) {
    return { model: null, data: { unknownEntityCount: 0 } }
  }
}
