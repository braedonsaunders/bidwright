import {
  AcCmColor,
  AcDbAttribute,
  AcDbBatchProcessing,
  AcDbBlockReference,
  AcDbBlockScaling,
  AcDbBlockTableRecord,
  AcDbConversionProgressCallback,
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
  AcDbFontNameCollector,
  AcDbLayerTableRecord,
  AcDbLinetypeTableRecord,
  AcDbObjectId,
  AcDbSymbolTable,
  AcDbSymbolTableRecord,
  AcDbSystemVariables,
  AcDbSysVarManager,
  AcDbTextStyleTableRecord,
  AcDbViewportTableRecord,
  AcGiDefaultLightingType,
  AcGiOrthographicType,
  AcGiRenderMode,
  ByLayer,
  createWorkerApi,
  DEFAULT_MLEADER_STYLE,
  DEFAULT_MLINE_STYLE,
  DEFAULT_TEXT_STYLE,
  VPORT_FALLBACK_CENTER_2D,
  VPORT_FALLBACK_LLC,
  VPORT_FALLBACK_URC,
  VPORT_FALLBACK_VIEW_DIR,
  VPORT_FALLBACK_VIEW_TARGET
} from '@mlightcad/data-model'
import {
  BlockRecordTableEntry,
  CommonDxfEntity,
  CommonDxfTableEntry,
  DimStylesTableEntry,
  DxfTable,
  ImageDefDXFObject,
  InsertEntity,
  LayerTableEntry,
  LayoutDXFObject,
  LTypeTableEntry,
  MLeaderStyleDXFObject,
  MLineStyleDXFObject,
  MTextEntity,
  MultiLeaderEntity,
  ParsedDxf,
  StyleTableEntry,
  TextEntity,
  VPortTableEntry
} from '@mlightcad/dxf-json/types'

import { AcDbEntityConverter } from './AcDbEntitiyConverter'
import { AcDbObjectConverter } from './AcDbObjectConverter'

/**
 * Default database converter for DXF files.
 *
 * This class extends AcDbDatabaseConverter to provide specialized functionality
 * for converting DXF (Drawing Exchange Format) files into AcDbDatabase objects.
 * It handles parsing DXF data, processing entities, blocks, tables, and other
 * DXF-specific structures.
 *
 * @example
 * ```typescript
 * const converter = new AcDbDxfConverter();
 * const database = await converter.convert(dxfData);
 * ```
 */
export class AcDbDxfConverter extends AcDbDatabaseConverter<ParsedDxf> {
  constructor(config: AcDbDatabaseConverterConfig = {}) {
    super(config)
    if (!this.config.parserWorkerUrl) {
      this.config.parserWorkerUrl = '/assets/dxf-parser-worker.js'
    }
  }

  /**
   * Parses DXF data into a ParsedDxf object.
   *
   * @param data - The DXF data
   * @returns Parsed DXF object containing all the parsed data
   *
   */
  protected async parse(data: ArrayBuffer, timeout?: number) {
    const effectiveConfig = this.config
    const resolvedTimeout = this.getParserWorkerTimeout(data, timeout)

    if (effectiveConfig.useWorker && effectiveConfig.parserWorkerUrl) {
      const api = createWorkerApi({
        workerUrl: effectiveConfig.parserWorkerUrl,
        timeout: resolvedTimeout,
        // One concurrent worker needed for parser
        maxConcurrentWorkers: 1
      })
      const result = await api.execute<ArrayBuffer, ParsedDxf>(data)
      // Release worker
      api.destroy()
      if (result.success) {
        return {
          model: result.data,
          data: {
            unknownEntityCount: 0
          }
        }
      } else {
        throw new Error(
          `Failed to parse drawing due to error: '${result.error}'`
        )
      }
    } else {
      throw new Error('dxf converter can run in web worker only!')
    }
  }

