import {
  AcCmColor,
  AcDbBatchProcessing,
  AcDbBlockScaling,
  AcDbBlockTableRecord,
  AcDbConversionProgressCallback,
  acdbCreateWorkerApi,
  AcDbDatabase,
  AcDbDatabaseConverter,
  AcDbDatabaseConverterConfig,
  AcDbDimStyleTableRecord,
  AcDbDimStyleTableRecordAttrs,
  AcDbDimTextHorizontal,
  AcDbDimTextVertical,
  AcDbDimVerticalJustification,
  AcDbDimZeroSuppression,
  AcDbDimZeroSuppressionAngular,
  AcDbEntity,
  acdbHexStringsToBytes,
  acdbImportDynBlockMetadata,
  AcDbLayerFilterPersistSource,
  AcDbLayerTableRecord,
  AcDbLayout,
  AcDbLinetypeTableRecord,
  AcDbLinetypeTableRecordAttrs,
  acdbNormalizeExtensionDictionaryId,
  AcDbObject,
  AcDbOpenDatabaseError,
  AcDbParsingTaskResult,
  AcDbRasterImageDef,
  AcDbXrecord,
  AcDbResultBuffer,
  acdbReadLayerFilterTree,
  AcDbSymbolTableRecord,
  AcDbTextStyleTableRecord,
  AcDbTextStyleTableRecordAttrs,
  AcDbViewportTableRecord,
  AcGiDefaultLightingType,
  AcGiOrthographicType,
  AcGiRenderMode,
  ByLayer,
  DEFAULT_MLEADER_STYLE,
  DEFAULT_TEXT_STYLE,
  VPORT_FALLBACK_CENTER_2D,
  VPORT_FALLBACK_LLC,
  VPORT_FALLBACK_URC,
  VPORT_FALLBACK_VIEW_DIR,
  VPORT_FALLBACK_VIEW_TARGET
} from '@mlightcad/data-model'
import {
  DwgCommonObject,
  DwgCommonTableEntry,
  DwgDatabase,
  DwgEntity
} from '@mlightcad/libredwg-web'

import { AcDbEntityConverter } from './AcDbEntitiyConverter'
import { AcDbObjectConverter } from './AcDbObjectConverter'

const MODEL_SPACE = '*MODEL_SPACE'

/**
 * Database converter for DWG files based on [libredwg-web](https://github.com/mlight-lee/libredwg-web).
 */
export class AcDbLibreDwgConverter extends AcDbDatabaseConverter<DwgDatabase> {
  constructor(config: AcDbDatabaseConverterConfig = {}) {
    super(config)
    this.config.useWorker = true
    if (!this.config.parserWorkerUrl) {
      this.config.parserWorkerUrl = '/assets/libredwg-parser-worker.js'
    }
  }

  protected async parse(data: ArrayBuffer, timeout?: number) {
    const effectiveConfig = this.config
    const resolvedTimeout = this.getParserWorkerTimeout(data, timeout)

    if (effectiveConfig.useWorker && effectiveConfig.parserWorkerUrl) {
      const api = acdbCreateWorkerApi({
        workerUrl: effectiveConfig.parserWorkerUrl,
        timeout: resolvedTimeout,
        // One concurrent worker needed for parser
        maxConcurrentWorkers: 1
      })
      const result = await api.execute<
        ArrayBuffer,
        AcDbParsingTaskResult<DwgDatabase>
      >(data)
      // Release worker
      api.destroy()
      AcDbOpenDatabaseError.throwOnWorkerParseFailure(result)
      return result.data!
    } else {
      throw new Error('dwg converter can run in web worker only!')
    }
  }

  protected processLineTypes(model: DwgDatabase, db: AcDbDatabase) {
    const lineTypes = model.tables.LTYPE.entries
    lineTypes.forEach(item => {
      const attrs: AcDbLinetypeTableRecordAttrs = {
        name: item.name,
        description: item.description,
        standardFlag: item.standardFlag,
        totalPatternLength: item.totalPatternLength,
        pattern: item.pattern
      }
      const record = new AcDbLinetypeTableRecord(attrs)
      this.processCommonTableEntryAttrs(item, record)
      db.tables.linetypeTable.add(record)
    })
  }

