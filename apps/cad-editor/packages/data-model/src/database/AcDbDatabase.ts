/* eslint-disable simple-import-sort/imports */
import {
  AcCmColor,
  AcCmColorMethod,
  AcCmEventManager,
  AcCmTransparency
} from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, AcDbObjectId } from '../base/AcDbObject'
import { AcDbOpenMode } from '../base/AcDbOpenMode'
import { AcDbRegenerator } from '../converter/AcDbRegenerator'
import {
  AcDbConverterType,
  AcDbDatabaseConverterManager,
  AcDbFileType
} from './AcDbDatabaseConverterManager'
import { AcDbEntity } from '../entity/AcDbEntity'
import {
  ACAD_APPID,
  ACTIVE_VPORT_NAME,
  ByBlock,
  ByLayer,
  DEFAULT_MLEADER_STYLE,
  DEFAULT_MLINE_STYLE,
  DEFAULT_LINE_TYPE,
  DEFAULT_TEXT_STYLE,
  MLIGHTCAD_APPID
} from '../misc/AcDbConstants'
import { AcDbAngleUnits } from '../misc/AcDbAngleUnits'
import { AcDbDataGenerator } from '../misc/AcDbDataGenerator'
import { AcDbFormatter } from '../misc/AcDbFormatter'
import { AcDbLinearUnits } from '../misc/AcDbLinearUnits'
import { AcDbUnitsValue } from '../misc/AcDbUnitsValue'
import { AcDbDictionary } from '../object/AcDbDictionary'
import { AcDbMLeaderStyle } from '../object/AcDbMLeaderStyle'
import { AcDbMlineStyle } from '../object/AcDbMlineStyle'
import { AcDbRasterImageDef } from '../object/AcDbRasterImageDef'
import { AcDbXrecord } from '../object/AcDbXrecord'
import { AcDbBlockTable } from './AcDbBlockTable'
import { AcDbBlockTableRecord } from './AcDbBlockTableRecord'
import { AcDbConversionStage, AcDbStageStatus } from './AcDbDatabaseConverter'
import { AcDbDimStyleTable } from './AcDbDimStyleTable'
import { AcDbDimStyleTableRecord } from './AcDbDimStyleTableRecord'
import { AcDbLayerTable } from './AcDbLayerTable'
import {
  AcDbLayerTableRecord,
  AcDbLayerTableRecordAttrs
} from './AcDbLayerTableRecord'
import { AcDbLinetypeTable } from './AcDbLinetypeTable'
import { AcDbLinetypeTableRecord } from './AcDbLinetypeTableRecord'
import { AcDbTextStyleTable } from './AcDbTextStyleTable'
import { AcDbTextStyleTableRecord } from './AcDbTextStyleTableRecord'
import { AcDbViewTable } from './AcDbViewTable'
import { AcDbViewportTable } from './AcDbViewportTable'
import { AcDbViewportTableRecord } from './AcDbViewportTableRecord'
import {
  AcGeBox3d,
  AcGePoint3d,
  AcGePoint3dLike
} from '@mlightcad/geometry-engine'
import { AcDbDwgVersion } from './AcDbDwgVersion'
import { AcGiLineWeight } from '@mlightcad/graphic-interface'
import { AcDbRegAppTable } from './AcDbRegAppTable'
import { AcDbRegAppTableRecord } from './AcDbRegAppTableRecord'
import { AcDbSysVarManager, AcDbSysVarType } from './AcDbSysVarManager'
import { AcDbSystemVariables } from './AcDbSystemVariables'
import { AcDbLayout } from '../object/layout/AcDbLayout'
import { AcDbLayoutDictionary } from '../object/layout/AcDbLayoutDictionary'
import { AcDbSymbolTable } from './AcDbSymbolTable'
import { AcDbDatabaseTransactionManager } from './transaction/AcDbDatabaseTransactionManager'

/**
 * Event arguments for object events in the dictionary.
 */
export interface AcDbDictObjectEventArgs {
  /** The database that triggered the event */
  database: AcDbDatabase
  /** The object (or objects) involved in the event */
  object: AcDbObject | AcDbObject[]
  /** The key name of the object */
  key: string
}

/**
 * Event arguments for entity-related events.
 */
export interface AcDbEntityEventArgs {
  /** The database that triggered the event */
  database: AcDbDatabase
  /** The entity (or entities) involved in the event */
  entity: AcDbEntity | AcDbEntity[]
}

/**
 * Event arguments for layer-related events.
 */
export interface AcDbLayerEventArgs {
  /** The database that triggered the event */
  database: AcDbDatabase
  /** The layer involved in the event */
  layer: AcDbLayerTableRecord
}

/**
 * Event arguments for layer modification events.
 */
export interface AcDbLayerModifiedEventArgs extends AcDbLayerEventArgs {
  /** The changes made to the layer */
  changes: Partial<AcDbLayerTableRecordAttrs>
}

/**
 * The stage of opening one drawing file
 */
export type AcDbOpenFileStage = 'FETCH_FILE' | 'CONVERSION'

/**
 * Event arguments for progress events during database operations.
 */
export interface AcDbProgressdEventArgs {
  /** The database that triggered the event */
  database: AcDbDatabase
  /** The progress percentage (0-100) */
  percentage: number
  /** The current stage of opening one drawing file */
  stage: AcDbOpenFileStage
  /** The current sub stage */
  subStage?: AcDbConversionStage
  /** The status of the current sub stage */
  subStageStatus: AcDbStageStatus
  /**
   * Store data associated with the current sub stage. Its meaning of different sub stages
   * are as follows.
   * - 'PARSE' stage: statistics of parsing task
   * - 'FONT' stage: fonts needed by this drawing
   *
   * Note: For now, 'PARSE' and 'FONT' sub stages use this field only.
   */
  data?: unknown
}

/**
 * Font information structure.
 *
 * Contains information about a font including its name, file path,
 * type, and URL for loading.
 */
export interface AcDbFontInfo {
  /** Array of font names/aliases */
  name: string[]
  /** Font file name */
  file: string
  /** Font type (mesh or shx) */
  type: 'mesh' | 'shx'
  /** URL for loading the font */
  url: string
}

/**
 * Interface for loading fonts when opening a document.
 *
 * Applications should implement this interface to provide font loading
 * functionality when opening drawing databases that contain text entities.
 */
export interface AcDbFontLoader {
  /**
   * Loads the specified fonts.
   *
   * @param fontNames - Array of font names to load
   * @returns Promise that resolves when fonts are loaded
   *
   * @example
   * ```typescript
   * const fontLoader: AcDbFontLoader = {
   *   async load(fontNames: string[]) {
   *     // Load fonts implementation
   *   },
   *   async getAvaiableFonts() {
   *     return [];
   *   }
   * };
   * ```
   */
  load(fontNames: string[]): Promise<void>

  /**
   * Gets all available fonts.
   *
   * @returns Promise that resolves to an array of available font information
   *
   * @example
   * ```typescript
   * const fonts = await fontLoader.getAvaiableFonts();
   * console.log('Available fonts:', fonts);
   * ```
   */
  getAvaiableFonts(): Promise<AcDbFontInfo[]>
}

/**
 * Options for reading a drawing database.
 *
 * These options control how a drawing database is opened and processed.
 */
export interface AcDbOpenDatabaseOptions {
  /**
   * Opens the drawing database in read-only mode.
   *
   * When true, the database will be opened in read-only mode, preventing
   * any modifications to the database content.
   */
  readOnly?: boolean

  /**
   * Loader used to load fonts used in the drawing database.
   *
   * This loader will be used to load any fonts referenced by text entities
   * in the drawing database.
   */
  fontLoader?: AcDbFontLoader

  /**
   * The minimum number of items in one chunk.
   *
   * If this value is greater than the total number of entities in the
   * drawing database, the total number is used. This controls how the
   * database processing is broken into chunks for better performance.
   */
  minimumChunkSize?: number

  /**
   * Timeout for web worker parsing in milliseconds.
   *
   * This option is used only when the selected converter parses the drawing
   * file in a web worker. If omitted, the converter-level timeout is used.
   */
  timeout?: number

  /**
   * System variables to override in the database.
   *
   * This allows overriding system variable values when opening a database.
   * For example, to disable line weight display regardless of the database's
   * stored value, set { 'lwdisplay': false }.
   *
   * The keys are system variable names (case-insensitive), and values can be
   * number, boolean, or string types.
   */
  sysVars?: Record<string, number | boolean | string>

  /**
   * Whether entities on non-plottable ("no-plot") layers are drawn.
   *
   * - `true` (default): desktop AutoCAD editor semantics ??no-plot layers remain
   *   visible on screen (Defpoints, viewport frames on `*-NPLT`, etc.).
   * - `false`: web/publish viewer semantics (e.g. BIM 360 / ACC) ??entities on
   *   no-plot layers are omitted from display.
   */
  drawNoPlotLayers?: boolean

  /**
   * File name of the drawing being opened, including extension (for example `Plan.dwg`).
   *
   * When provided, updates the read-only **DWGNAME** system variable for this database.
   */
  fileName?: string
}

/**
 * Interface defining the tables available in a drawing database.
 *
 * This interface provides access to all the symbol tables in the database,
 * including block table, dimension style table, linetype table, text style table,
 * layer table, and viewport table.
 */
export interface AcDbTables {
  /** Registered application name table */
  readonly appIdTable: AcDbRegAppTable
  /** Block table containing block definitions */
  readonly blockTable: AcDbBlockTable
  /** Dimension style table containing dimension style definitions */
  readonly dimStyleTable: AcDbDimStyleTable
  /** Linetype table containing linetype definitions */
  readonly linetypeTable: AcDbLinetypeTable
  /** Text style table containing text style definitions */
  readonly textStyleTable: AcDbTextStyleTable
  /** View table containing named view definitions */
  readonly viewTable: AcDbViewTable
  /** Layer table containing layer definitions */
  readonly layerTable: AcDbLayerTable
  /** Viewport table containing viewport definitions */
  readonly viewportTable: AcDbViewportTable
}

/**
 * Options used to specify default data to create
 */