  /**
   * Gets all fonts used by entities in model space and paper space.
   *
   * This method analyzes the DXF data to extract all font names used by
   * text entities, MText entities, and insert entities throughout the drawing.
   *
   * @param dxf - Input parsed DXF model
   * @returns Array of font names used in the drawing
   *
   * @example
   * ```typescript
   * const fonts = converter.getFonts(parsedDxf);
   * console.log('Used fonts:', fonts);
   * ```
   */
  protected getFonts(dxf: ParsedDxf) {
    const blocks = dxf.blocks ?? {}
    return new AcDbFontNameCollector({
      styles: dxf.tables.STYLE?.entries ?? [],
      textStyleVar:
        (dxf.header?.['$TEXTSTYLE'] as string | undefined) || DEFAULT_TEXT_STYLE
    }).collect(dxf.entities, {
      getEntityFontInfo: (entity: CommonDxfEntity) => {
        if (entity.type == 'MTEXT') {
          const mtext = entity as MTextEntity
          return {
            styleName: mtext.styleName,
            formattedText: mtext.text,
            resolveStyle: true
          }
        }
        if (entity.type == 'TEXT' || entity.type == 'ATTRIB') {
          const text = entity as TextEntity
          return { styleName: text.styleName, resolveStyle: true }
        }
        if (entity.type == 'MULTILEADER' || entity.type == 'MLEADER') {
          const mleader = entity as MultiLeaderEntity & Record<string, unknown>
          const text =
            typeof mleader.textContent === 'string' ? mleader.textContent : ''
          const styleName =
            typeof mleader.textStyleName === 'string'
              ? mleader.textStyleName
              : typeof mleader.styleName === 'string'
                ? mleader.styleName
                : undefined
          return { styleName, formattedText: text, resolveStyle: true }
        }
        if (entity.type == 'INSERT') {
          return { blockName: (entity as InsertEntity).name }
        }
        return null
      },
      getBlockEntities: (blockName: string) => blocks[blockName]?.entities
    })
  }

  /**
   * Processes entities in batches to maintain UI responsiveness.
   *
   * This method breaks up the entity processing work into smaller chunks that are
   * executed asynchronously. This is often referred to as "batch processing" or
   * "cooperative multitasking," where the time-consuming task is broken into
   * smaller pieces and executed in small intervals to allow the UI to remain responsive.
   *
   * @param dxf - Parsed DXF data
   * @param db - Target database to add entities to
   * @param minimumChunkSize - Minimum number of entities to process in each chunk
   * @param startPercentage - Object containing the starting percentage for progress tracking
   * @param progress - Optional callback for progress updates
   *
   * @example
   * ```typescript
   * await converter.processEntities(dxf, database, 100, { value: 0 }, progressCallback);
   * ```
   */
  protected async processEntities(
    dxf: ParsedDxf,
    db: AcDbDatabase,
    minimumChunkSize: number,
    startPercentage: { value: number },
    progress?: AcDbConversionProgressCallback
  ) {
    const converter = new AcDbEntityConverter()

    // Create an instance of AcDbBatchProcessing
    let entities = dxf.entities
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

    // Maybe INSERT entity associated with one attribute isn't converted yet.
    // So store it in attribute map and handle them in batch later.
    const attributeMap: Map<AcDbObjectId, AcDbAttribute[]> = new Map()
    for (let i = 0; i < entityCount; i++) {
      const entity = entities[i]
      if (entity.type === 'ATTRIB') {
        const dbEntity = converter.convert(entity)
        if (dbEntity && dbEntity.ownerId && dbEntity.ownerId !== '0') {
          let attributes = attributeMap.get(dbEntity?.ownerId)
          if (attributes == null) {
            attributes = []
            attributeMap.set(dbEntity.ownerId, attributes)
          }
          attributes.push(dbEntity as AcDbAttribute)
        }
      }
    }

    // Process the ordered entities in chunks
    const modelSpaceBlockTableRecord = db.tables.blockTable.modelSpace
    await batchProcessor.processChunk(async (start, end) => {
      // Logic for processing each chunk of entities
      let dbEntities: AcDbEntity[] = []
      let entityType = start < end ? entities[start].type : ''
      for (let i = start; i < end; i++) {
        const entity = entities[i]
        if (
          entity.ownerBlockRecordSoftId &&
          entity.ownerBlockRecordSoftId !== modelSpaceBlockTableRecord.objectId
        ) {
          continue
        }
        if (entity.type !== 'ATTRIB') {
          const dbEntity = converter.convert(entity)
          if (dbEntity) {
            if (this.config.convertByEntityType && entity.type !== entityType) {
              modelSpaceBlockTableRecord.appendEntity(dbEntities)
              dbEntities = []
              entityType = entity.type
            }
            if (entity.type === 'INSERT') {
              const attributes = attributeMap.get(dbEntity.objectId)
              if (attributes && attributes.length > 0) {
                attributes.forEach(attribute => {
                  ;(dbEntity as AcDbBlockReference).appendAttributes(attribute)
                })
              }
            }
            dbEntities.push(dbEntity)
          }
        }
      }

      // Use batch append to improve performance
      modelSpaceBlockTableRecord.appendEntity(dbEntities)

      let percentage =
        startPercentage.value +
        (end / entityCount) * (100 - startPercentage.value)
      if (percentage > 100) percentage = 100

      // Update progress
      if (progress) {
        await progress(percentage, 'ENTITY', 'IN-PROGRESS')
      }
    })
  }