  protected processTextStyles(model: DwgDatabase, db: AcDbDatabase) {
    const textStyles = model.tables.STYLE.entries
    textStyles.forEach(item => {
      const attrs: AcDbTextStyleTableRecordAttrs = {
        name: item.name,
        standardFlag: item.standardFlag,
        fixedTextHeight: item.fixedTextHeight,
        widthFactor: item.widthFactor,
        obliqueAngle: item.obliqueAngle,
        textGenerationFlag: item.textGenerationFlag,
        lastHeight: item.lastHeight,
        font: item.font,
        bigFont: item.bigFont,
        extendedFont: (item as { extendedFont?: string }).extendedFont
      }
      const record = new AcDbTextStyleTableRecord(attrs)
      this.processCommonTableEntryAttrs(item, record)
      db.tables.textStyleTable.add(record)
    })
    db.ensureTextStyleDefaults()
  }

  protected processDimStyles(model: DwgDatabase, db: AcDbDatabase) {
    const dimStyles = model.tables.DIMSTYLE.entries
    dimStyles.forEach(item => {
      const attrs: AcDbDimStyleTableRecordAttrs = {
        name: item.name,
        ownerId: item.ownerHandle,
        dimpost: item.DIMPOST || '',
        dimapost: item.DIMAPOST || '',
        dimscale: item.DIMSCALE,
        dimasz: item.DIMASZ,
        dimexo: item.DIMEXO,
        dimdli: item.DIMDLI,
        dimexe: item.DIMEXE,
        dimrnd: item.DIMRND,
        dimdle: item.DIMDLE,
        dimtp: item.DIMTP,
        dimtm: item.DIMTM,
        dimtxt: item.DIMTXT,
        dimcen: item.DIMCEN,
        dimtsz: item.DIMTSZ,
        dimaltf: item.DIMALTF,
        dimlfac: item.DIMLFAC,
        dimtvp: item.DIMTVP,
        dimtfac: item.DIMTFAC,
        dimgap: item.DIMGAP,
        dimaltrnd: item.DIMALTRND,
        dimtol: item.DIMTOL == null || item.DIMTOL == 0 ? 0 : 1,
        dimlim: item.DIMLIM == null || item.DIMLIM == 0 ? 0 : 1,
        dimtih: item.DIMTIH == null || item.DIMTIH == 0 ? 0 : 1,
        dimtoh: item.DIMTOH == null || item.DIMTOH == 0 ? 0 : 1,
        dimse1: item.DIMSE1 == null || item.DIMSE1 == 0 ? 0 : 1,
        dimse2: item.DIMSE2 == null || item.DIMSE2 == 0 ? 0 : 1,
        dimtad: item.DIMTAD as unknown as AcDbDimTextVertical.Center,
        dimzin: item.DIMZIN as unknown as AcDbDimZeroSuppression.Feet,
        dimazin: item.DIMAZIN as unknown as AcDbDimZeroSuppressionAngular.None,
        dimalt: item.DIMALT,
        dimaltd: item.DIMALTD,
        dimtofl: item.DIMTOFL,
        dimsah: item.DIMSAH,
        dimtix: item.DIMTIX,
        dimsoxd: item.DIMSOXD,
        dimclrd: item.DIMCLRD,
        dimclre: item.DIMCLRE,
        dimclrt: item.DIMCLRT,
        dimadec: item.DIMADEC || 0,
        dimunit: item.DIMUNIT || 2,
        dimdec: item.DIMDEC,
        dimtdec: item.DIMTDEC,
        dimaltu: item.DIMALTU,
        dimalttd: item.DIMALTTD,
        dimaunit: item.DIMAUNIT,
        dimfrac: item.DIMFRAC,
        dimlunit: item.DIMLUNIT,
        dimdsep: item.DIMDSEP || '.',
        dimtmove: item.DIMTMOVE || 0,
        dimjust: item.DIMJUST as unknown as AcDbDimTextHorizontal.Center,
        dimsd1: item.DIMSD1,
        dimsd2: item.DIMSD2,
        dimtolj: item.DIMTOLJ as unknown as AcDbDimVerticalJustification.Bottom,
        dimtzin: item.DIMTZIN as unknown as AcDbDimZeroSuppression.Feet,
        dimaltz: item.DIMALTZ as unknown as AcDbDimZeroSuppression.Feet,
        dimalttz: item.DIMALTTZ as unknown as AcDbDimZeroSuppression.Feet,
        dimfit: item.DIMFIT || 0,
        dimupt: item.DIMUPT,
        dimatfit: item.DIMATFIT,
        dimtxsty: DEFAULT_TEXT_STYLE, // TODO: Set correct value
        dimldrblk: '', // TODO: Set correct value
        dimblk: item.DIMBLK || '', // TODO: Set correct value
        dimblk1: item.DIMBLK1 || '', // TODO: Set correct value
        dimblk2: item.DIMBLK2 || '', // TODO: Set correct value
        dimlwd: item.DIMLWD,
        dimlwe: item.DIMLWE
      }
      const record = new AcDbDimStyleTableRecord(attrs)
      this.processCommonTableEntryAttrs(item, record)
      db.tables.dimStyleTable.add(record)
    })
  }