export interface AcDbCreateDefaultDataOptions {
  layer?: boolean
  lineType?: boolean
  textStyle?: boolean
  dimStyle?: boolean
  layout?: boolean
}

/**
 * The AcDbDatabase class represents an AutoCAD drawing file.
 *
 * Each AcDbDatabase object contains the various header variables, symbol tables,
 * table records, entities, and objects that make up the drawing. The AcDbDatabase
 * class has member functions to allow access to all the symbol tables, to read
 * and write to DWG files, to get or set database defaults, to execute various
 * database-level operations, and to get or set all header variables.
 *
 * @example
 * ```typescript
 * const database = new AcDbDatabase();
 * await database.read(dxfData, { readOnly: true });
 * const entities = database.tables.blockTable.modelSpace.entities;
 * ```
 */
export class AcDbDatabase extends AcDbObject {
  /** Sequence counter for default unsaved drawing names (Drawing1.dwg, Drawing2.dwg, ...). */
  private static _unsavedDrawingSequence = 0

  /** Version of the database */
  private _version: AcDbDwgVersion
  /** Angle base for the database */
  private _angbase: number
  /** Angle direction for the database */
  private _angdir: number
  /** Angle units for the database */
  private _aunits: AcDbAngleUnits
  /** Angular display precision (AUPREC), used with {@link AcDbDatabase.aunits | AUNITS}. */
  private _auprec: number
  /** Linear unit display format (LUNITS) for coordinates and distances. */
  private _lunits: AcDbLinearUnits
  /** Linear display precision (LUPREC), used with {@link lunits}. */
  private _luprec: number
  /** Current entity color */
  private _cecolor: AcCmColor
  /** Current entity linetype scale */
  private _celtscale: number
  /** Current entity linetype name */
  private _celtype: string
  /** Current entity line weight value */
  private _celweight: AcGiLineWeight
  /** Current entity transparency level */
  private _cetransparency: AcCmTransparency
  /** Current layer for the database */
  private _clayer: string
  /** Current multiline style for newly created MLINE entities */
  private _cmlstyle: string
  /** Current multiline scale for newly created MLINE entities */
  private _cmlscale: number
  /** Current multileader style for newly created MLEADER entities */
  private _cmleaderstyle: string
  /** Default background color for newly created hatch patterns */
  private _hpbackgroundcolor: AcCmColor
  /** Default color for newly created hatches */
  private _hpcolor: AcCmColor
  /** Default layer for newly created hatches and fills */
  private _hplayer: string
  /** Default transparency for newly created hatches and fills */
  private _hptransparency: AcCmTransparency
  /** Current text style name for the database */
  private _textstyle: string
  /** The extents of current Model Space */
  private _extents: AcGeBox3d
  /** Insertion units for the database */
  private _insunits: AcDbUnitsValue
  /** Feet-inch / fractional delimiter style (UNITMODE) */
  private _unitmode: number
  /** Legacy metric vs imperial flag (MEASUREMENT) */
  private _measurement: number
  /** Global linetype scale */
  private _ltscale: number
  /** The flag whether to display line weight */
  private _lwdisplay: boolean
  /** Point display mode */
  private _pdmode: number
  /** Point display size */
  private _pdsize: number
  /** Running object snap mode bitmask */
  private _osmode: number
  /** Orthogonal mode flag (ORTHOMODE): 0 = off, 1 = on */
  private _orthomode: number
  /** Tables in the database */
  private _tables: AcDbTables
  /** Nongraphical objects in the database */
  private _objects: {
    readonly dictionary: AcDbDictionary<AcDbDictionary>
    readonly imageDefinition: AcDbDictionary<AcDbRasterImageDef>
    readonly layout: AcDbLayoutDictionary
    readonly mleaderStyle: AcDbDictionary<AcDbMLeaderStyle>
    readonly mlineStyle: AcDbDictionary<AcDbMlineStyle>
    readonly xrecord: AcDbDictionary<AcDbXrecord>
  }
  /** Current space (model space or paper space) */
  private _currentSpace?: AcDbBlockTableRecord
  /** The maximum handle value in the database, used for generating unique object IDs */
  private _maxHandle: number
  /** Lazily created formatter for lengths, angles, and coordinates */
  private _formatter?: AcDbFormatter
  /**
   * When false, entities on non-plottable layers are not drawn (viewer semantics).
   * Set from {@link AcDbOpenDatabaseOptions.drawNoPlotLayers} when opening a database.
   */
  private _drawNoPlotLayers = true
  /** Current drawing file name (**DWGNAME**), including extension. */
  private _dwgname: string

  /** Manages transactions and undo/redo for this database. */
  readonly transactionManager: AcDbDatabaseTransactionManager

  private _eventBatchDepth = 0
  private _pendingEntityAppended: AcDbEntity[] = []
  private _pendingEntityErased: AcDbEntity[] = []
  private _pendingDictObjectSet: { object: AcDbObject; key: string }[] = []
  private _pendingDictObjectErased: { object: AcDbObject; key: string }[] = []

  /**
   * Events that can be triggered by the database.
   *
   * These events allow applications to respond to various database operations
   * such as entity modifications, layer changes, and progress updates.
   */
  public readonly events = {
    /** Fired when an object is set to the dictionary */
    dictObjetSet: new AcCmEventManager<AcDbDictObjectEventArgs>(),
    /** Fired when an object in the dictionary is removed */
    dictObjectErased: new AcCmEventManager<AcDbDictObjectEventArgs>(),
    /** Fired when an entity is appended to the database */
    entityAppended: new AcCmEventManager<AcDbEntityEventArgs>(),
    /** Fired when an entity is modified in the database */
    entityModified: new AcCmEventManager<AcDbEntityEventArgs>(),
    /** Fired when an entity is erased from the database */
    entityErased: new AcCmEventManager<AcDbEntityEventArgs>(),
    /** Fired when a layer is appended to the database */
    layerAppended: new AcCmEventManager<AcDbLayerEventArgs>(),
    /** Fired when a layer is modified in the database */
    layerModified: new AcCmEventManager<AcDbLayerModifiedEventArgs>(),
    /** Fired when a layer is erased from the database */
    layerErased: new AcCmEventManager<AcDbLayerEventArgs>(),
    /** Fired during database opening operations to report progress */
    openProgress: new AcCmEventManager<AcDbProgressdEventArgs>()
  }

  /**
   * Creates a new AcDbDatabase instance.
   */
  constructor() {
    super({ objectId: '0' })
    AcDbDatabase._unsavedDrawingSequence += 1
    this._dwgname = `Drawing${AcDbDatabase._unsavedDrawingSequence}.dwg`
    this._version = new AcDbDwgVersion('AC1014')
    this._angbase = 0
    this._angdir = 0
    this._aunits = AcDbAngleUnits.DecimalDegrees
    this._auprec = 0
    this._lunits = AcDbLinearUnits.Decimal
    this._luprec = 4
    this._celtscale = 1
    this._cecolor = new AcCmColor()
    this._celtype = ByLayer
    this._celweight = AcGiLineWeight.ByLayer
    this._cetransparency = new AcCmTransparency()
    this._clayer = '0'
    this._cmlstyle = DEFAULT_MLINE_STYLE
    this._cmlscale = 1
    this._cmleaderstyle = DEFAULT_MLEADER_STYLE
    this._hpbackgroundcolor = new AcCmColor(AcCmColorMethod.None)
    this._hpcolor = this._cecolor.clone()
    this._hplayer = '.'
    this._hptransparency = new AcCmTransparency()
    this._textstyle = DEFAULT_TEXT_STYLE
    this._extents = new AcGeBox3d()
    // TODO: Default value is 1 (imperial) or 4 (metric)
    this._insunits = AcDbUnitsValue.Millimeters
    this._unitmode = 0
    this._measurement = 1
    this._ltscale = 1
    this._lwdisplay = false
    this._pdmode = 0
    this._pdsize = 0
    this._osmode = 0
    this._orthomode = 0
    this._maxHandle = 0
    this._tables = {
      appIdTable: new AcDbRegAppTable(this),
      blockTable: new AcDbBlockTable(this),
      dimStyleTable: new AcDbDimStyleTable(this),
      linetypeTable: new AcDbLinetypeTable(this),
      textStyleTable: new AcDbTextStyleTable(this),
      viewTable: new AcDbViewTable(this),
      layerTable: new AcDbLayerTable(this),
      viewportTable: new AcDbViewportTable(this)
    }
    this._objects = {
      dictionary: new AcDbDictionary(this),
      imageDefinition: new AcDbDictionary(this),
      layout: new AcDbLayoutDictionary(this),
      mleaderStyle: new AcDbDictionary(this),
      mlineStyle: new AcDbDictionary(this),
      xrecord: new AcDbDictionary(this)
    }
    this.transactionManager = new AcDbDatabaseTransactionManager(this)
  }

  /**
   * Gets all tables in this drawing database.
   *
   * @returns Object containing all the symbol tables in the database
   *
   * @example
   * ```typescript
   * const tables = database.tables;
   * const layers = tables.layerTable;
   * const blocks = tables.blockTable;
   * ```
   */
  get tables() {
    return this._tables
  }

  /**
   * Gets all nongraphical objects in this drawing database.
   *
   * @returns Object containing all nongraphical objects in the database
   *
   * @example
   * ```typescript
   * const objects = database.objects;
   * const layout = objects.layout;
   * ```
   */
  get objects() {
    return this._objects
  }

  /**
   * Looks up a database-resident object by its object ID.
   *
   * Search order: entities, symbol table records, dictionary objects
   * (including nested dictionaries), then the database object itself.
   *
   * @param id - Object identifier to resolve
   * @param _openErased - Reserved for erased-object support
   * @returns The matching object, or undefined if not found
   */
  getObjectById(id: AcDbObjectId, _openErased = false): AcDbObject | undefined {
    if (id === this.objectId) {
      return this
    }

    const entity = this.tables.blockTable.getEntityById(id)
    if (entity) {
      return entity
    }

    const symbolTables: AcDbSymbolTable[] = [
      this.tables.appIdTable,
      this.tables.blockTable,
      this.tables.dimStyleTable,
      this.tables.linetypeTable,
      this.tables.textStyleTable,
      this.tables.viewTable,
      this.tables.layerTable,
      this.tables.viewportTable
    ]
    for (const table of symbolTables) {
      const record = table.getIdAt(id)
      if (record) {
        return record
      }
    }

    for (const dictionary of this.getRootDictionaries()) {
      if (dictionary.objectId === id) {
        return dictionary
      }
      const object = this.findObjectInDictionary(dictionary, id)
      if (object) {
        return object
      }
    }

    return undefined
  }