  /**
   * Processes entities within a specific block.
   *
   * This method handles the conversion and addition of entities to a specific
   * block table record.
   *
   * @param entities - Array of DXF entities to process
   * @param blockTableRecord - The block table record to use
   * @param checkOwner - The flag whether to check the owner of entity is the passed
   * blockTableRecord. If yes, convert it and append it to the block table record.
   * Otherwise, ignore the entity.
   *
   * @example
   * ```typescript
   * await converter.processEntitiesInBlock(entities, blockRecord);
   * ```
   */
  private async processEntitiesInBlock(
    entities: CommonDxfEntity[],
    blockTableRecord: AcDbBlockTableRecord,
    checkOwner = false
  ) {
    const converter = new AcDbEntityConverter()
    const entityCount = entities.length
    const dbEntities: AcDbEntity[] = []
    const btrId = blockTableRecord.objectId

    // Maybe INSERT entity associated with one attribute isn't converted yet.
    // So store it in array 'attributes' and handle them in batch later.
    const attributes: AcDbAttribute[] = []
    for (let i = 0; i < entityCount; i++) {
      const entity = entities[i]
      const dbEntity = converter.convert(entity)
      if (dbEntity) {
        if (entity.type === 'ATTRIB') {
          attributes.push(dbEntity as AcDbAttribute)
        } else if (!checkOwner || entity.ownerBlockRecordSoftId === btrId) {
          dbEntities.push(dbEntity)
        }
      }
    }

    // Use batch append to improve performance
    blockTableRecord.appendEntity(dbEntities)

    attributes.forEach(attribute => {
      const owner = blockTableRecord.getIdAt(
        attribute.ownerId
      ) as AcDbBlockReference
      if (owner) {
        owner.appendAttributes(attribute)
      }
    })
  }

  /**
   * Processes blocks defined in the DXF file.
   *
   * This method iterates through all blocks in the DXF data and creates
   * corresponding AcDbBlockTableRecord objects in the database.
   *
   * @param model - Parsed DXF model containing block definitions
   * @param db - Target database to add blocks to
   *
   * @example
   * ```typescript
   * converter.processBlocks(parsedDxf, database);
   * ```
   */
  protected processBlocks(model: ParsedDxf, db: AcDbDatabase) {
    const blocks = model.blocks
    for (const [name, block] of Object.entries(blocks)) {
      let dbBlock = db.tables.blockTable.getAt(block.name)
      if (!dbBlock) {
        dbBlock = new AcDbBlockTableRecord()
        if (block.handle != null) {
          dbBlock.objectId = String(block.handle)
        }
        // dbBlock.ownerId = block.ownerHandle
        dbBlock.name = name
        db.tables.blockTable.add(dbBlock)
      }
      // processBlockTables may create the record first without a base point.
      // Always sync origin from the BLOCKS section before expanding entities.
      dbBlock.origin.copy(block.position)
      if (block.entities) {
        // Process entities in user-defined blocks
        this.processEntitiesInBlock(block.entities, dbBlock)
      } else {
        // Process paper space block definiton. Entities in model space are
        // handled in method processEntities
        if (dbBlock.isPaperSapce) {
          this.processEntitiesInBlock(model.entities, dbBlock, true)
        }
      }
    }
  }