  protected processLayers(model: DwgDatabase, db: AcDbDatabase) {
    const layers = model.tables.LAYER.entries
    layers.forEach(item => {
      const color = new AcCmColor()
      this.applyLibreLayerColor(color, item)
      const record = new AcDbLayerTableRecord({
        name: item.name,
        standardFlags: item.standardFlag,
        linetype: item.lineType,
        lineWeight: item.lineweight,
        isOff: item.off,
        color: color,
        isPlottable: item.plotFlag != 0
      })
      this.processCommonTableEntryAttrs(item, record)
      db.tables.layerTable.add(record)
    })
  }

  /**
   * Maps a libredwg-web {@link DwgLayerTableEntry} colour onto {@link AcCmColor}.
   *
   * `libredwg-web` `convertLayer` leaves `colorIndex` at the ByLayer sentinel
   * **256** for CMC method `0xC2` while storing the real CMC RGB in `color`.
   * Layer colours cannot be ByLayer — treating 256 as ByLayer washes legend
   * solid fills white (same failure mode as dwg-converter's Index/256 bug).
   */
  private applyLibreLayerColor(
    target: AcCmColor,
    item: {
      colorIndex?: number
      color?: number
      colorName?: string
    }
  ) {
    const aci = item.colorIndex
    const rgb = item.color

    // ACI 1–255 wins. Check ByBlock (0) before the RGB fallback: libredwg's
    // convertLayer defaults `color` to 0xffffff even for the 0xc3/ByBlock path,
    // so treating any finite rgb first would mis-map ByBlock layers to white.
    if (aci != null && aci >= 1 && aci <= 255) {
      target.colorIndex = aci
    } else if (aci === 0) {
      target.colorIndex = 0
    } else if (rgb != null && Number.isFinite(rgb)) {
      // colorIndex 256 (or absent): CMC 0xC2 left the real RGB in `color`.
      target.setRGBValue(rgb & 0xffffff)
    } else {
      target.colorIndex = 256
    }

    if (item.colorName) {
      target.colorName = item.colorName
    }
  }