  /**
   * Returns true when the transaction manager is actively recording changes.
   *
   * Shortcut for {@link AcDbDatabaseTransactionManager.isRecording}.
   */
  isUndoRecording(): boolean {
    return this.transactionManager.isRecording()
  }

  /**
   * Opens a database object, preferring the active transaction when present.
   *
   * Editor shortcut: when a transaction is active, objects are opened through it
   * so mutations are tracked for undo. Otherwise falls back to {@link getObjectById}.
   */
  private openObject<T extends AcDbObject>(
    objectId: AcDbObjectId,
    mode: AcDbOpenMode
  ): T | undefined {
    const tr = this.transactionManager.currentTransaction()
    if (tr) {
      const opened = tr.getObject<T>(objectId, mode)
      if (opened) {
        return opened
      }
    }
    return this.getObjectById(objectId) as T | undefined
  }

  /**
   * Opens a database object for read through the active transaction when present.
   *
   * Editor shortcut; see {@link openObject}.
   */
  openObjectForRead<T extends AcDbObject>(
    objectId: AcDbObjectId
  ): T | undefined {
    return this.openObject<T>(objectId, AcDbOpenMode.kForRead)
  }

  /**
   * Opens a database object for write through the active transaction when present.
   *
   * Editor shortcut; see {@link openObject}.
   */
  openObjectForWrite<T extends AcDbObject>(
    objectId: AcDbObjectId
  ): T | undefined {
    return this.openObject<T>(objectId, AcDbOpenMode.kForWrite)
  }

  /**
   * Opens an entity for read through the active transaction when present.
   *
   * Editor shortcut; see {@link openObject}.
   */
  openEntityForRead(
    entityOrId: AcDbObjectId | AcDbEntity
  ): AcDbEntity | undefined {
    const objectId =
      typeof entityOrId === 'string' ? entityOrId : entityOrId.objectId
    return this.openObjectForRead<AcDbEntity>(objectId)
  }

  /**
   * Opens an entity for write through the active transaction when present.
   *
   * Editor shortcut; see {@link openObject}.
   */
  openEntityForWrite(
    entityOrId: AcDbObjectId | AcDbEntity
  ): AcDbEntity | undefined {
    const objectId =
      typeof entityOrId === 'string' ? entityOrId : entityOrId.objectId
    return this.openObjectForWrite<AcDbEntity>(objectId)
  }

  /**
   * Runs a database mutation as one undoable operation.
   *
   * Editor shortcut: skips creating a new undo mark when the transaction manager
   * is already recording (nested editor operations). Otherwise wraps `fn` in
   * {@link AcDbDatabaseTransactionManager.runUndoable}.
   */
  runDatabaseEdit(label: string, fn: () => void): void {
    if (this.isUndoRecording()) {
      fn()
      return
    }

    this.transactionManager.runUndoable(label, fn)
  }

  /**
   * Returns the top-level named object dictionaries owned by this database.
   */
  getRootDictionaries(): AcDbDictionary[] {
    return [
      this.objects.dictionary,
      this.objects.imageDefinition,
      this.objects.layout,
      this.objects.mleaderStyle,
      this.objects.mlineStyle,
      this.objects.xrecord
    ]
  }

  /**
   * Recursively searches a dictionary tree for an object with the given ID.
   *
   * @param dictionary - Root dictionary to search (including nested dictionaries)
   * @param id - Object identifier to resolve
   * @returns Matching object, or undefined when not found under `dictionary`
   */
  private findObjectInDictionary(
    dictionary: AcDbDictionary,
    id: AcDbObjectId
  ): AcDbObject | undefined {
    if (dictionary.objectId === id) {
      return dictionary
    }

    const direct = dictionary.getIdAt(id)
    if (direct) {
      return direct
    }

    for (const [, entry] of dictionary.entries()) {
      if (entry.objectId === id) {
        return entry
      }
      if (entry instanceof AcDbDictionary) {
        const nested = this.findObjectInDictionary(entry, id)
        if (nested) {
          return nested
        }
      }
    }

    return undefined
  }

  /**
   * Begins suppressing database events until {@link endEventBatch} is called.
   */
  beginEventBatch(): void {
    this._eventBatchDepth++
  }

  /**
   * Ends event batching and dispatches accumulated entity and layer events when the outermost batch closes.
   */
  endEventBatch(): void {
    if (this._eventBatchDepth <= 0) {
      return
    }
    this._eventBatchDepth--
    if (this._eventBatchDepth === 0) {
      this.transactionManager.flushPendingEntityModifiedEvents()
      this.transactionManager.flushPendingLayerModifiedEvents()
      this.flushEventBatch()
    }
  }

  /**
   * Returns true when database events are being batched.
   */
  isEventBatched(): boolean {
    return this._eventBatchDepth > 0
  }

  /**
   * Dispatches or queues an entity-appended notification.
   *
   * @param entity - One entity or batch of entities added to model/paper space
   */
  notifyEntityAppended(entity: AcDbEntity | AcDbEntity[]): void {
    if (this.isEventBatched()) {
      const items = Array.isArray(entity) ? entity : [entity]
      this._pendingEntityAppended.push(...items)
      return
    }
    this.events.entityAppended.dispatch({
      database: this,
      entity
    })
  }

  /**
   * Dispatches or queues an entity-erased notification.
   *
   * @param entity - One entity or batch of entities removed from model/paper space
   */
  notifyEntityErased(entity: AcDbEntity | AcDbEntity[]): void {
    if (this.isEventBatched()) {
      const items = Array.isArray(entity) ? entity : [entity]
      this._pendingEntityErased.push(...items)
      return
    }
    this.events.entityErased.dispatch({
      database: this,
      entity
    })
  }

  /**
   * Dispatches or queues a dictionary-object-set notification.
   *
   * @param object - Object inserted or replaced in a named dictionary
   * @param key - Dictionary key under which the object is stored
   */
  notifyDictObjectSet(object: AcDbObject, key: string): void {
    if (this.isEventBatched()) {
      this._pendingDictObjectSet.push({ object, key })
      return
    }
    this.events.dictObjetSet.dispatch({
      database: this,
      object,
      key
    })
  }

  /**
   * Dispatches or queues a dictionary-object-erased notification.
   *
   * @param object - Object removed from a named dictionary
   * @param key - Dictionary key that previously referenced the object
   */
  notifyDictObjectErased(object: AcDbObject, key: string): void {
    if (this.isEventBatched()) {
      this._pendingDictObjectErased.push({ object, key })
      return
    }
    this.events.dictObjectErased.dispatch({
      database: this,
      object,
      key
    })
  }

  /**
   * Dispatches all notifications accumulated while event batching was active.
   *
   * Appended and erased entities are dispatched in batch arrays where applicable.
   */
  private flushEventBatch(): void {
    if (this._pendingEntityAppended.length > 0) {
      const appended = this._pendingEntityAppended
      this._pendingEntityAppended = []
      this.events.entityAppended.dispatch({
        database: this,
        entity: appended
      })
    }

    if (this._pendingEntityErased.length > 0) {
      const erased = this._pendingEntityErased
      this._pendingEntityErased = []
      this.events.entityErased.dispatch({
        database: this,
        entity: erased
      })
    }

    if (this._pendingDictObjectSet.length > 0) {
      const dictSet = this._pendingDictObjectSet
      this._pendingDictObjectSet = []
      for (const { object, key } of dictSet) {
        this.events.dictObjetSet.dispatch({
          database: this,
          object,
          key
        })
      }
    }

    if (this._pendingDictObjectErased.length > 0) {
      const dictErased = this._pendingDictObjectErased
      this._pendingDictObjectErased = []
      for (const { object, key } of dictErased) {
        this.events.dictObjectErased.dispatch({
          database: this,
          object,
          key
        })
      }
    }
  }

  /**
   * Formatter for linear distances, point coordinates, and angles using this database's
   * **LUNITS**, **AUNITS**, and related system variables.
   *
   * @example
   * ```typescript
   * database.formatter.formatLength(12.3456);
   * database.formatter.formatPoint3d(point);
   * database.formatter.formatAngle(angleRadians, { showUnits: true });
   * ```
   */
  get formatter(): AcDbFormatter {
    return (this._formatter ??= new AcDbFormatter(this))
  }

  /**
   * Generates a new unique object ID (handle) for the database.
   * The handle is a hexadecimal string that increments from the current max handle.
   *
   * @returns A new unique object ID as a hexadecimal string
   *
   * @example
   * ```typescript
   * const newHandle = database.generateHandle();
   * console.log(`New handle: ${newHandle}`);
   * ```
   */
  generateHandle(): AcDbObjectId {
    this._maxHandle++
    return this._maxHandle.toString(16).toUpperCase()
  }

  /**
   * Updates the maximum handle value if the provided handle is greater.
   * This is called when setting an object's objectId from external sources (e.g., reading DXF/DWG).
   *
   * @param handle - The handle to check and potentially update maxHandle with
   *
   * @example
   * ```typescript
   * database.updateMaxHandle('1A2B');
   * ```
   */
  updateMaxHandle(handle: string): void {
    const handleValue = parseInt(handle, 16)
    if (!isNaN(handleValue) && handleValue > this._maxHandle) {
      this._maxHandle = handleValue
    }
  }

  /**
   * Commits an object's handle into the database.
   *
   * Generates a new handle when the object doesn't have one, when it is temporary,
   * or when a duplicate id exists in the target collection.
   *
   * @internal
   */
  commitObjectHandle(
    object: AcDbObject,
    hasId?: (id: AcDbObjectId) => boolean
  ) {
    const objectId = object.getAttrWithoutException('objectId')
    if (!objectId || object.isTemp || (hasId && hasId(objectId))) {
      object.objectId = this.generateHandle()
    } else {
      this.updateMaxHandle(objectId)
    }
  }