  /**
   * Processes header variables from the DXF file.
   *
   * This method extracts and sets various header variables such as color settings,
   * angle base, angle direction, units, and point display settings.
   *
   * @param model - Parsed DXF model containing header information
   * @param db - Target database to set header variables on
   *
   * @example
   * ```typescript
   * converter.processHeader(parsedDxf, database);
   * ```
   */
  protected processHeader(model: ParsedDxf, db: AcDbDatabase) {
    const header = model.header
    if (header['$ACADVER']) {
      db.version = header['$ACADVER']
    }

    // Color index 256 is 'ByLayer'
    db.cecolor.colorIndex = header['$CECOLOR'] || 256
    db.angbase = header['$ANGBASE'] || 0
    db.angdir = header['$ANGDIR'] || 0
    if (header['$AUNITS'] != null) db.aunits = header['$AUNITS']
    if (header['$AUPREC'] != null) db.auprec = header['$AUPREC']
    if (header['$LUNITS'] != null) db.lunits = header['$LUNITS']
    if (header['$LUPREC'] != null) db.luprec = header['$LUPREC']
    if (header['$UNITMODE'] != null) db.unitmode = header['$UNITMODE']
    if (header['$MEASUREMENT'] != null) db.measurement = header['$MEASUREMENT']
    db.celtype = header['$CELTYPE'] || ByLayer
    AcDbSysVarManager.instance().setVar(
      AcDbSystemVariables.CETRANSPARENCY,
      header['$CETRANSPARENCY'] || 'ByLayer',
      db
    )
    db.celtscale = header['$CELTSCALE'] || 1
    const cmlStyle =
      this.normalizeHeaderStringValue(header['$CMLSTYLE']) ||
      this.normalizeHeaderStringValue(header['CMLSTYLE']) ||
      DEFAULT_MLINE_STYLE
    db.cmlstyle = cmlStyle
    const cmlScale = header['$CMLSCALE'] ?? header['CMLSCALE']
    if (typeof cmlScale === 'number' && Number.isFinite(cmlScale)) {
      db.cmlscale = cmlScale
    }
    const cmleaderStyle =
      this.normalizeHeaderStringValue(header['$CMLEADERSTYLE']) ||
      this.normalizeHeaderStringValue(header['CMLEADERSTYLE']) ||
      DEFAULT_MLEADER_STYLE
    db.cmleaderstyle = cmleaderStyle
    // db.hpcolor = this.parseHpColor(
    //   this.normalizeHeaderStringValue(header['$HPCOLOR']) ||
    //     this.normalizeHeaderStringValue(header['HPCOLOR']),
    //   db.cecolor
    // )
    // db.hpbackgroundcolor = this.parseHpBackgroundColor(
    //   this.normalizeHeaderStringValue(header['$HPBACKGROUNDCOLOR']) ||
    //     this.normalizeHeaderStringValue(header['HPBACKGROUNDCOLOR'])
    // )
    db.hplayer =
      this.normalizeHeaderStringValue(header['$HPLAYER']) ||
      this.normalizeHeaderStringValue(header['HPLAYER']) ||
      '.'
    // db.hptransparency = this.parseHpTransparency(
    //   this.normalizeHeaderStringValue(header['$HPTRANSPARENCY']) ||
    //     this.normalizeHeaderStringValue(header['HPTRANSPARENCY'])
    // )
    db.ltscale = header['$LTSCALE'] || 1
    if (header['$EXTMAX']) db.extmax = header['$EXTMAX']
    if (header['$EXTMIN']) db.extmin = header['$EXTMIN']
    if (header['$INSUNITS'] != null) db.insunits = header['$INSUNITS']
    db.osmode = header['$OSMODE'] || 0
    db.orthomode = header['$ORTHOMODE'] || 0
    db.pdmode = header['$PDMODE'] || 0
    db.pdsize = header['$PDSIZE'] || 0.0
    db.textstyle = header['$TEXTSTYLE'] || DEFAULT_TEXT_STYLE
  }

  /**
   * Processes block table records from the DXF file.
   *
   * This method creates AcDbBlockTableRecord objects for each block record
   * defined in the DXF tables section.
   *
   * @param dxf - Parsed DXF data
   * @param db - Target database to add block table records to
   *
   * @example
   * ```typescript
   * converter.processBlockTables(parsedDxf, database);
   * ```
   */
  protected processBlockTables(dxf: ParsedDxf, db: AcDbDatabase) {
    const btrs = dxf.tables.BLOCK_RECORD?.entries
    if (btrs && btrs.length > 0) {
      db.tables.blockTable.removeAll()
      btrs.forEach(btr => {
        const dbBlock = new AcDbBlockTableRecord()
        dbBlock.objectId = btr.handle
        dbBlock.name = btr.name
        dbBlock.layoutId = btr.layoutObjects
        dbBlock.blockInsertUnits = btr.insertionUnits
        dbBlock.explodability = btr.explodability
        dbBlock.blockScaling = btr.scalability as AcDbBlockScaling
        if (btr.bmpPreview) {
          dbBlock.bmpPreview = btr.bmpPreview
        }
        db.tables.blockTable.add(dbBlock)
      })
    }
  }