  protected processViewports(model: DwgDatabase, db: AcDbDatabase) {
    const viewports = model.tables.VPORT.entries
    viewports.forEach(item => {
      const record = new AcDbViewportTableRecord()
      // Keep the record TEMP while applying attrs. Assigning the DWG handle
      // first makes assertOpenForWrite consult workingDatabase and abort
      // conversion when it is unset (same fix as AcDbDwgConverter).
      if (item.circleSides) {
        record.circleSides = item.circleSides
      }
      record.standardFlag = item.standardFlag
      record.center.copy(item.center ?? VPORT_FALLBACK_CENTER_2D)
      record.lowerLeftCorner.copy(item.lowerLeftCorner ?? VPORT_FALLBACK_LLC)
      record.upperRightCorner.copy(item.upperRightCorner ?? VPORT_FALLBACK_URC)
      if (item.snapBasePoint) {
        record.snapBase.copy(item.snapBasePoint)
      }
      if (item.snapRotationAngle) {
        record.snapAngle = item.snapRotationAngle
      }
      if (item.snapSpacing) {
        record.snapIncrements.copy(item.snapSpacing)
      }
      if (item.majorGridLines) {
        record.gridMajor = item.majorGridLines
      }
      if (item.gridSpacing) {
        record.gridIncrements.copy(item.gridSpacing)
      }
      if (item.backgroundObjectId) {
        record.backgroundObjectId = item.backgroundObjectId
      }

      record.gsView.center.copy(item.center ?? VPORT_FALLBACK_CENTER_2D)
      record.gsView.viewDirectionFromTarget.copy(
        item.viewDirectionFromTarget ?? VPORT_FALLBACK_VIEW_DIR
      )
      record.gsView.viewTarget.copy(
        item.viewTarget ?? VPORT_FALLBACK_VIEW_TARGET
      )
      if (item.lensLength) {
        record.gsView.lensLength = item.lensLength
      }
      if (item.frontClippingPlane) {
        record.gsView.frontClippingPlane = item.frontClippingPlane
      }
      if (item.backClippingPlane) {
        record.gsView.backClippingPlane = item.backClippingPlane
      }
      if (item.viewHeight) {
        record.gsView.viewHeight = item.viewHeight
      }
      const aspectRatio = item.aspectRatio
      if (
        aspectRatio != null &&
        Number.isFinite(aspectRatio) &&
        aspectRatio > 0
      ) {
        record.gsView.aspectRatio = aspectRatio
      }
      if (item.viewTwistAngle) {
        record.gsView.viewTwistAngle = item.viewTwistAngle
      }
      if (item.frozenLayers) {
        record.gsView.frozenLayers = item.frozenLayers
      }
      if (item.styleSheet) {
        record.gsView.styleSheet = item.styleSheet
      }
      if (item.renderMode) {
        record.gsView.renderMode = item.renderMode as unknown as AcGiRenderMode
      }
      if (item.viewMode) {
        record.gsView.viewMode = item.viewMode
      }
      if (item.ucsIconSetting) {
        record.gsView.ucsIconSetting = item.ucsIconSetting
      }
      if (item.ucsOrigin) {
        record.gsView.ucsOrigin.copy(item.ucsOrigin)
      }
      if (item.ucsXAxis) {
        record.gsView.ucsXAxis.copy(item.ucsXAxis)
      }
      if (item.ucsYAxis) {
        record.gsView.ucsYAxis.copy(item.ucsYAxis)
      }
      if (item.orthographicType) {
        record.gsView.orthographicType =
          item.orthographicType as unknown as AcGiOrthographicType
      }
      if (item.shadePlotSetting) {
        record.gsView.shadePlotSetting = item.shadePlotSetting
      }
      if (item.shadePlotObjectId) {
        record.gsView.shadePlotObjectId = item.shadePlotObjectId
      }
      if (item.visualStyleObjectId) {
        record.gsView.visualStyleObjectId = item.visualStyleObjectId
      }
      if (item.isDefaultLightingOn) {
        record.gsView.isDefaultLightingOn = item.isDefaultLightingOn
      }
      if (item.defaultLightingType) {
        record.gsView.defaultLightingType =
          item.defaultLightingType as unknown as AcGiDefaultLightingType
      }
      if (item.brightness) {
        record.gsView.brightness = item.brightness
      }
      if (item.contrast) {
        record.gsView.contrast = item.contrast
      }
      if (item.ambientColor) {
        record.gsView.ambientColor = item.ambientColor
      }
      this.processCommonTableEntryAttrs(item, record)
      db.tables.viewportTable.add(record)
    })
  }

  protected processBlockTables(model: DwgDatabase, db: AcDbDatabase) {
    const btrs = model.tables.BLOCK_RECORD.entries
    btrs.forEach(btr => {
      let dbBlock = db.tables.blockTable.getAt(btr.name)
      if (!dbBlock) {
        dbBlock = new AcDbBlockTableRecord()
        // Assign handle last so setAttr stays on a TEMP record (avoids
        // workingDatabase lookup while the BTR is still unbound).
        dbBlock.name = btr.name
        dbBlock.ownerId = btr.ownerHandle
        dbBlock.layoutId = btr.layout
        // Strip AutoCAD-internal Resolved/Referenced bits — converters do not
        // bind xref geometry, so those bits must not hide unresolved xrefs.
        dbBlock.flags = AcDbBlockTableRecord.sanitizeImportedFlags(
          btr.flags ?? 0
        )
        dbBlock.blockInsertUnits = btr.insertionUnits
        dbBlock.explodability = btr.explodability
        dbBlock.blockScaling = btr.scalability as AcDbBlockScaling
        dbBlock.objectId = btr.handle
        db.tables.blockTable.add(dbBlock)
      }
      // Always sync PreviewIcon (DXF/DWG group 310) — including when the BTR
      // already existed (e.g. lazily created model/paper space).
      if (btr.bmpPreview) {
        dbBlock.previewIcon = acdbHexStringsToBytes([btr.bmpPreview])
      }
      dbBlock.origin.copy(btr.basePoint)

      // Don't process entities in block space until other blocks are processed
      if (!dbBlock.isModelSapce && btr.entities && btr.entities.length > 0) {
        this.processEntitiesInBlock(btr.entities, dbBlock)
      }
    })
  }