  /**
   * Gets the object ID of the AcDbBlockTableRecord of the current space.
   *
   * The current space can be either model space or paper space.
   *
   * @returns The object ID of the current space
   *
   * @example
   * ```typescript
   * const currentSpaceId = database.currentSpaceId;
   * ```
   */
  get currentSpaceId() {
    if (!this._currentSpace) {
      this._currentSpace = this._tables.blockTable.modelSpace
    }
    return this._currentSpace.objectId
  }

  /**
   * Sets the current space by object ID.
   *
   * @param value - The object ID of the block table record to set as current space
   * @throws {Error} When the specified block table record ID doesn't exist
   *
   * @example
   * ```typescript
   * database.currentSpaceId = 'some-block-record-id';
   * ```
   */
  set currentSpaceId(value: AcDbObjectId) {
    const currentSpace = this.tables.blockTable.getIdAt(value)
    if (currentSpace == null) {
      throw new Error(
        `[AcDbDatabase] The specified block table record id '${value}' doesn't exist in the drawing database!`
      )
    } else {
      this._currentSpace = currentSpace
    }
  }

  /**
   * Angular unit **display and entry** format for the drawing (AutoCAD system variable **AUNITS**).
   *
   * This does not change how angles are stored internally (radians in geometry); it controls how
   * angles are formatted in the UI and how numeric angle input is interpreted, together with
   * {@link angbase} (**ANGBASE**) and {@link angdir} (**ANGDIR**).
   *
   * @returns Integer code matching {@link AcDbAngleUnits}:
   *
   * | Value | Meaning |
   * |------:|---------|
   * | `0` | **Decimal degrees** ??e.g. `45.5` |
   * | `1` | **Degrees/minutes/seconds** ??e.g. `45d30'15"` |
   * | `2` | **Gradians** ??e.g. `50g` (400 grads = full circle) |
   * | `3` | **Radians** ??e.g. `0.785398...` |
   * | `4` | **Surveyor's units** ??quadrant bearing notation (e.g. `N 45d30'15" E`) |
   *
   * @remarks
   * Prefer assigning {@link AcDbAngleUnits} enum members for readability instead of raw integers.
   *
   * @see {@link AcDbAngleUnits} for the canonical enum used by this codebase.
   * @see {@link https://help.autodesk.com/view/ACD/2027/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-C7C0F6A5-7982-43DB-97F9-5B9B0044E9FA-htm.html | AutoCAD Help: AUNITS}
   *
   * @example
   * ```typescript
   * const angleUnits = database.aunits;
   * ```
   */
  get aunits(): number {
    return this._aunits
  }