  /**
   * Processes objects defined in the DXF file.
   *
   * This method handles the conversion of DXF objects such as layouts and
   * image definitions into their corresponding AcDb objects.
   *
   * @param model - Parsed DXF model containing object definitions
   * @param db - Target database to add objects to
   *
   * @example
   * ```typescript
   * converter.processObjects(parsedDxf, database);
   * ```
   */
  protected processObjects(model: ParsedDxf, db: AcDbDatabase) {
    const objects = model.objects.byName
    const objectConverter = new AcDbObjectConverter()
    if ('LAYOUT' in objects) {
      const layoutDict = db.objects.layout
      objects['LAYOUT'].forEach(layout => {
        const dbLayout = objectConverter.convertLayout(
          layout as LayoutDXFObject,
          model
        )
        layoutDict.setAt(dbLayout.layoutName, dbLayout)
      })
    }
    if ('IMAGEDEF' in objects) {
      const imageDefDict = db.objects.imageDefinition
      objects['IMAGEDEF'].forEach(imageDef => {
        const dbImageDef = objectConverter.convertImageDef(
          imageDef as ImageDefDXFObject
        )
        imageDefDict.setAt(dbImageDef.objectId, dbImageDef)
      })
    }
    if ('MLEADERSTYLE' in objects) {
      const mleaderStyleDict = db.objects.mleaderStyle
      objects['MLEADERSTYLE'].forEach(style => {
        const dbStyle = objectConverter.convertMLeaderStyle(
          style as MLeaderStyleDXFObject
        )
        mleaderStyleDict.setAt(dbStyle.objectId, dbStyle)
      })
    }
    if ('MLINESTYLE' in objects) {
      const mlineStyleDict = db.objects.mlineStyle
      objects['MLINESTYLE'].forEach(style => {
        const dbStyle = objectConverter.convertMLineStyle(
          style as MLineStyleDXFObject
        )
        mlineStyleDict.setAt(dbStyle.styleName || dbStyle.objectId, dbStyle)
      })
    }
  }