  protected processBlocks(_model: DwgDatabase, _db: AcDbDatabase) {
    // Do nothing because entities are already processsed in method processBlockTables
  }

  private async processEntitiesInBlock(
    entities: DwgEntity[],
    blockTableRecord: AcDbBlockTableRecord
  ) {
    const converter = new AcDbEntityConverter()
    const entityCount = entities.length
    const dbEntities: AcDbEntity[] = []
    for (let i = 0; i < entityCount; i++) {
      const entity = entities[i]
      const dbEntity = converter.convert(entity)
      if (dbEntity) {
        dbEntities.push(dbEntity)
      }
    }
    // Use batch append to improve performance
    blockTableRecord.appendEntity(dbEntities)
  }

  /**
   * Breaks up the work into smaller chunks that are executed asynchronously. This is often referred to
   * as "batch processing" or "cooperative multitasking," where the time-consuming task is broken into
   * smaller pieces and executed in small intervals to allow the UI to remain responsive.
   */
  protected async processEntities(
    model: DwgDatabase,
    db: AcDbDatabase,
    minimumChunkSize: number,
    startPercentage: { value: number },
    progress?: AcDbConversionProgressCallback
  ) {
    const converter = new AcDbEntityConverter()

    // Get all of entities in model space
    let entities: DwgEntity[] = []
    model.tables.BLOCK_RECORD.entries.forEach(btr => {
      if (this.isModelSpace(btr.name)) entities = btr.entities
    })

    // Create an instance of AcDbBatchProcessing
    const entityCount = entities.length
    const batchProcessor = new AcDbBatchProcessing(
      entityCount,
      100 - startPercentage.value,
      minimumChunkSize
    )
    // Groups entities by their `type` property and flattens the result into a single array.
    if (this.config.convertByEntityType) {
      entities = this.groupAndFlattenByType(entities)
    }

    // Process the ordered entities in chunks
    const blockTableRecord = db.tables.blockTable.modelSpace
    await batchProcessor.processChunk(async (start, end) => {
      // Logic for processing each chunk of entities
      const dbEntities: AcDbEntity[] = []
      for (let i = start; i < end; i++) {
        const entity = entities[i]
        const dbEntity = converter.convert(entity)
        if (dbEntity) {
          dbEntities.push(dbEntity)
        }
      }
      // Use batch append to improve performance
      blockTableRecord.appendEntity(dbEntities)

      // Update progress
      if (progress) {
        let percentage =
          startPercentage.value +
          (end / entityCount) * (100 - startPercentage.value)
        if (percentage > 100) percentage = 100
        await progress(percentage, 'ENTITY', 'IN-PROGRESS')
      }
    })
  }

  protected processClasses(model: DwgDatabase, db: AcDbDatabase) {
    if (!model.classes?.length) {
      return
    }
    db.classes = model.classes.map(entry => ({
      name: entry.dxfName,
      cppClassName: entry.cppName,
      appName: entry.appName,
      proxyFlag: entry.capabilitiesFlag,
      instanceCount: entry.instanceCount,
      wasProxy: entry.wasAProxyFlag,
      isEntity: entry.isAnEntityFlag
    }))
  }

