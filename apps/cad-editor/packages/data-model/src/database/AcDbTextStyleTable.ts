import { AcDbFontNameCollector } from '../converter/AcDbFontNameCollector'
import { DEFAULT_TEXT_STYLE } from '../misc/AcDbConstants'
import { AcDbDatabase } from './AcDbDatabase'
import { AcDbSymbolTable } from './AcDbSymbolTable'
import { AcDbTextStyleTableRecord } from './AcDbTextStyleTableRecord'

/**
 * Symbol table for text style table records.
 *
 * This class manages text style table records which represent text styles
 * within a drawing database. Text styles define the appearance and properties
 * of text entities, including font, size, and other formatting options.
 *
 * The STYLE table may also contain unnamed shape file definition entries
 * ({@link AcDbTextStyleTableRecord.isShapeFile}). Use {@link shapeFiles}
 * to access those entries separately from named text styles.
 *
 * @example
 * ```typescript
 * const textStyleTable = new AcDbTextStyleTable(database);
 * const fonts = textStyleTable.fonts;
 * console.log('Available fonts:', fonts);
 * ```
 */
export class AcDbTextStyleTable extends AcDbSymbolTable<AcDbTextStyleTableRecord> {
  /**
   * Creates a new AcDbTextStyleTable instance.
   *
   * @param db - The database this text style table belongs to
   *
   * @example
   * ```typescript
   * const textStyleTable = new AcDbTextStyleTable(database);
   * ```
   */
  constructor(db: AcDbDatabase) {
    super(db)
  }

  protected override get dxfEntryCount() {
    return this._recordsById.size
  }

  /**
   * Resolves a text style table record using AutoCAD-style fallbacks.
   *
   * Lookup order:
   * 1. Exact style name on the entity
   * 2. Current `$TEXTSTYLE` system variable
   * 3. Default style names (`Standard`, `STANDARD`)
   * 4. Case-insensitive match for each candidate above
   * 5. First available style in the table
   *
   * Ensures a default text style exists before resolving so entities can be
   * rendered while a drawing is still being converted.
   */
  resolveAt(name?: string): AcDbTextStyleTableRecord | undefined {
    this.database.ensureTextStyleDefaults()

    const candidates: string[] = []
    const addCandidate = (value?: string) => {
      const trimmed = value?.trim()
      if (trimmed && !candidates.includes(trimmed)) {
        candidates.push(trimmed)
      }
    }

    addCandidate(name)
    addCandidate(this.database.textstyle)
    addCandidate(DEFAULT_TEXT_STYLE)
    addCandidate('STANDARD')

    for (const candidate of candidates) {
      const exact = this.getAt(candidate)
      if (exact) {
        return exact
      }

      const normalizedCandidate = candidate.toUpperCase()
      for (const record of this.newIterator()) {
        if (record.name.toUpperCase() === normalizedCandidate) {
          return record
        }
      }
    }

    return this.newIterator().next().value ?? undefined
  }

  /**
   * Gets all shape file definition records stored in the STYLE table.
   *
   * Shape definitions are STYLE entries with {@link AcDbTextStyleTableRecord.isShapeFile}
   * set (standard flag bit 1). They typically have an empty name and describe SHX shape
   * files used by complex linetypes and similar features??ot text styles.
   *
   * These records are stored by object id only and are not returned by name-based lookup
   * ({@link getAt}) or the default {@link newIterator} iteration.
   *
   * @returns All shape file definition records in this table
   *
   * @example
   * ```typescript
   * for (const shape of textStyleTable.shapeFileRecords) {
   *   console.log('Shape file:', shape.fileName);
   * }
   * ```
   */
  get shapeFiles(): AcDbTextStyleTableRecord[] {
    return this.newIterator(true)
      .toArray()
      .filter(record => record.isShapeFile)
  }

  /**
   * Gets the unique font file names referenced by named text styles in this table.
   *
   * Iterates {@link newIterator named text style records} only??hape file definitions
   * ({@link shapeFiles}) are excluded.
   *
   * For each record, both {@link AcDbTextStyleTableRecord.fileName | fileName} (primary
   * font / SHX file, DXF group 3) and
   * {@link AcDbTextStyleTableRecord.bigFontFileName | bigFontFileName} (big-font file
   * for CJK and similar, DXF group 4) are collected when non-empty.
   *
   * Each file name is normalized before deduplication:
   * - File extension is stripped (e.g. `Arial.ttf` ??`arial`)
   * - Result is lowercased
   *
   * @returns Sorted order is not guaranteed; array contains each normalized name at most once
   *
   * @example
   * ```typescript
   * const fonts = textStyleTable.fonts;
   * // ['arial', 'gbcbig', 'simhei']
   * ```
   */
  get fonts() {
    const fonts = new Set<string>()
    for (const item of this.newIterator()) {
      const fileName = AcDbFontNameCollector.normalizeFontFileName(
        item.fileName
      )
      if (fileName) {
        fonts.add(fileName)
      }
      const bigFontFileName = AcDbFontNameCollector.normalizeFontFileName(
        item.bigFontFileName
      )
      if (bigFontFileName) {
        fonts.add(bigFontFileName)
      }
    }
    return Array.from(fonts)
  }
}