  /**
   * Sets **AUNITS** ??the angular unit display format (see {@link aunits} getter for value meanings).
   *
   * @param value - Integer `0`??4` per {@link AcDbAngleUnits}, or `undefined`/`null` coerced to `0` by the setter chain.
   *
   * @example
   * ```typescript
   * database.aunits = AcDbAngleUnits.DecimalDegrees;
   * ```
   */
  set aunits(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.AUNITS,
      this._aunits,
      value ?? 0,
      nextValue => {
        this._aunits = nextValue
      }
    )
  }

  /**
   * Angular display precision for the drawing (**AUPREC**): how many decimal places (or equivalent)
   * are used when showing angles, in conjunction with {@link aunits}.
   *
   * AutoCAD typically uses integers in the range **0??**; behavior for other values is
   * implementation-defined in this library (stored as-is).
   *
   * @see {@link https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-EE1ED20C-1096-4299-820F-83F1BC9B96F3 | AutoCAD Help: AUPREC}
   */
  get auprec(): number {
    return this._auprec
  }

  /**
   * Sets **AUPREC** ??angular display precision (see {@link auprec} getter).
   */
  set auprec(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.AUPREC,
      this._auprec,
      value ?? 0,
      nextValue => {
        this._auprec = nextValue
      }
    )
  }

  /**
   * Linear unit **display and entry** format for coordinates and lengths (**LUNITS**).
   *
   * This does not set real-world drawing units for inserts (see {@link insunits}); it controls how
   * linear distances are shown and parsed (scientific, decimal, engineering, and so on).
   *
   * @returns Integer code matching {@link AcDbLinearUnits}:
   *
   * | Value | Meaning |
   * |------:|---------|
   * | `1` | **Scientific** |
   * | `2` | **Decimal** |
   * | `3` | **Engineering** (feet + decimal inches) |
   * | `4` | **Architectural** (feet + fractional inches) |
   * | `5` | **Fractional** |
   * | `6` | **Windows desktop** (processing / computational format) |
   *
   * @remarks
   * Prefer assigning {@link AcDbLinearUnits} enum members instead of raw integers.
   *
   * @see {@link AcDbLinearUnits}
   * @see {@link https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-D7C80D1F-B1C0-44A9-898E-B3100FF391CB | AutoCAD Help: LUNITS}
   */
  get lunits(): number {
    return this._lunits
  }

  /**
   * Sets **LUNITS** ??linear display format (see {@link lunits} getter).
   *
   * @param value - Integer per {@link AcDbLinearUnits}, or coerced default {@link AcDbLinearUnits.Decimal} when `undefined`/`null`.
   */
  set lunits(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.LUNITS,
      this._lunits,
      value ?? AcDbLinearUnits.Decimal,
      nextValue => {
        this._lunits = nextValue
      }
    )
  }

  /**
   * Linear display precision for the drawing (**LUPREC**): number of decimal places (or equivalent)
   * used when showing linear distances, together with {@link lunits}.
   *
   * AutoCAD typically uses integers in the range **0??**; initial value is commonly **4**.
   * Values outside that range are stored as-is by this library.
   *
   * @see {@link https://help.autodesk.com/view/ACD/2027/ENU/?guid=GUID-5FFF39D6-EFC7-49F5-B56A-6023EB5C0DE7 | AutoCAD Help: LUPREC}
   */
  get luprec(): number {
    return this._luprec
  }

  /**
   * Sets **LUPREC** ??linear display precision (see {@link luprec} getter).
   */
  set luprec(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.LUPREC,
      this._luprec,
      value ?? 4,
      nextValue => {
        this._luprec = nextValue
      }
    )
  }

  /**
   * Gets the version of the database.
   *
   * @returns The version of the database
   *
   */
  get version(): AcDbDwgVersion {
    return this._version
  }

  /**
   * Sets the version of the database.
   *
   * @param value - The version value of the database
   */
  set version(value: string | number) {
    this.updateSysVar(
      AcDbSystemVariables.ACADVER,
      this._version,
      new AcDbDwgVersion(value),
      nextValue => {
        this._version = nextValue
      }
    )
  }

  /**
   * Gets the drawing-units value for automatic scaling of blocks, images, or xrefs.
   *
   * This is the current INSUNITS value for the database.
   *
   * @returns The insertion units value
   *
   * @example
   * ```typescript
   * const insertionUnits = database.insunits;
   * ```
   */
  get insunits(): number {
    return this._insunits
  }

  /**
   * Sets the drawing-units value for automatic scaling.
   *
   * @param value - The new insertion units value
   *
   * @example
   * ```typescript
   * database.insunits = AcDbUnitsValue.Millimeters;
   * ```
   */
  set insunits(value: number) {
    // TODO: Default value is 1 (imperial) or 4 (metric)
    this.updateSysVar(
      AcDbSystemVariables.INSUNITS,
      this._insunits,
      value ?? 4,
      nextValue => {
        this._insunits = nextValue
      }
    )
  }

  /**
   * Controls how feet-inch and fractional linear values are delimited (**UNITMODE**).
   *
   * - `0`: Report format (for example `1'-3 1/2"`)
   * - `1`: Input format (for example `1'-3-1/2"`, fewer spaces)
   *
   * @see {@link https://help.autodesk.com/view/ACD/2027/ENU/?guid=GUID-C52134E8-10EB-4AE7-A0C0-8F798C68F823 | AutoCAD Help: UNITMODE}
   */
  get unitmode(): number {
    return this._unitmode
  }

  set unitmode(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.UNITMODE,
      this._unitmode,
      value ?? 0,
      nextValue => {
        this._unitmode = nextValue
      }
    )
  }

  /**
   * Legacy drawing measurement system (**MEASUREMENT**): `0` = English, `1` = metric.
   *
   * When **INSUNITS** is unitless, this selects the default real-world unit family for labels.
   */
  get measurement(): number {
    return this._measurement
  }

  set measurement(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.MEASUREMENT,
      this._measurement,
      value ?? 1,
      nextValue => {
        this._measurement = nextValue
      }
    )
  }

  /**
   * Gets the line type scale factor.
   *
   * @returns The line type scale factor
   *
   * @example
   * ```typescript
   * const lineTypeScale = database.ltscale;
   * ```
   */
  get ltscale(): number {
    return this._ltscale
  }

  /**
   * Sets the line type scale factor.
   *
   * @param value - The new line type scale factor
   *
   * @example
   * ```typescript
   * database.ltscale = 2.0;
   * ```
   */
  set ltscale(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.LTSCALE,
      this._ltscale,
      value ?? 1,
      nextValue => {
        this._ltscale = nextValue
      }
    )
  }

  /**
   * Gets the flag whether to display line weight.
   *
   * @returns The flag whether to display line weight.
   *
   * @example
   * ```typescript
   * const lineTypeScale = database.ltscale;
   * ```
   */
  get lwdisplay(): boolean {
    return this._lwdisplay
  }

  /**
   * Sets the flag whether to display line weight.
   *
   * @param value - The flag whether to display line weight.
   *
   * @example
   * ```typescript
   * database.lwdisplay = true;
   * ```
   */
  /**
   * Whether entities on non-plottable layers should be drawn.
   *
   * Configured via {@link AcDbOpenDatabaseOptions.drawNoPlotLayers} when the
   * database is opened. Defaults to `true`.
   */
  get drawNoPlotLayers() {
    return this._drawNoPlotLayers
  }

  /**
   * Name of the current drawing file (**DWGNAME**), including extension.
   *
   * Read-only through the system-variable API; updated when a drawing is opened
   * or via {@link setDwgName} after save.
   *
   * @see https://help.autodesk.com/view/ACD/2023/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-A89861EF-5F4F-46C6-A1DB-9D985A3858C9-htm.html
   */
  get dwgname(): string {
    return this._dwgname
  }

  /**
   * Updates **DWGNAME** after opening or saving a drawing.
   *
   * @param value - Drawing file name, including extension.
   */
  setDwgName(value: string): void {
    const normalized = value.trim()
    if (!normalized) {
      return
    }

    this.updateSysVar(
      AcDbSystemVariables.DWGNAME,
      this._dwgname,
      normalized,
      nextValue => {
        this._dwgname = nextValue
      }
    )
  }

  /**
   * Returns whether entities on the given layer should be drawn under the
   * current {@link drawNoPlotLayers} setting.
   *
   * Layer off/freeze visibility is handled separately by the viewer; this only
   * reflects the no-plot policy.
   */
  isLayerDrawable(layerName: string): boolean {
    if (this._drawNoPlotLayers) {
      return true
    }
    const layer = this.tables.layerTable.getAt(layerName)
    return layer == null || layer.isPlottable
  }

  set lwdisplay(value: boolean) {
    this.updateSysVar(
      AcDbSystemVariables.LWDISPLAY,
      this._lwdisplay,
      value ?? false,
      nextValue => {
        this._lwdisplay = nextValue
      }
    )
  }

  /**
   * Gets the color of new objects as they are created.
   *
   * @returns The current entity color
   *
   * @example
   * ```typescript
   * const currentColor = database.cecolor;
   * ```
   */
  get cecolor(): AcCmColor {
    return this._cecolor
  }

  /**
   * Sets the color of new objects as they are created.
   *
   * @param value - The new current entity color
   *
   * @example
   * ```typescript
   * database.cecolor = new AcCmColor(0xFF0000);
   * ```
   */
  set cecolor(value: AcCmColor) {
    this.updateSysVar(
      AcDbSystemVariables.CECOLOR,
      this._cecolor,
      value || 0,
      nextValue => {
        this._cecolor = nextValue.clone()
      }
    )
  }

  /**
   * The line type scaling for new objects relative to the ltscale setting. A line created with
   * celtscale = 2 in a drawing with ltscale set to 0.5 would appear the same as a line created
   * with celtscale = 1 in a drawing with ltscale = 1.
   */
  get celtscale(): number {
    return this._celtscale
  }
  set celtscale(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.CELTSCALE,
      this._celtscale,
      value ?? 1,
      nextValue => {
        this._celtscale = nextValue
      }
    )
  }

  /**
   * The linetype of new objects as they are created.
   */
  get celtype(): string {
    return this._celtype
  }
  set celtype(value: string) {
    const nextValue = this.normalizeLinetypeName(value ?? ByLayer)
    this.updateSysVar(
      AcDbSystemVariables.CELTYPE,
      this._celtype,
      nextValue,
      normalizedValue => {
        this._celtype = normalizedValue
      }
    )
  }

  /**
   * The layer of new objects as they are created.
   */
  get celweight(): AcGiLineWeight {
    return this._celweight
  }
  set celweight(value: AcGiLineWeight) {
    this.updateSysVar(
      AcDbSystemVariables.CELWEIGHT,
      this._celweight,
      value ?? AcGiLineWeight.ByLayer,
      nextValue => {
        this._celweight = nextValue
      }
    )
  }

  /**
   * The transparency level of new objects as they are created.
   *
   * Can be ByLayer, ByBlock, or a value from 0 to 90 (percentage).
   */
  get cetransparency(): AcCmTransparency {
    return this._cetransparency
  }
  set cetransparency(value: AcCmTransparency) {
    this.updateSysVar(
      AcDbSystemVariables.CETRANSPARENCY,
      this._cetransparency,
      value ?? new AcCmTransparency(),
      nextValue => {
        this._cetransparency = nextValue.clone()
      }
    )
  }

  /**
   * The layer of new objects as they are created.
   */
  get clayer(): string {
    return this._clayer
  }
  set clayer(value: string) {
    this.updateSysVar(
      AcDbSystemVariables.CLAYER,
      this._clayer,
      value ?? '0',
      nextValue => {
        this._clayer = nextValue
      }
    )
  }

  /**
   * The multiline style name used for newly created MLINE entities.
   */
  get cmlstyle(): string {
    return this._cmlstyle
  }
  set cmlstyle(value: string) {
    this.updateSysVar(
      AcDbSystemVariables.CMLSTYLE,
      this._cmlstyle,
      value ?? DEFAULT_MLINE_STYLE,
      nextValue => {
        this._cmlstyle = nextValue
      }
    )
  }

  /**
   * The multiline scale used for newly created MLINE entities.
   */
  get cmlscale(): number {
    return this._cmlscale
  }
  set cmlscale(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.CMLSCALE,
      this._cmlscale,
      value ?? 1,
      nextValue => {
        this._cmlscale = nextValue
      }
    )
  }

  /**
   * The multileader style name used for newly created MLEADER entities.
   */
  get cmleaderstyle(): string {
    return this._cmleaderstyle
  }
  set cmleaderstyle(value: string) {
    this.updateSysVar(
      AcDbSystemVariables.CMLEADERSTYLE,
      this._cmleaderstyle,
      value ?? DEFAULT_MLEADER_STYLE,
      nextValue => {
        this._cmleaderstyle = nextValue
      }
    )
  }

  /**
   * The default hatch background color string.
   */
  get hpbackgroundcolor(): AcCmColor {
    return this._hpbackgroundcolor
  }
  set hpbackgroundcolor(value: AcCmColor) {
    this.updateSysVar(
      AcDbSystemVariables.HPBACKGROUNDCOLOR,
      this._hpbackgroundcolor,
      value ?? new AcCmColor(AcCmColorMethod.None),
      nextValue => {
        this._hpbackgroundcolor = nextValue.clone()
      }
    )
  }

  /**
   * The default color string used for newly created hatches.
   */
  get hpcolor(): AcCmColor {
    return this._hpcolor
  }
  set hpcolor(value: AcCmColor) {
    this.updateSysVar(
      AcDbSystemVariables.HPCOLOR,
      this._hpcolor,
      value ?? this._cecolor,
      nextValue => {
        this._hpcolor = nextValue.clone()
      }
    )
  }

  /**
   * The default layer used for newly created hatches and fills.
   */
  get hplayer(): string {
    return this._hplayer
  }
  set hplayer(value: string) {
    this.updateSysVar(
      AcDbSystemVariables.HPLAYER,
      this._hplayer,
      value ?? '.',
      nextValue => {
        this._hplayer = nextValue
      }
    )
  }

  /**
   * The default transparency string used for newly created hatches and fills.
   */
  get hptransparency(): AcCmTransparency {
    return this._hptransparency
  }
  set hptransparency(value: AcCmTransparency) {
    this.updateSysVar(
      AcDbSystemVariables.HPTRANSPARENCY,
      this._hptransparency,
      value ?? new AcCmTransparency(),
      nextValue => {
        this._hptransparency = nextValue.clone()
      }
    )
  }

  /**
   * The text style name for new text objects.
   */
  get textstyle(): string {
    return this._textstyle
  }
  set textstyle(value: string) {
    this.updateSysVar(
      AcDbSystemVariables.TEXTSTYLE,
      this._textstyle,
      value ?? DEFAULT_TEXT_STYLE,
      nextValue => {
        this._textstyle = nextValue
      }
    )
  }

  /**
   * The zero (0) base angle with respect to the current UCS in radians.
   */
  get angbase(): number {
    return this._angbase
  }
  set angbase(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.ANGBASE,
      this._angbase,
      value ?? 0,
      nextValue => {
        this._angbase = nextValue
      }
    )
  }

  /**
   * The direction of positive angles.
   * - 0: Counterclockwise
   * - 1: Clockwise
   */
  get angdir(): number {
    return this._angdir
  }
  set angdir(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.ANGDIR,
      this._angdir,
      value ?? 0,
      nextValue => {
        this._angdir = nextValue
      }
    )
  }

  /**
   * The current Model Space EXTMAX value
   */
  get extmax(): AcGePoint3d {
    return this._extents.max
  }
  set extmax(value: AcGePoint3dLike) {
    if (value) {
      const oldExtMax = this._extents.max.clone()
      this._extents.expandByPoint(value)
      if (!this._extents.max.equals(oldExtMax)) {
        this.triggerSysVarChangedEvent(
          AcDbSystemVariables.EXTMAX,
          oldExtMax,
          this._extents.max
        )
      }
    }
  }

  /**
   * The current Model Space EXTMIN value
   */
  get extmin(): AcGePoint3d {
    return this._extents.min
  }
  set extmin(value: AcGePoint3dLike) {
    if (value) {
      const oldExtMin = this._extents.min.clone()
      this._extents.expandByPoint(value)
      if (!this._extents.min.equals(oldExtMin)) {
        this.triggerSysVarChangedEvent(
          AcDbSystemVariables.EXTMIN,
          oldExtMin,
          this._extents.min
        )
      }
    }
  }

  /**
   * The extents of current Model Space
   */
  get extents() {
    return this._extents
  }

  /**
   * Point display mode. Please get more details on value of this property from [this page](https://help.autodesk.com/view/ACDLT/2022/ENU/?guid=GUID-82F9BB52-D026-4D6A-ABA6-BF29641F459B).
   */
  get pdmode(): number {
    return this._pdmode
  }
  set pdmode(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.PDMODE,
      this._pdmode,
      value ?? 0,
      nextValue => {
        this._pdmode = nextValue
      }
    )
  }

  /**
   * Point display size.
   * - 0: Creates a point at 5 percent of the drawing area height
   * - > 0: Specifies an absolute size
   * - < 0: Specifies a percentage of the viewport size
   */
  get pdsize(): number {
    return this._pdsize
  }
  set pdsize(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.PDSIZE,
      this._pdsize,
      value ?? 0,
      nextValue => {
        this._pdsize = nextValue
      }
    )
  }

  /**
   * Running Object Snap (OSNAP) mode bitmask.
   */
  get osmode(): number {
    return this._osmode
  }
  set osmode(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.OSMODE,
      this._osmode,
      value ?? 0,
      nextValue => {
        this._osmode = nextValue
      }
    )
  }

  /**
   * Orthogonal mode flag (ORTHOMODE). When on, cursor movement is constrained
   * to horizontal or vertical relative to the current UCS.
   */
  get orthomode(): number {
    return this._orthomode
  }
  set orthomode(value: number) {
    this.updateSysVar(
      AcDbSystemVariables.ORTHOMODE,
      this._orthomode,
      value ?? 0,
      nextValue => {
        this._orthomode = nextValue
      }
    )
  }

  /**
   * Reads drawing data from a string or ArrayBuffer.
   *
   * This method parses the provided data and populates the database with
   * the resulting entities, tables, and objects. The method supports
   * both DXF and DWG file formats.
   *
   * @param data - The drawing data as a string or ArrayBuffer
   *   - For DXF files: Pass a string containing the DXF content
   *   - For DWG files: Pass an ArrayBuffer instance containing the binary DWG data
   * @param options - Options for reading the database
   * @param fileType - The type of file being read (defaults to DXF)
   *
   * @example
   * ```typescript
   * // Reading a DXF file (string)
   * const database = new AcDbDatabase();
   * await database.read(dxfString, { readOnly: true }, AcDbFileType.DXF);
   *
   * // Reading a DWG file (ArrayBuffer)
   * const database = new AcDbDatabase();
   * await database.read(dwgArrayBuffer, { readOnly: true }, AcDbFileType.DWG);
   * ```
   */
  async read(
    data: ArrayBuffer,
    options: AcDbOpenDatabaseOptions,
    fileType: AcDbConverterType = AcDbFileType.DXF
  ) {
    const converter = AcDbDatabaseConverterManager.instance.get(fileType)
    if (converter == null)
      throw new Error(
        `Database converter for file type '${fileType}' isn't registered and can can't read this file!`
      )

    this.clear()
    this._drawNoPlotLayers = options?.drawNoPlotLayers ?? true
    if (options?.fileName) {
      this.setDwgName(options.fileName)
    }

    await converter.read(
      data,
      this,
      (options && options.minimumChunkSize) || 10,
      async (
        percentage: number,
        stage: AcDbConversionStage,
        stageStatus: AcDbStageStatus,
        data?: unknown
      ) => {
        this.events.openProgress.dispatch({
          database: this,
          percentage: percentage,
          stage: 'CONVERSION',
          subStage: stage,
          subStageStatus: stageStatus,
          data: data
        })
        if (
          options &&
          options.fontLoader &&
          stage == 'FONT' &&
          stageStatus == 'END'
        ) {
          const fonts = data
            ? (data as string[])
            : this.tables.textStyleTable.fonts
          await options.fontLoader.load(fonts)
        }
      },
      options?.timeout,
      options?.sysVars
    )

    this.ensureDatabaseDefaults()
  }

  /**
   * Read AutoCAD DXF or DWG drawing specified by the URL into the database object.
   * The method automatically detects the file type based on the URL extension:
   * - .dxf files are read as text using readAsText()
   * - .dwg files are read as binary data using readAsArrayBuffer()
   * @param url Input the URL linked to one AutoCAD DXF or DWG file
   * @param options Input options to read drawing data
   */
  async openUri(url: string, options: AcDbOpenDatabaseOptions): Promise<void> {
    this.events.openProgress.dispatch({
      database: this,
      percentage: 0,
      stage: 'FETCH_FILE',
      subStageStatus: 'START'
    })

    const response = await fetch(url)
    if (!response.ok) {
      this.events.openProgress.dispatch({
        database: this,
        percentage: 100,
        stage: 'FETCH_FILE',
        subStageStatus: 'ERROR'
      })
      throw new Error(
        `Failed to fetch file '${url}' with HTTP status code '${response.status}'!`
      )
    }

    const contentLength = response.headers.get('content-length')
    const totalBytes = contentLength ? parseInt(contentLength, 10) : null
    let loadedBytes = 0

    // Create a reader to track progress
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const chunks = []

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value)
      loadedBytes += value.length

      // Calculate and report progress if we know the total size
      if (totalBytes !== null) {
        const percentage = Math.round((loadedBytes / totalBytes) * 100)
        this.events.openProgress.dispatch({
          database: this,
          percentage: percentage,
          stage: 'FETCH_FILE',
          subStageStatus: 'IN-PROGRESS'
        })
      }
    }

    // Combine all chunks into a single buffer
    const content = new Uint8Array(loadedBytes)
    let position = 0
    for (const chunk of chunks) {
      content.set(chunk, position)
      position += chunk.length
    }

    const fileName = this.getFileNameFromUri(url)
    if (fileName) {
      this.setDwgName(fileName)
    }
    const fileExtension = fileName.toLowerCase().split('.').pop()
    if (fileExtension === 'dwg') {
      // DWG files are binary, convert to ArrayBuffer
      await this.read(content.buffer, options, AcDbFileType.DWG)
    } else if (fileExtension === 'dxf') {
      await this.read(content.buffer, options, AcDbFileType.DXF)
    } else {
      await this.read(content.buffer, options, fileExtension)
    }

    this.events.openProgress.dispatch({
      database: this,
      percentage: 100,
      stage: 'FETCH_FILE',
      subStageStatus: 'END'
    })
  }

  /**
   * Exports the current database into an ASCII DXF string.
   *
   * The `fileName` parameter is kept for ObjectARX API parity. In this web
   * implementation the method returns the DXF payload instead of writing the
   * filesystem directly.
   *
   * This is the top-level DXF export entry point. It emits the sectioned
   * structure in the canonical order: HEADER, TABLES, BLOCKS, ENTITIES,
   * OBJECTS, and EOF.
   *
   * @param _fileName - Kept for ObjectARX parity. Ignored in this implementation.
   * @param precision - Numeric precision used by the DXF filer.
   * @param version - Target DXF/DWG version name or value.
   * @param _saveThumbnailImage - Kept for ObjectARX parity. Ignored here.
   * @returns The serialized DXF contents.
   */
  dxfOut(
    _fileName?: string,
    precision: number = 16,
    version: AcDbDwgVersion | string | number = this.version.name,
    _saveThumbnailImage: boolean = false
  ) {
    this.ensureDatabaseDefaults()

    const outVersion =
      version instanceof AcDbDwgVersion ? version : new AcDbDwgVersion(version)
    const filer = new AcDbDxfFiler({
      database: this,
      precision,
      version: outVersion
    })

    this.writeDxfHeaderSection(filer)
    this.writeDxfTablesSection(filer, outVersion)
    this.writeDxfBlocksSection(filer)
    this.writeDxfEntitiesSection(filer)
    this.writeDxfObjectsSection(filer)
    filer.writeStart('EOF')
    return filer.toString()
  }

  /**
   * Triggers xxxAppended events with data in the database to redraw the associated viewer.
   */
  async regen() {
    const converter = new AcDbRegenerator(this)
    await converter.read(
      null as unknown as ArrayBuffer,
      this,
      500,
      async (
        percentage: number,
        stage: AcDbConversionStage,
        stageStatus: AcDbStageStatus,
        data?: unknown
      ) => {
        this.events.openProgress.dispatch({
          database: this,
          percentage: percentage,
          stage: 'CONVERSION',
          subStage: stage,
          subStageStatus: stageStatus,
          data: data
        })
      }
    )
  }

  /**
   * Create default layer, line type, dimension type, text style and layout.
   * @param - Options to specify data to create
   */
  createDefaultData(
    options: AcDbCreateDefaultDataOptions = {
      layer: true,
      lineType: true,
      textStyle: true,
      dimStyle: true,
      layout: true
    }
  ) {
    const generator = new AcDbDataGenerator(this)

    // Create default layer
    if (options.layer) {
      generator.createDefaultLayer()
    }

    // Create default line type
    if (options.lineType) {
      generator.createDefaultLineType()
    }

    // Create default text style
    if (options.textStyle) {
      generator.createDefaultTextStyle()
    }

    // Create default dimension style
    if (options.dimStyle) {
      generator.createDefaultDimStyle()
    }

    // Create default layout for model space
    if (options.layout) {
      generator.createDefaultLayout()
    }
  }

  /**
   * Ensures style dictionaries contain defaults required by one entity type.
   *
   * This is primarily used during entity append so newly created entities can
   * immediately resolve their style references.
   *
   * @internal
   */
  ensureEntityStyleDefaults(entity: AcDbEntity) {
    if (entity.dxfTypeName === 'MLINE') {
      this.ensureMLineStyle(this._cmlstyle || DEFAULT_MLINE_STYLE)
      return
    }

    if (entity.dxfTypeName === 'MULTILEADER') {
      this.ensureMLeaderStyle(this._cmleaderstyle || DEFAULT_MLEADER_STYLE)
      return
    }

    if (entity.dxfTypeName === 'HATCH') {
      const hatch = entity as AcDbEntity & {
        applyPatternDefaultsFromSysVars?: (db: AcDbDatabase) => void
      }
      hatch.applyPatternDefaultsFromSysVars?.(this)
    }
  }

  /**
   * Ensures the default text style exists in the text style table.
   *
   * This is invoked while converting STYLE records and again after a drawing
   * is fully opened so TEXT/MTEXT entities can resolve a style during
   * progressive rendering.
   */
  ensureTextStyleDefaults() {
    if (this.hasDefaultTextStyle()) {
      return
    }

    this.tables.textStyleTable.add(
      new AcDbTextStyleTableRecord({
        name: DEFAULT_TEXT_STYLE,
        standardFlag: 0,
        fixedTextHeight: 0,
        widthFactor: 1,
        obliqueAngle: 0,
        textGenerationFlag: 0,
        lastHeight: 0.2,
        font: 'SimKai',
        bigFont: '',
        extendedFont: 'SimKai'
      })
    )
  }

  private hasDefaultTextStyle() {
    const defaultNames = [DEFAULT_TEXT_STYLE, 'STANDARD']
    for (const name of defaultNames) {
      if (this.tables.textStyleTable.has(name)) {
        return true
      }
    }

    for (const record of this.tables.textStyleTable.newIterator()) {
      if (record.name.toUpperCase() === DEFAULT_TEXT_STYLE.toUpperCase()) {
        return true
      }
    }

    return false
  }

  /**
   * Ensures required default database data exists.
   *
   * This is used after opening a file (or before exporting) to fill in any
   * missing defaults such as layers, linetypes, text styles, dim styles,
   * viewports, layouts, and registered application IDs.
   */
  private ensureDatabaseDefaults() {
    if (!this.tables.layerTable.has('0')) {
      const defaultColor = new AcCmColor()
      defaultColor.colorIndex = 7
      this.tables.layerTable.add(
        new AcDbLayerTableRecord({
          name: '0',
          standardFlags: 0,
          linetype: DEFAULT_LINE_TYPE,
          lineWeight: 0,
          isOff: false,
          color: defaultColor,
          isPlottable: true
        })
      )
    }

    if (!this.tables.linetypeTable.has(ByBlock)) {
      this.tables.linetypeTable.add(
        new AcDbLinetypeTableRecord({
          name: ByBlock,
          standardFlag: 0,
          description: '',
          totalPatternLength: 0
        })
      )
    }
    if (!this.tables.linetypeTable.has(ByLayer)) {
      this.tables.linetypeTable.add(
        new AcDbLinetypeTableRecord({
          name: ByLayer,
          standardFlag: 0,
          description: '',
          totalPatternLength: 0
        })
      )
    }
    if (!this.tables.linetypeTable.has(DEFAULT_LINE_TYPE)) {
      this.tables.linetypeTable.add(
        new AcDbLinetypeTableRecord({
          name: DEFAULT_LINE_TYPE,
          standardFlag: 0,
          description: 'Solid line',
          totalPatternLength: 0
        })
      )
    }

    this.ensureTextStyleDefaults()

    if (!this.tables.dimStyleTable.has(DEFAULT_TEXT_STYLE)) {
      this.tables.dimStyleTable.add(
        new AcDbDimStyleTableRecord({
          name: DEFAULT_TEXT_STYLE,
          dimtxsty: DEFAULT_TEXT_STYLE
        })
      )
    }

    if (!this.tables.viewportTable.has(ACTIVE_VPORT_NAME)) {
      const viewport = new AcDbViewportTableRecord()
      viewport.name = ACTIVE_VPORT_NAME
      this.tables.viewportTable.add(viewport)
    }

    this.ensureMLineStyle(this._cmlstyle || DEFAULT_MLINE_STYLE)
    this.ensureMLeaderStyle(this._cmleaderstyle || DEFAULT_MLEADER_STYLE)

    const modelSpace = this.tables.blockTable.modelSpace
    if (!this.objects.layout.getAt('Model')) {
      const layout = new AcDbLayout()
      layout.layoutName = 'Model'
      layout.tabOrder = 0
      layout.blockTableRecordId = modelSpace.objectId
      layout.limits.min.copy({ x: 0, y: 0 })
      layout.limits.max.copy({ x: 1000000, y: 1000000 })
      layout.extents.min.copy({ x: 0, y: 0, z: 0 })
      layout.extents.max.copy({ x: 1000000, y: 1000000, z: 0 })
      this.objects.layout.setAt(layout.layoutName, layout)
      modelSpace.layoutId = layout.objectId
    }
    if (!this.tables.appIdTable.has(ACAD_APPID)) {
      this.tables.appIdTable.add(new AcDbRegAppTableRecord(ACAD_APPID))
    }
    if (!this.tables.appIdTable.has(MLIGHTCAD_APPID)) {
      this.tables.appIdTable.add(new AcDbRegAppTableRecord(MLIGHTCAD_APPID))
    }
  }

  /**
   * Ensures one MLINE style exists for the provided style name.
   */
  private ensureMLineStyle(styleName: string) {
    const dictionary = this.objects.mlineStyle
    const normalizedName = styleName.trim()
    if (!normalizedName) return

    if (dictionary.getAt(normalizedName)) {
      return
    }

    for (const [name, style] of dictionary.entries()) {
      if (
        name.toUpperCase() === normalizedName.toUpperCase() ||
        style.styleName.toUpperCase() === normalizedName.toUpperCase()
      ) {
        return
      }
    }

    const style = new AcDbMlineStyle()
    style.styleName = normalizedName
    style.elements = [
      {
        offset: 0.5,
        color: new AcCmColor().setByLayer(),
        lineType: ByLayer
      },
      {
        offset: -0.5,
        color: new AcCmColor().setByLayer(),
        lineType: ByLayer
      }
    ]
    dictionary.setAt(normalizedName, style)
  }

  /**
   * Ensures one MLEADER style exists for the provided style name.
   */
  private ensureMLeaderStyle(styleName: string) {
    const dictionary = this.objects.mleaderStyle
    const normalizedName = styleName.trim()
    if (!normalizedName) return

    if (dictionary.getAt(normalizedName)) {
      return
    }

    for (const [name] of dictionary.entries()) {
      if (name.toUpperCase() === normalizedName.toUpperCase()) {
        return
      }
    }

    const style = new AcDbMLeaderStyle()
    // Match AutoCAD "Standard" defaults observed in exported DXF.
    style.unknown1 = 2
    style.maxLeaderSegmentsPoints = 2
    style.leaderLineColor = new AcCmColor().setByBlock()
    style.textColor = new AcCmColor().setByBlock()
    style.blockColor = new AcCmColor().setByBlock()
    style.alignSpace = 4
    style.breakSize = 3.75
    style.enableBlockRotation = true
    style.unknown2 = false
    const byBlockLinetype = this.tables.linetypeTable.getAt(ByBlock)
    style.leaderLineTypeId = byBlockLinetype?.objectId
    const standardTextStyle =
      this.tables.textStyleTable.getAt(DEFAULT_TEXT_STYLE)
    style.textStyleId = standardTextStyle?.objectId
    dictionary.setAt(normalizedName, style)
  }

  /**
   * Writes the HEADER section for the DXF export.
   *
   * @param filer - DXF output writer.
   */
  private writeDxfHeaderSection(filer: AcDbDxfFiler) {
    filer.startSection('HEADER')
    filer.writeString(9, '$ACADVER')
    filer.writeString(1, filer.version?.name ?? this.version.name)
    filer.writeString(9, '$HANDSEED')
    filer.writeString(5, filer.nextHandle.toString(16).toUpperCase())
    if (filer.version != null && filer.version.value >= 27) {
      filer.writeString(9, '$DWGCODEPAGE')
      filer.writeString(3, 'UTF-8')
    }
    filer.writeString(9, '$INSUNITS')
    filer.writeInt16(70, this.insunits)
    filer.writeString(9, '$LUNITS')
    filer.writeInt16(70, this.lunits)
    filer.writeString(9, '$LUPREC')
    filer.writeInt16(70, this.luprec)
    filer.writeString(9, '$UNITMODE')
    filer.writeInt16(70, this.unitmode)
    filer.writeString(9, '$MEASUREMENT')
    filer.writeInt16(70, this.measurement)
    filer.writeString(9, '$LTSCALE')
    filer.writeDouble(40, this.ltscale)
    filer.writeString(9, '$LWDISPLAY')
    filer.writeInt16(70, this.lwdisplay ? 1 : 0)
    filer.writeString(9, '$CLAYER')
    filer.writeString(8, this.clayer)
    filer.writeString(9, '$CELTYPE')
    filer.writeString(6, this.celtype)
    if (!this.cetransparency.isInvalid) {
      filer.writeString(9, '$CETRANSPARENCY')
      filer.writeTransparency(this.cetransparency)
    }
    filer.writeString(9, '$CMLSTYLE')
    filer.writeString(2, this.cmlstyle)
    filer.writeString(9, '$CMLSCALE')
    filer.writeDouble(40, this.cmlscale)
    filer.writeString(9, '$CMLEADERSTYLE')
    filer.writeString(2, this.cmleaderstyle)
    if (this.hpcolor.colorMethod !== AcCmColorMethod.None) {
      filer.writeString(9, '$HPCOLOR')
      filer.writeCmColor(this.hpcolor, 2)
    }
    if (this.hpbackgroundcolor.colorMethod !== AcCmColorMethod.None) {
      filer.writeString(9, '$HPBACKGROUNDCOLOR')
      filer.writeCmColor(this.hpbackgroundcolor, 2)
    }
    filer.writeString(9, '$HPLAYER')
    filer.writeString(8, this.hplayer)
    if (!this.hptransparency.isInvalid) {
      filer.writeString(9, '$HPTRANSPARENCY')
      filer.writeTransparency(this.hptransparency)
    }
    filer.writeString(9, '$TEXTSTYLE')
    filer.writeString(7, this.textstyle)
    filer.writeString(9, '$ANGBASE')
    filer.writeAngle(50, this.angbase)
    filer.writeString(9, '$ANGDIR')
    filer.writeInt16(70, this.angdir)
    filer.writeString(9, '$AUNITS')
    filer.writeInt16(70, this.aunits)
    filer.writeString(9, '$AUPREC')
    filer.writeInt16(70, this.auprec)
    filer.writeString(9, '$EXTMIN')
    filer.writePoint3d(10, this.extmin)
    filer.writeString(9, '$EXTMAX')
    filer.writePoint3d(10, this.extmax)
    filer.writeString(9, '$PDMODE')
    filer.writeInt32(70, this.pdmode)
    filer.writeString(9, '$PDSIZE')
    filer.writeDouble(40, this.pdsize)
    filer.writeString(9, '$OSMODE')
    filer.writeInt32(70, this.osmode)
    filer.writeString(9, '$ORTHOMODE')
    filer.writeInt16(70, this.orthomode)
    filer.endSection()
  }

  /**
   * Writes the TABLES section for the DXF export.
   *
   * @param filer - DXF output writer.
   * @param version - Target DXF/DWG version, used for conditional tables.
   */
  private writeDxfTablesSection(filer: AcDbDxfFiler, version: AcDbDwgVersion) {
    filer.startSection('TABLES')
    this.writeDxfTable(
      filer,
      'VPORT',
      this.tables.viewportTable,
      this.tables.viewportTable.newIterator(),
      'VPORT'
    )
    this.writeDxfTable(
      filer,
      'VIEW',
      this.tables.viewTable,
      this.tables.viewTable.newIterator(),
      'VIEW'
    )
    this.writeDxfTable(
      filer,
      'LTYPE',
      this.tables.linetypeTable,
      this.tables.linetypeTable.newIterator(),
      'LTYPE'
    )
    this.writeDxfTable(
      filer,
      'LAYER',
      this.tables.layerTable,
      this.tables.layerTable.newIterator(),
      'LAYER'
    )
    this.writeDxfTable(
      filer,
      'STYLE',
      this.tables.textStyleTable,
      this.tables.textStyleTable.newIterator(true),
      'STYLE'
    )
    this.writeDxfTable(
      filer,
      'APPID',
      this.tables.appIdTable,
      this.tables.appIdTable.newIterator(),
      'APPID'
    )
    this.writeDxfTable(
      filer,
      'DIMSTYLE',
      this.tables.dimStyleTable,
      this.tables.dimStyleTable.newIterator(),
      'DIMSTYLE'
    )
    if (version.value >= 19) {
      this.writeDxfTable(
        filer,
        'BLOCK_RECORD',
        this.tables.blockTable,
        this.tables.blockTable.newIterator(),
        'BLOCK_RECORD'
      )
    }
    filer.endSection()
  }

  /**
   * Writes the BLOCKS section for the DXF export.
   *
   * @param filer - DXF output writer.
   */
  private writeDxfBlocksSection(filer: AcDbDxfFiler) {
    filer.startSection('BLOCKS')
    for (const btr of this.tables.blockTable.newIterator()) {
      btr.dxfOutBlockBegin(filer)

      if (!btr.isModelSapce && !btr.isPaperSapce) {
        for (const entity of btr.newIterator()) {
          this.writeDxfEntity(filer, entity)
        }
      }

      btr.dxfOutBlockEnd(filer)
    }
    filer.endSection()
  }

  /**
   * Writes the ENTITIES section for the DXF export.
   *
   * @param filer - DXF output writer.
   */
  private writeDxfEntitiesSection(filer: AcDbDxfFiler) {
    filer.startSection('ENTITIES')
    for (const btr of this.tables.blockTable.newIterator()) {
      if (!btr.isModelSapce && !btr.isPaperSapce) continue
      for (const entity of btr.newIterator()) {
        this.writeDxfEntity(filer, entity)
      }
    }
    filer.endSection()
  }

  /**
   * Writes the OBJECTS section for the DXF export.
   *
   * @param filer - DXF output writer.
   */
  private writeDxfObjectsSection(filer: AcDbDxfFiler) {
    filer.startSection('OBJECTS')
    const rootDict = this.objects.dictionary
    rootDict.ownerId = '0'

    const writeDictionary = (dict: AcDbDictionary) => {
      // Dictionary entries (3/350 pairs) are embedded in the DICTIONARY object.
      filer.writeStart('DICTIONARY')
      dict.dxfOut(filer)
    }

    const ensureRootEntry = (key: string, dict: AcDbDictionary) => {
      if (rootDict.getAt(key) !== dict) {
        rootDict.setAt(key, dict)
      }
    }

    const dropRootEntry = (key: string) => {
      if (rootDict.getAt(key)) {
        rootDict.remove(key)
      }
    }

    ensureRootEntry('ACAD_LAYOUT', this.objects.layout)
    if (this.objects.mleaderStyle.numEntries > 0) {
      ensureRootEntry('ACAD_MLEADERSTYLE', this.objects.mleaderStyle)
    } else {
      dropRootEntry('ACAD_MLEADERSTYLE')
    }
    if (this.objects.mlineStyle.numEntries > 0) {
      ensureRootEntry('ACAD_MLINESTYLE', this.objects.mlineStyle)
    } else {
      dropRootEntry('ACAD_MLINESTYLE')
    }
    if (this.objects.imageDefinition.numEntries > 0) {
      ensureRootEntry('ISM_RASTER_IMAGE_DICT', this.objects.imageDefinition)
    } else {
      dropRootEntry('ISM_RASTER_IMAGE_DICT')
    }
    if (this.objects.xrecord.numEntries > 0) {
      ensureRootEntry('MLIGHT_XRECORD', this.objects.xrecord)
    } else {
      dropRootEntry('MLIGHT_XRECORD')
    }

    writeDictionary(rootDict)
    writeDictionary(this.objects.layout)

    if (this.objects.mleaderStyle.numEntries > 0) {
      writeDictionary(this.objects.mleaderStyle)
    }
    if (this.objects.mlineStyle.numEntries > 0) {
      writeDictionary(this.objects.mlineStyle)
    }

    if (this.objects.imageDefinition.numEntries > 0) {
      writeDictionary(this.objects.imageDefinition)
    }

    if (this.objects.xrecord.numEntries > 0) {
      writeDictionary(this.objects.xrecord)
    }

    for (const [_, layout] of this.objects.layout.entries()) {
      filer.writeStart('LAYOUT')
      layout.dxfOut(filer)
    }

    for (const [_, imageDef] of this.objects.imageDefinition.entries()) {
      filer.writeStart('IMAGEDEF')
      imageDef.dxfOut(filer)
    }

    for (const [_, mleaderStyle] of this.objects.mleaderStyle.entries()) {
      filer.writeStart('MLEADERSTYLE')
      mleaderStyle.dxfOut(filer)
    }
    for (const [_, mlineStyle] of this.objects.mlineStyle.entries()) {
      filer.writeStart('MLINESTYLE')
      mlineStyle.dxfOut(filer)
    }

    for (const [_, xrecord] of this.objects.xrecord.entries()) {
      filer.writeStart('XRECORD')
      xrecord.dxfOut(filer)
    }
    filer.endSection()
  }

  /**
   * Writes a single TABLE and its records into the TABLES section.
   *
   * @param filer - DXF output writer.
   * @param tableName - DXF table name (e.g. LAYER, LTYPE).
   * @param table - The symbol table instance.
   * @param records - Records to serialize.
   * @param recordType - DXF record type name for each table record.
   */
  private writeDxfTable<
    TRecord extends AcDbObject,
    TTable extends AcDbSymbolTable
  >(
    filer: AcDbDxfFiler,
    tableName: string,
    table: TTable,
    records: Iterable<TRecord>,
    recordType: string
  ) {
    const items = [...records]
    filer.startTable(tableName)
    table.dxfOut(filer)
    for (const record of items) {
      if (
        recordType === 'BLOCK_RECORD' &&
        record instanceof AcDbBlockTableRecord
      ) {
        record.dxfOutBlockRecord(filer)
        continue
      }

      filer.writeStart(recordType)
      record.dxfOut(filer)
    }
    filer.endTable()
  }

  /**
   * Writes a single entity record into the DXF stream.
   *
   * The entity is responsible for emitting any additional records (such as
   * VERTEX/SEQEND for polylines or ATTRIB/SEQEND for block references) inside
   * its own `dxfOut` override.
   *
   * @param filer - DXF output writer.
   * @param entity - Entity to serialize.
   */
  private writeDxfEntity(filer: AcDbDxfFiler, entity: AcDbEntity) {
    filer.writeStart(entity.dxfTypeName)
    entity.dxfOut(filer)
  }

  /**
   * Clears all data from the database.
   *
   * This method removes all entities, tables, and objects from the database,
   * effectively resetting it to an empty state.
   *
   * @example
   * ```typescript
   * database.clear();
   * ```
   */
  private clear() {
    this.transactionManager.clearUndoStack()
    // Clear all tables and dictionaries
    this._tables.blockTable.removeAll()
    this._tables.dimStyleTable.removeAll()
    this._tables.linetypeTable.removeAll()
    this._tables.textStyleTable.removeAll()
    this._tables.viewTable.removeAll()
    this._tables.layerTable.removeAll()
    this._tables.viewportTable.removeAll()
    this._objects.layout.removeAll()
    this._objects.imageDefinition.removeAll()
    this._objects.mleaderStyle.removeAll()
    this._objects.mlineStyle.removeAll()
    this._objects.xrecord.removeAll()
    this._currentSpace = undefined
    this._extents.makeEmpty()
  }

  /**
   * Updates a sysvar value and dispatches the change event only when the value changed.
   */
  private updateSysVar<T>(
    sysVarName: string,
    currentValue: T,
    nextValue: T,
    setter: (nextValue: T) => void
  ) {
    AcDbSysVarManager.instance().applyVarMutation(
      sysVarName,
      currentValue,
      nextValue,
      this,
      () => setter(nextValue)
    )
  }

  /**
   * Normalizes special linetype aliases to the internal canonical names.
   */
  private normalizeLinetypeName(value: string) {
    const normalizedValue = value.trim()
    if (normalizedValue.toUpperCase() === 'BYLAYER') {
      return ByLayer
    }
    if (normalizedValue.toUpperCase() === 'BYBLOCK') {
      return ByBlock
    }
    return normalizedValue
  }

  /**
   * Triggers a system variable changed event with old/new values.
   */
  private triggerSysVarChangedEvent(
    sysVarName: string,
    oldValue: unknown,
    newValue: unknown
  ) {
    const manager = AcDbSysVarManager.instance()
    const name = sysVarName.toLowerCase()
    const descriptor = manager.getDescriptor(name)
    if (descriptor == null) {
      return
    }

    manager.events.sysVarChanged.dispatch({
      database: this,
      name,
      oldVal: oldValue as AcDbSysVarType,
      newVal: newValue as AcDbSysVarType
    })
  }

  /**
   * Extracts the file name from a URI.
   *
   * @param uri - The URI to extract the file name from
   * @returns The extracted file name, or empty string if extraction fails
   * @private
   */
  private getFileNameFromUri(uri: string): string {
    try {
      // Create a new URL object
      const url = new URL(uri)
      // Get the pathname from the URL
      const pathParts = url.pathname.split('/')
      // Return the last part of the pathname as the file name
      return pathParts[pathParts.length - 1] || ''
    } catch (error) {
      console.error('Invalid URI:', error)
      return ''
    }
  }
}
/* eslint-enable simple-import-sort/imports */