  protected processHeader(model: DwgDatabase, db: AcDbDatabase) {
    const thumbnail = model.thumbnailImage
    if (thumbnail?.length) {
      db.thumbnailImage = thumbnail
    }

    const header = model.header
    // Color index 256 is 'ByLayer'
    if (header.CECOLOR) {
      if (header.CECOLOR.index >= 0 && header.CECOLOR.index <= 256) {
        db.cecolor.colorIndex = header.CECOLOR.index
      } else {
        db.cecolor.setRGBValue(header.CECOLOR.rgb)
      }
    }
    db.angbase = header.ANGBASE ?? 0
    db.angdir = header.ANGDIR ?? 0
    db.aunits = header.AUNITS ?? 0
    if (header.AUPREC != null) db.auprec = header.AUPREC
    if (header.LUNITS != null) db.lunits = header.LUNITS
    if (header.LUPREC != null) db.luprec = header.LUPREC
    if (header.UNITMODE != null) db.unitmode = header.UNITMODE
    if (header.MEASUREMENT != null) db.measurement = header.MEASUREMENT
    db.celtype = header.CELTYPE ?? ByLayer
    db.celtscale = header.CELTSCALE ?? 1
    db.ltscale = header.LTSCALE ?? 1
    if (header.EXTMAX!) db.extmax = header.EXTMAX
    if (header.EXTMIN) db.extmin = header.EXTMIN
    // Initial value of INSUNITS:	1 (imperial) or 4 (metric)
    db.insunits = header.INSUNITS ?? 1
    db.pdmode = header.PDMODE ?? 0
    db.pdsize = header.PDSIZE ?? 0.0
    db.textstyle = header.TEXTSTYLE ?? DEFAULT_TEXT_STYLE
    const cmleaderStyle =
      this.normalizeHeaderStringValue(
        (header as { CMLEADERSTYLE?: string }).CMLEADERSTYLE
      ) ?? DEFAULT_MLEADER_STYLE
    db.cmleaderstyle = cmleaderStyle
  }

  private processCommonTableEntryAttrs(
    entry: DwgCommonTableEntry,
    dbEntry: AcDbSymbolTableRecord
  ) {
    dbEntry.name = entry.name
    dbEntry.objectId = entry.handle
    if (entry.ownerHandle != null) {
      dbEntry.ownerId = entry.ownerHandle
    }
  }

  protected processObjects(model: DwgDatabase, db: AcDbDatabase) {
    this.processLayouts(model, db)
    this.processImageDefs(model, db)
    this.processLayerFilters(model, db)
    this.processLayerIndexes(model, db)
    this.processLayerFilterTree(model, db)
    this.processMLeaderStyles(model, db)
    this.processXrecords(model, db)
    this.processDynBlockMetadata(model, db)
  }

  /**
   * Imports extension dictionaries and (when present) representation pointers
   * so {@link AcDbDynBlockReference} works with LibreDWG-parsed drawings.
   *
   * LibreDWG does not expose a typed `ACDB_BLOCKREPRESENTATION_DATA` object;
   * we still import the dictionary graph so `AcDbBlockRepresentation` /
   * `ACAD_ENHANCEDBLOCK` keys resolve. When a dictionary entry named
   * `AcDbRepData` points at a handle that is not a converted object, a
   * placeholder is created by {@link acdbImportDynBlockMetadata}.
   */
  /** Preserve native application metadata and extension dictionary targets. */
  private processXrecords(model: DwgDatabase, db: AcDbDatabase) {
    const records=new Map<string,AcDbXrecord>()
    for(const source of model.objects.XRECORD??[]) {
      const record=new AcDbXrecord()
      record.objectId=source.handle
      record.ownerId=source.ownerHandle
      record.database=db
      record.data=new AcDbResultBuffer((source.data??[]).map(group=>({code:group.code,value:group.value})))
      db.commitObjectHandle(record)
      records.set(source.handle.toUpperCase(),record)
    }
    const root=model.objects.DICTIONARY.find(dict=>dict.entries?.MLIGHT_XRECORD)
    const handle=root?.entries.MLIGHT_XRECORD
    const named=model.objects.DICTIONARY.find(dict=>dict.handle===handle)
    if(named)for(const [name,target]of Object.entries(named.entries)) {
      const record=records.get(target.toUpperCase())
      if(record)db.objects.xrecord.setAt(name,record)
    }
  }