  /**
   * Processes viewport table records from the DXF file.
   *
   * This method creates AcDbViewportTableRecord objects for each viewport
   * defined in the DXF tables section, including their properties like
   * center, corners, snap settings, and grid settings.
   *
   * @param model - Parsed DXF model containing viewport definitions
   * @param db - Target database to add viewport table records to
   *
   * @example
   * ```typescript
   * converter.processViewports(parsedDxf, database);
   * ```
   */
  protected processViewports(model: ParsedDxf, db: AcDbDatabase) {
    const viewportTable = model.tables?.VPORT
    if (viewportTable) {
      this.processCommonTableAttrs(viewportTable, db.tables.viewportTable)
      const viewports = viewportTable.entries
      if (viewports && viewports.length > 0) {
        viewports.forEach(item => {
          const record = new AcDbViewportTableRecord()
          this.processCommonTableEntryAttrs(item, record)
          if (item.circleSides) {
            record.circleSides = item.circleSides
          }
          record.standardFlag = item.standardFlag
          record.center.copy(item.center ?? VPORT_FALLBACK_CENTER_2D)
          record.lowerLeftCorner.copy(
            item.lowerLeftCorner ?? VPORT_FALLBACK_LLC
          )
          record.upperRightCorner.copy(
            item.upperRightCorner ?? VPORT_FALLBACK_URC
          )
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
          if (
            item.aspectRatio != null &&
            Number.isFinite(item.aspectRatio) &&
            item.aspectRatio > 0
          ) {
            record.gsView.aspectRatio = item.aspectRatio
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
            record.gsView.renderMode =
              item.renderMode as unknown as AcGiRenderMode
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
          db.tables.viewportTable.add(record)
        })
      }
    }
  }

  /**
   * Processes layer table records from the DXF file.
   *
   * This method creates AcDbLayerTableRecord objects for each layer
   * defined in the DXF tables section, including their properties like
   * color, linetype, lineweight, and visibility settings.
   *
   * @param model - Parsed DXF model containing layer definitions
   * @param db - Target database to add layer table records to
   *
   * @example
   * ```typescript
   * converter.processLayers(parsedDxf, database);
   * ```
   */
  protected processLayers(model: ParsedDxf, db: AcDbDatabase) {
    const layerTable = model.tables?.LAYER
    if (layerTable) {
      this.processCommonTableAttrs(layerTable, db.tables.layerTable)
      const layers = layerTable.entries
      if (layers && layers.length > 0) {
        layers.forEach(item => {
          const color = new AcCmColor()
          color.colorIndex = item.colorIndex
          const record = new AcDbLayerTableRecord({
            name: item.name,
            standardFlags: item.standardFlag,
            linetype: item.lineType,
            lineWeight: item.lineweight,
            isOff: item.colorIndex < 0,
            color: color,
            isPlottable: item.isPlotting
          })
          this.processCommonTableEntryAttrs(item, record)
          db.tables.layerTable.add(record)
        })
      }
    }
  }

  /**
   * Processes linetype table records from the DXF file.
   *
   * This method creates AcDbLinetypeTableRecord objects for each linetype
   * defined in the DXF tables section.
   *
   * @param model - Parsed DXF model containing linetype definitions
   * @param db - Target database to add linetype table records to
   *
   * @example
   * ```typescript
   * converter.processLineTypes(parsedDxf, database);
   * ```
   */
  protected processLineTypes(model: ParsedDxf, db: AcDbDatabase) {
    const lineTypeTable = model.tables?.LTYPE
    if (lineTypeTable) {
      this.processCommonTableAttrs(lineTypeTable, db.tables.linetypeTable)
      const lineTypes = lineTypeTable.entries
      if (lineTypes && lineTypes.length > 0) {
        lineTypes.forEach((item: LTypeTableEntry) => {
          const record = new AcDbLinetypeTableRecord({
            name: item.name,
            standardFlag: item.standardFlag,
            description: item.description,
            totalPatternLength: item.totalPatternLength,
            pattern: item.pattern
          })
          this.processCommonTableEntryAttrs(item, record)
          db.tables.linetypeTable.add(record)
        })
      }
    }
  }

  /**
   * Processes text style table records from the DXF file.
   *
   * This method creates AcDbTextStyleTableRecord objects for each text style
   * defined in the DXF tables section.
   *
   * @param model - Parsed DXF model containing text style definitions
   * @param db - Target database to add text style table records to
   *
   * @example
   * ```typescript
   * converter.processTextStyles(parsedDxf, database);
   * ```
   */
  protected processTextStyles(model: ParsedDxf, db: AcDbDatabase) {
    const textStyleTable = model.tables?.STYLE
    if (textStyleTable) {
      this.processCommonTableAttrs(textStyleTable, db.tables.textStyleTable)
      const textStyles = textStyleTable.entries
      if (textStyles && textStyles.length > 0) {
        textStyles.forEach((item: StyleTableEntry) => {
          const record = new AcDbTextStyleTableRecord({
            name: item.name,
            standardFlag: item.standardFlag,
            fixedTextHeight: item.fixedTextHeight,
            widthFactor: item.widthFactor,
            obliqueAngle: item.obliqueAngle,
            textGenerationFlag: item.textGenerationFlag,
            lastHeight: item.lastHeight,
            font: item.font,
            bigFont: item.bigFont,
            extendedFont: item.extendedFont
          })
          this.processCommonTableEntryAttrs(item, record)
          db.tables.textStyleTable.add(record)
        })
      }
    }
    db.ensureTextStyleDefaults()
  }

  /**
   * Processes dimension style table records from the DXF file.
   *
   * This method creates AcDbDimStyleTableRecord objects for each dimension style
   * defined in the DXF tables section, including all dimension-related properties
   * like text positioning, arrow settings, and tolerance settings.
   *
   * @param model - Parsed DXF model containing dimension style definitions
   * @param db - Target database to add dimension style table records to
   *
   * @example
   * ```typescript
   * converter.processDimStyles(parsedDxf, database);
   * ```
   */
  protected processDimStyles(model: ParsedDxf, db: AcDbDatabase) {
    const dimStyleTable = model.tables?.DIMSTYLE
    if (dimStyleTable) {
      this.processCommonTableAttrs(dimStyleTable, db.tables.dimStyleTable)
      const dimStyles = dimStyleTable.entries
      if (dimStyles && dimStyles.length > 0) {
        dimStyles.forEach(item => {
          const attrs: AcDbDimStyleTableRecordAttrs = {
            name: item.name,
            ownerId: item.ownerObjectId,
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
            dimazin:
              item.DIMAZIN as unknown as AcDbDimZeroSuppressionAngular.None,
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
            dimdsep: item.DIMDSEP ? item.DIMDSEP.toString() : '.',
            dimtmove: item.DIMTMOVE || 0,
            dimjust: item.DIMJUST as unknown as AcDbDimTextHorizontal.Center,
            dimsd1: item.DIMSD1,
            dimsd2: item.DIMSD2,
            dimtolj:
              item.DIMTOLJ as unknown as AcDbDimVerticalJustification.Bottom,
            dimtzin: item.DIMTZIN as unknown as AcDbDimZeroSuppression.Feet,
            dimaltz: item.DIMALTZ as unknown as AcDbDimZeroSuppression.Feet,
            dimalttz: item.DIMALTTZ as unknown as AcDbDimZeroSuppression.Feet,
            dimfit: item.DIMFIT || 0,
            dimupt: item.DIMUPT,
            dimatfit: item.DIMATFIT,
            dimtxsty: item.DIMTXSTY || DEFAULT_TEXT_STYLE,
            dimldrblk: item.DIMLDRBLK || '',
            dimblk: item.DIMBLK || '',
            dimblk1: item.DIMBLK1 || '',
            dimblk2: item.DIMBLK2 || '',
            dimlwd: item.DIMLWD,
            dimlwe: item.DIMLWE
          }
          const record = new AcDbDimStyleTableRecord(attrs)
          this.processCommonTableEntryAttrs(item, record)
          db.tables.dimStyleTable.add(record)
        })
      }
    }
  }

  private processCommonTableAttrs(
    table:
      | DxfTable<BlockRecordTableEntry>
      | DxfTable<DimStylesTableEntry>
      | DxfTable<StyleTableEntry>
      | DxfTable<LayerTableEntry>
      | DxfTable<LTypeTableEntry>
      | DxfTable<VPortTableEntry>,
    dbTable: AcDbSymbolTable
  ) {
    if (table.handle != null) {
      dbTable.objectId = table.handle
    }
    if (table.ownerObjectId != null) {
      dbTable.ownerId = table.ownerObjectId
    }
  }

  /**
   * Processes common table entry attributes from DXF data.
   *
   * This helper method sets the common attributes (name, objectId, ownerId)
   * that are shared across all table entries.
   *
   * @param entry - DXF table entry containing the source data
   * @param dbEntry - AcDbSymbolTableRecord to populate with the data
   *
   * @example
   * ```typescript
   * converter.processCommonTableEntryAttrs(dxfEntry, dbRecord);
   * ```
   */
  private processCommonTableEntryAttrs(
    entry: CommonDxfTableEntry,
    dbEntry: AcDbSymbolTableRecord
  ) {
    dbEntry.name = 'name' in entry ? (entry.name as string) : ''
    // All of objects in drawing database should have handle. However, some VPORT objects in DXF file
    // don't have handle. In this time, just use objectId created in constructor of AcDbObject.
    // https://github.com/mlightcad/cad-viewer/issues/101
    if (entry.handle != null) dbEntry.objectId = entry.handle
    if (entry.ownerObjectId != null) {
      dbEntry.ownerId = entry.ownerObjectId
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
  private groupAndFlattenByType(entities: CommonDxfEntity[]) {
    const groups: Record<string, CommonDxfEntity[]> = {}
    const order: string[] = []

    for (const entity of entities) {
      if (!groups[entity.type]) {
        groups[entity.type] = []
        order.push(entity.type)
      }
      groups[entity.type].push(entity)
    }

    return order.flatMap(type => groups[type])
  }

  private normalizeHeaderStringValue(value: unknown) {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
}