  private processDynBlockMetadata(model: DwgDatabase, db: AcDbDatabase) {
    const normalize = (handle?: string | number) =>
      handle == null || handle === '' || handle === 0
        ? ''
        : String(handle).trim().toUpperCase()

    // BTR extension dictionaries (when LibreDWG exposes them on entries).
    for (const btr of model.tables.BLOCK_RECORD.entries) {
      const dbBlock = db.tables.blockTable.getAt(btr.name)
      if (!dbBlock) continue
      const raw = btr as {
        extensionDictionary?: string
        ownerDictionaryHardId?: string | number
        ownerDictionarySoftId?: string | number
      }
      const xdict = acdbNormalizeExtensionDictionaryId(
        raw.extensionDictionary ??
          raw.ownerDictionaryHardId ??
          raw.ownerDictionarySoftId
      )
      if (xdict) {
        dbBlock.extensionDictionary = xdict
      }
    }

    const dictObjects = model.objects.DICTIONARY
    if (!dictObjects?.length) return

    const dictionaries = dictObjects.map(dict => {
      const entries: Array<{ name: string; handle: string }> = []
      const src = dict.entries ?? {}
      for (const name in src) {
        const target = src[name]
        if (name && target) {
          entries.push({ name, handle: normalize(String(target)) })
        }
      }
      return {
        handle: normalize(dict.handle),
        ownerHandle: normalize(dict.ownerHandle) || undefined,
        entries
      }
    })

    // LibreDWG does not currently surface typed representation-data objects.
    // Leave representationData empty; DynBlock still works for *U inserts via
    // blockName, and ACAD_ENHANCEDBLOCK detection works via dictionaries.
    acdbImportDynBlockMetadata(db, { dictionaries, representationData: [] })
  }

  /**
   * Reconstructs the Layer Manager filter tree (`AcLy*` classes) from the
   * `ACAD_LAYERFILTERS` / `ACLYDICTIONARY` dictionaries and their XRecords.
   *
   * @remarks
   * Reads `DICTIONARY` and `XRECORD` objects from the parsed DWG. When either
   * collection is empty, nested filter payloads are unavailable and this
   * method is a no-op.
   *
   * @param model - Parsed DWG database.
   * @param db - Target database whose {@link AcDbDatabase.layerFilters} is set.
   */
  private processLayerFilterTree(model: DwgDatabase, db: AcDbDatabase) {
    const dictObjects = model.objects.DICTIONARY
    const xrecordObjects = model.objects.XRECORD
    if (!dictObjects?.length || !xrecordObjects?.length) {
      return
    }

    const normalize = (handle?: string) =>
      handle ? String(handle).trim().toUpperCase() : ''

    const dictionaries: AcDbLayerFilterPersistSource['dictionaries'] = new Map()
    dictObjects.forEach(dict => {
      const entries: Record<string, string> = {}
      const src = dict.entries ?? {}
      for (const name in src) {
        const target = src[name]
        if (name && target) {
          entries[name] = normalize(String(target))
        }
      }
      dictionaries.set(normalize(dict.handle), {
        handle: normalize(dict.handle),
        ownerObjectId: normalize(dict.ownerHandle),
        entries
      })
    })

    const xrecords: AcDbLayerFilterPersistSource['xrecords'] = new Map()
    xrecordObjects.forEach(xrecord => {
      xrecords.set(normalize(xrecord.handle), {
        handle: normalize(xrecord.handle),
        ownerObjectId: normalize(xrecord.ownerHandle),
        extensionDictionaryId: normalize(xrecord.extensionDictionary),
        data: (xrecord.data ?? []).map(group => ({
          code: Number(group.code),
          value: group.value
        }))
      })
    })

    const tree = acdbReadLayerFilterTree({ dictionaries, xrecords })
    if (tree.root.getNestedFilters().length > 0) {
      db.layerFilters = tree
    }
  }

  private processLayouts(model: DwgDatabase, db: AcDbDatabase) {
    const layoutDict = db.objects.layout
    const layouts = model.objects.LAYOUT
    layouts.forEach(layout => {
      const dbLayout = new AcDbLayout()
      dbLayout.layoutName = layout.layoutName
      dbLayout.tabOrder = layout.tabOrder

      // layout.paperSpaceTableId doesn't point to the block table record asscicated with
      // this layout. So let's get the assocated block table record id from block table.
      const btrs = db.tables.blockTable.newIterator()
      dbLayout.objectId = layout.handle
      for (const btr of btrs) {
        // Because the type of layout id (number) block table record and layout id (BingInt)
        // in layout dictionary are different, so the converted data are used to compare.
        // In the future, we will use BigInt type for object id.
        if (btr.layoutId === dbLayout.objectId) {
          dbLayout.blockTableRecordId = btr.objectId
          break
        }
      }
      // If the layout is not found in the block table due to some unknow reason,
      // let's set the model space block table record id.
      if (!dbLayout.blockTableRecordId) {
        if (layout.layoutName === 'Model') {
          dbLayout.blockTableRecordId = db.tables.blockTable.modelSpace.objectId
        }
      }
      dbLayout.limits.min.copy(layout.minLimit)
      dbLayout.limits.max.copy(layout.maxLimit)
      dbLayout.extents.min.copy(layout.minExtent)
      dbLayout.extents.max.copy(layout.maxExtent)
      if (layout.viewportId) {
        dbLayout.viewportArray.push(layout.viewportId)
      }
      this.processCommonObjectAttrs(layout, dbLayout)
      layoutDict.setAt(dbLayout.layoutName, dbLayout)
    })
  }

  private processImageDefs(model: DwgDatabase, db: AcDbDatabase) {
    const imageDefDict = db.objects.imageDefinition
    const imageDefs = model.objects.IMAGEDEF
    imageDefs.forEach(imageDef => {
      const dbImageDef = new AcDbRasterImageDef()
      dbImageDef.sourceFileName = imageDef.fileName
      this.processCommonObjectAttrs(imageDef, dbImageDef)
      imageDefDict.setAt(dbImageDef.objectId, dbImageDef)
    })
  }

  private processLayerFilters(model: DwgDatabase, db: AcDbDatabase) {
    const layerFilters = model.objects.LAYER_FILTER
    if (!layerFilters?.length) return

    const layerFilterDict = db.objects.layerFilter
    const objectConverter = new AcDbObjectConverter()
    layerFilters.forEach(filter => {
      const dbFilter = objectConverter.convertLayerFilter(filter)
      layerFilterDict.setAt(dbFilter.objectId, dbFilter)
    })
  }

  private processLayerIndexes(model: DwgDatabase, db: AcDbDatabase) {
    const layerIndexes = model.objects.LAYER_INDEX
    if (!layerIndexes?.length) return

    const layerIndexDict = db.objects.layerIndex
    const objectConverter = new AcDbObjectConverter()
    layerIndexes.forEach(index => {
      const dbIndex = objectConverter.convertLayerIndex(index)
      layerIndexDict.setAt(dbIndex.objectId, dbIndex)
    })
  }

  private processMLeaderStyles(model: DwgDatabase, db: AcDbDatabase) {
    const mleaderStyles = model.objects.MLEADERSTYLE
    if (!mleaderStyles?.length) return

    const mleaderStyleDict = db.objects.mleaderStyle
    const objectConverter = new AcDbObjectConverter()
    mleaderStyles.forEach(style => {
      const dbStyle = objectConverter.convertMLeaderStyle(style)
      mleaderStyleDict.setAt(dbStyle.objectId, dbStyle)
    })
  }

  private processCommonObjectAttrs(
    object: DwgCommonObject,
    dbObject: AcDbObject
  ) {
    dbObject.objectId = object.handle
    if (object.ownerHandle != null) {
      dbObject.ownerId = object.ownerHandle
    }
  }

  /**
   * Groups entities by their `type` property and flattens the result into a single array.
   *
   * The order of `type` groups follows the order in which they first appear in the input array.
   * Items within each group preserve their original order.
   *
   * This runs in O(n) time, which is generally faster than sorting when you
   * don't care about alphabetical order of types.
   *
   * @param entities - The array of entities to group and flatten.
   *
   * @returns A new array of entities grouped by their `type` property.
   */
  private groupAndFlattenByType(entities: DwgEntity[]) {
    const groups: Record<string, DwgEntity[]> = {}
    const order: string[] = []

    for (const entity of entities) {
      if (!groups[entity.type]) {
        groups[entity.type] = []
        order.push(entity.type)
      }
      groups[entity.type].push(entity)
    }

    const result: DwgEntity[] = []
    for (const type of order) {
      // Avoid push(...group): large same-type groups hit apply arg limits.
      const group = groups[type]
      for (let i = 0; i < group.length; i++) {
        result.push(group[i])
      }
    }
    return result
  }

  private isModelSpace(name: string) {
    return name && name.toUpperCase() == MODEL_SPACE
  }

  private normalizeHeaderStringValue(value: unknown) {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
}
