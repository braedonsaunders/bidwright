/* eslint-disable simple-import-sort/imports */
import {
  AcCmColor,
  AcCmColorMethod,
  AcCmEventManager,
  AcCmTaskError,
  AcCmTransparency
} from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbObject,
  AcDbObjectId,
  TEMP_OBJECT_ID_PREFIX,
  acdbAssignWorkingDatabase
} from '../base/AcDbObject'
import { AcDbOpenMode } from '../base/AcDbOpenMode'
import { AcDbRegenerator } from '../converter/AcDbRegenerator'
import {
  AcDbConverterType,
  AcDbDatabaseConverterManager,
  AcDbFileType
} from './AcDbDatabaseConverterManager'
import { AcDbEntity } from '../entity/AcDbEntity'
import { AcDbPolyline } from '../entity/AcDbPolyline'
import {
  ACAD_APPID,
  ACDB_COMPAREHATCH_DEFAULT,
  ACDB_COMPAREHATCH_MAX,
  ACDB_COMPAREHATCH_MIN,
  ACDB_COMPARERCMARGIN_DEFAULT,
  ACDB_COMPARERCMARGIN_MAX,
  ACDB_COMPARERCMARGIN_MIN,
  ACDB_COMPARETEXT_DEFAULT,
  ACDB_COMPARETEXT_MAX,
  ACDB_COMPARETEXT_MIN,
  ACDB_COMPARETOLERANCE_DEFAULT,
  ACDB_COMPARETOLERANCE_MAX,
  ACDB_COMPARETOLERANCE_MIN,
  acdbCoerceIntegerSysVar,
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
import { ACDB_DRAW_CIRCLE_SIDES_DRAFT } from '../misc/AcDbDrawTessellate'
import { AcDbFormatter } from '../misc/AcDbFormatter'
import { AcDbLinearUnits } from '../misc/AcDbLinearUnits'
import { AcDbUnitsValue } from '../misc/AcDbUnitsValue'
import { AcDbDictionary } from '../object/AcDbDictionary'
import { AcDbGroup } from '../object/AcDbGroup'
import { AcDbLayerFilter } from '../object/AcDbLayerFilter'
import { AcDbLayerIndex } from '../object/AcDbLayerIndex'
import { AcDbMLeaderStyle } from '../object/AcDbMLeaderStyle'
import { AcDbMlineStyle } from '../object/AcDbMlineStyle'
import { AcDbRasterImageDef } from '../object/AcDbRasterImageDef'
import { AcDbSortentsTable } from '../object/AcDbSortentsTable'
import { AcDbXrecord } from '../object/AcDbXrecord'
import { AcLyLayerFilterTree } from '../ly/AcLyLayerFilterTree'
import {
  ACAD_LAYERFILTERS_NAME,
  ACLY_DICTIONARY_NAME,
  acdbLayerGroupsToResultBuffer,
  acdbSerializeLayerFilterTree,
  type AcDbSerializedFilterNode
} from '../ly/AcLyLayerFilterIO'
import { acdbBytesToHexString } from '../misc/proxyGraphic'
import { AcDbBlockTable } from './AcDbBlockTable'
import { AcDbBlockTableRecord } from './AcDbBlockTableRecord'
import { AcDbConversionStage, AcDbStageStatus } from './AcDbDatabaseConverter'
import type { AcDbConversionProgressCallback } from './AcDbDatabaseConverter'
import { AcDbOpenDatabaseError } from './AcDbOpenDatabaseError'
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
import { AcDbUcsTable } from './AcDbUcsTable'
import { AcDbViewTable } from './AcDbViewTable'
import { AcDbViewportTable } from './AcDbViewportTable'
import { AcDbViewportTableRecord } from './AcDbViewportTableRecord'
import {
  AcGeBox3d,
  AcGeCircArc2d,
  AcGePoint3d,
  AcGePoint3dLike
} from '@mlightcad/geometry-engine'
import { AcDbDwgVersion } from './AcDbDwgVersion'
import type { AcDbClass } from './AcDbClass'
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
   * - Any stage with {@link subStageStatus} `'ERROR'`: `{ code, message, stage? }`
   *
   * Note: For now, 'PARSE' sub stages use this field only, except on errors.
   */
  data?: unknown
}

/**
 * Event arguments when opening a drawing database fails.
 */
export interface AcDbOpenFailedEventArgs {
  /** The database that failed to open */
  database: AcDbDatabase
  /** Structured failure information */
  error: AcDbOpenDatabaseError
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
   * Override the text encoding used to decode text content (layer names,
   * annotations, text entities, block attributes, ...).
   *
   * When omitted, the encoding is auto-detected from the file (DXF reads
   * `$DWGCODEPAGE`; DWG reads the header code page). When provided, it wins
   * over auto-detection — for example `'cp949'` or `'euc-kr'` for Korean
   * drawings whose declared code page is missing or wrong.
   */
  encoding?: string

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
   * - `true` (default): desktop AutoCAD editor semantics — no-plot layers remain
   *   visible on screen (Defpoints, viewport frames on `*-NPLT`, etc.).
   * - `false`: web/publish viewer semantics (e.g. BIM 360 / ACC) — entities on
   *   no-plot layers are omitted from display.
   */
  drawNoPlotLayers?: boolean

  /**
   * Maximum number of segments used to tessellate a full circle when drawing.
   *
   * Lower values use less GPU memory and produce smaller HTML exports; higher
   * values look smoother on large arcs. Clamped to the DXF VPORT range
   * `[{@link AcGeCircArc2d.MIN_CIRCLE_SIDES}, {@link AcGeCircArc2d.MAX_CIRCLE_SIDES}]`.
   * When omitted, {@link ACDB_DRAW_CIRCLE_SIDES_DRAFT} (50) is used so
   * AutoCAD's common VIEWRES 1000 is not applied accidentally.
   *
   * Short arcs still use fewer segments than a full circle.
   */
  circleSides?: number

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
  /** UCS table containing named user coordinate systems */
  readonly ucsTable: AcDbUcsTable
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
  /** Current dimension style name for the database ($DIMSTYLE) */
  private _dimstyle: string
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
  /** TILEMODE: true = model space active (1), false = paper space (0) */
  private _tilemode: boolean
  /** PSLTSCALE: paper space linetype scaling */
  private _psltscale: boolean
  /** Point display mode */
  private _pdmode: number
  /** Point display size */
  private _pdsize: number
  /** Running object snap mode bitmask */
  private _osmode: number
  /** Orthogonal mode flag (ORTHOMODE): 0 = off, 1 = on */
  private _orthomode: number
  /** COMPAREHATCH: whether hatch objects are included in drawing comparison */
  private _comparehatch: number
  /** COMPARERCMARGIN: revision-cloud offset around comparison change sets */
  private _comparercmargin: number
  /** COMPARETEXT: whether text objects are included in drawing comparison */
  private _comparetext: number
  /** COMPARETOLERANCE: decimal-place geometric tolerance for drawing comparison */
  private _comparetolerance: number
  /** Tables in the database */
  private _tables: AcDbTables
  /** Class definitions from DXF CLASSES / DWG class table (needed for proxy entities). */
  private _classes: AcDbClass[] = []
  /** Nongraphical objects in the database */
  private _objects: {
    readonly dictionary: AcDbDictionary<AcDbDictionary>
    readonly group: AcDbDictionary<AcDbGroup>
    readonly imageDefinition: AcDbDictionary<AcDbRasterImageDef>
    readonly layerFilter: AcDbDictionary<AcDbLayerFilter>
    readonly layerIndex: AcDbDictionary<AcDbLayerIndex>
    readonly layout: AcDbLayoutDictionary
    readonly mleaderStyle: AcDbDictionary<AcDbMLeaderStyle>
    readonly mlineStyle: AcDbDictionary<AcDbMlineStyle>
    readonly sortentsTable: AcDbDictionary<AcDbSortentsTable>
    readonly xrecord: AcDbDictionary<AcDbXrecord>
  }
  /** Current space (model space or paper space) */
  private _currentSpace?: AcDbBlockTableRecord
  /** The maximum handle value in the database, used for generating unique object IDs */
  private _maxHandle: number
  /**
   * BigInt-tracked maximum handle. Engages once handles exceed
   * {@link Number.MAX_SAFE_INTEGER}; beyond that point float increments no
   * longer advance (`x + 1 === x`) and handle generation would spin forever.
   */
  private _maxHandleBig?: bigint
  /** Global registry of committed object handles across all database-resident objects */
  private _handleRegistry = new Map<AcDbObjectId, AcDbObject>()
  /** Lazily created formatter for lengths, angles, and coordinates */
  private _formatter?: AcDbFormatter
  /**
   * When false, entities on non-plottable layers are not drawn (viewer semantics).
   * Set from {@link AcDbOpenDatabaseOptions.drawNoPlotLayers} when opening a database.
   */
  private _drawNoPlotLayers = true
  /**
   * Display tessellation side count for a full circle.
   * Set from {@link AcDbOpenDatabaseOptions.circleSides} when opening a database.
   */
  private _drawCircleSides = ACDB_DRAW_CIRCLE_SIDES_DRAFT
  /** Current drawing file name (**DWGNAME**), including extension. */
  private _dwgname: string
  /**
   * Drawing thumbnail preview image (DXF `THUMBNAILIMAGE` / DWG preview).
   * Raw image bytes (typically BMP/DIB or PNG), or `undefined` when absent.
   */
  private _thumbnailImage?: Uint8Array
  /**
   * Layer Properties Manager filter tree (`AcLy*` / .NET `LayerFilterTree`).
   * Distinct from {@link objects.layerFilter} (`AcDbLayerFilter` index objects).
   */
  private _layerFilters: AcLyLayerFilterTree

  /** Manages transactions and undo/redo for this database. */
  readonly transactionManager: AcDbDatabaseTransactionManager

  private _eventBatchDepth = 0
  private _pendingEntityAppended: AcDbEntity[] = []
  private _pendingEntityErased: AcDbEntity[] = []
  private _pendingDictObjectSet: { object: AcDbObject; key: string }[] = []
  private _pendingDictObjectErased: { object: AcDbObject; key: string }[] = []
  private _lastOpenError: AcDbOpenDatabaseError | null = null

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
    openProgress: new AcCmEventManager<AcDbProgressdEventArgs>(),
    /** Fired when {@link AcDbDatabase.read} or {@link AcDbDatabase.openUri} fails */
    openFailed: new AcCmEventManager<AcDbOpenFailedEventArgs>()
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
    this._dimstyle = DEFAULT_TEXT_STYLE
    this._extents = new AcGeBox3d()
    // TODO: Default value is 1 (imperial) or 4 (metric)
    this._insunits = AcDbUnitsValue.Millimeters
    this._unitmode = 0
    this._measurement = 1
    this._ltscale = 1
    this._lwdisplay = false
    this._tilemode = true
    this._psltscale = true
    this._pdmode = 0
    this._pdsize = 0
    this._osmode = 0
    this._orthomode = 0
    this._comparehatch = ACDB_COMPAREHATCH_DEFAULT
    this._comparercmargin = ACDB_COMPARERCMARGIN_DEFAULT
    this._comparetext = ACDB_COMPARETEXT_DEFAULT
    this._comparetolerance = ACDB_COMPARETOLERANCE_DEFAULT
    this._maxHandle = 0
    this._tables = {
      appIdTable: new AcDbRegAppTable(this),
      blockTable: new AcDbBlockTable(this),
      dimStyleTable: new AcDbDimStyleTable(this),
      linetypeTable: new AcDbLinetypeTable(this),
      textStyleTable: new AcDbTextStyleTable(this),
      ucsTable: new AcDbUcsTable(this),
      viewTable: new AcDbViewTable(this),
      layerTable: new AcDbLayerTable(this),
      viewportTable: new AcDbViewportTable(this)
    }
    this._objects = {
      dictionary: new AcDbDictionary(this),
      group: new AcDbDictionary(this),
      imageDefinition: new AcDbDictionary(this),
      layerFilter: new AcDbDictionary(this),
      layerIndex: new AcDbDictionary(this),
      layout: new AcDbLayoutDictionary(this),
      mleaderStyle: new AcDbDictionary(this),
      mlineStyle: new AcDbDictionary(this),
      sortentsTable: new AcDbDictionary(this),
      xrecord: new AcDbDictionary(this)
    }
    this._layerFilters = new AcLyLayerFilterTree()
    this.transactionManager = new AcDbDatabaseTransactionManager(this)
    this.registerBootstrapHandles()
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
   * Gets or sets class definitions from the drawing (DXF CLASSES / DWG class table).
   *
   * Proxy entities resolve their application class ID (group code **91**)
   * against this list (IDs start at 500 for the first entry).
   */
  get classes(): readonly AcDbClass[] {
    return this._classes
  }
  set classes(classes: readonly AcDbClass[]) {
    this._classes = classes.map(entry => ({ ...entry }))
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
   * Gets the Layer Properties Manager filter tree for this database.
   *
   * @remarks
   * Mirrors AutoCAD .NET `Database.LayerFilters` / ObjectARX `AcLy*` filters.
   * This is the property/group filter **tree**, not the flat
   * {@link objects.layerFilter} dictionary used by `AcDbLayerFilter` /
   * `AcDbLayerIndex`.
   *
   * Like AutoCAD, treat this value as retrieved by value: mutate the tree,
   * then assign it back via the setter if your workflow expects that pattern.
   *
   * @returns The current {@link AcLyLayerFilterTree}.
   *
   * @example
   * ```typescript
   * const tree = db.layerFilters;
   * const filter = new AcLyLayerFilter();
   * filter.name = 'Unlocked Layers';
   * filter.setFilterExpression('LOCKED=="False"');
   * tree.root.addNested(filter);
   * db.layerFilters = tree;
   * ```
   */
  get layerFilters(): AcLyLayerFilterTree {
    return this._layerFilters
  }

  /**
   * Sets the Layer Properties Manager filter tree for this database.
   *
   * @param value - New filter tree.
   */
  set layerFilters(value: AcLyLayerFilterTree) {
    this._layerFilters = value ?? new AcLyLayerFilterTree()
  }

  /**
   * Looks up a database-resident object by its object ID.
   *
   * Uses the global handle registry maintained by {@link registerObjectHandle}.
   *
   * @param id - Object identifier to resolve
   * @param _openErased - Reserved for erased-object support
   * @returns The matching object, or undefined if not found
   */
  getObjectById(id: AcDbObjectId, _openErased = false): AcDbObject | undefined {
    if (id === this.objectId) {
      return this
    }
    return this._handleRegistry.get(id)
  }

  /**
   * Creates an extension dictionary for `owner` and registers it in this database.
   *
   * Used by {@link AcDbObject.createExtensionDictionary}. Returns the existing
   * dictionary id when one is already attached.
   */
  createExtensionDictionaryFor(owner: AcDbObject): AcDbObjectId | undefined {
    const existingId = owner.extensionDictionary
    if (existingId) {
      return existingId
    }

    const dict = new AcDbDictionary(this)
    dict.database = this
    dict.ownerId = owner.objectId
    this.commitObjectHandle(dict)
    owner.extensionDictionary = dict.objectId
    return dict.objectId
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
      this.objects.group,
      this.objects.imageDefinition,
      this.objects.layerFilter,
      this.objects.layerIndex,
      this.objects.layout,
      this.objects.mleaderStyle,
      this.objects.mlineStyle,
      this.objects.sortentsTable,
      this.objects.xrecord
    ]
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
   * Ends the outermost event batch, flushing `entityAppended` notifications in
   * chunks so converters can report ENTITY progress while the viewer adds/renders.
   *
   * Nested batches still require matching {@link endEventBatch} /
   * {@link endEventBatchChunked} calls; only the outermost close flushes.
   *
   * @param chunkSize - Max entities per `entityAppended` dispatch
   * @param onChunk - Called after each chunk with `(flushed, total)`
   */
  async endEventBatchChunked(
    chunkSize: number,
    onChunk?: (flushed: number, total: number) => void | Promise<void>
  ): Promise<void> {
    if (this._eventBatchDepth <= 0) {
      return
    }
    this._eventBatchDepth--
    if (this._eventBatchDepth !== 0) {
      return
    }

    this.transactionManager.flushPendingEntityModifiedEvents()
    this.transactionManager.flushPendingLayerModifiedEvents()

    const appended = this._pendingEntityAppended
    this._pendingEntityAppended = []
    const total = appended.length
    const size = Math.max(1, chunkSize)

    if (total === 0) {
      this.flushEventBatchRemainder()
      return
    }

    // Dispatch in chunks; if onChunk throws, still flush remaining appends and
    // erase/dict queues so catch paths calling endEventBatch() are not needed.
    let flushed = 0
    try {
      for (let i = 0; i < total; i += size) {
        const end = Math.min(i + size, total)
        const chunk = appended.slice(i, end)
        this.events.entityAppended.dispatch({
          database: this,
          entity: chunk
        })
        flushed = end
        if (onChunk) {
          await onChunk(end, total)
        }
      }
    } finally {
      if (flushed < total) {
        this.events.entityAppended.dispatch({
          database: this,
          entity: appended.slice(flushed)
        })
      }
      this.flushEventBatchRemainder()
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

    this.flushEventBatchRemainder()
  }

  /** Flushes non-append batch queues (erase / dictionary) after entity appends. */
  private flushEventBatchRemainder(): void {
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
    if (this._maxHandleBig != null) {
      this._maxHandleBig += BigInt(1)
      return this._maxHandleBig.toString(16).toUpperCase()
    }
    if (this._maxHandle >= Number.MAX_SAFE_INTEGER) {
      // Float precision can no longer advance the counter; switch to BigInt.
      this._maxHandleBig = BigInt(this._maxHandle)
      return this.generateHandle()
    }
    this._maxHandle++
    return this._maxHandle.toString(16).toUpperCase()
  }

  /**
   * Generates a handle that is not already registered in this database.
   *
   * @internal
   */
  generateUniqueHandle(): AcDbObjectId {
    let handle = this.generateHandle()
    while (this.isHandleTaken(handle)) {
      handle = this.generateHandle()
    }
    return handle
  }

  /**
   * Initializes {@link generateHandle} from a DXF/DWG `$HANDSEED` value.
   *
   * `$HANDSEED` is the next handle AutoCAD would assign; internal `_maxHandle`
   * is kept one below that value.
   *
   * @param seed - Hexadecimal handle seed from the drawing header
   */
  initializeHandleSeed(seed: string) {
    const nextBig = BigInt('0x' + seed)
    if (nextBig <= BigInt(0)) {
      return
    }
    const baseline = nextBig - BigInt(1)
    if (baseline <= BigInt(Number.MAX_SAFE_INTEGER)) {
      if (this._maxHandleBig == null) {
        const value = Number(baseline)
        if (value > this._maxHandle) {
          this._maxHandle = value
        }
      }
      return
    }
    // Handle seeds beyond float-safe range must be tracked with BigInt.
    if (this._maxHandleBig == null || baseline > this._maxHandleBig) {
      this._maxHandleBig = baseline
    }
  }

  /**
   * Adopts a handle from an external drawing when it is still available.
   *
   * When the preferred handle is already registered to another object, a new
   * unique handle is generated instead.
   *
   * @internal
   */
  adoptExternalHandle(
    object: AcDbObject,
    preferredId: AcDbObjectId
  ): AcDbObjectId {
    this.releaseObjectHandle(object)
    if (
      preferredId &&
      !preferredId.startsWith(TEMP_OBJECT_ID_PREFIX) &&
      !this.isHandleTaken(preferredId)
    ) {
      object.objectId = preferredId
      this.registerObjectHandle(object)
      this.updateMaxHandle(preferredId)
      return preferredId
    }
    return this.assignGeneratedHandle(object)
  }

  /**
   * Registers an object's current {@link AcDbObject.objectId} in the global handle map.
   *
   * @internal
   */
  registerObjectHandle(object: AcDbObject) {
    const objectId = object.objectId
    if (!objectId || objectId.startsWith(TEMP_OBJECT_ID_PREFIX)) {
      return
    }
    this._handleRegistry.set(objectId, object)
  }

  /**
   * Removes an object's handle from the global handle map.
   *
   * @internal
   */
  releaseObjectHandle(object: AcDbObject) {
    const objectId = object.objectId
    if (!objectId || objectId.startsWith(TEMP_OBJECT_ID_PREFIX)) {
      return
    }
    if (this._handleRegistry.get(objectId) === object) {
      this._handleRegistry.delete(objectId)
    }
  }

  /**
   * Returns true when a handle is already registered to another object.
   *
   * @internal
   */
  isHandleTaken(objectId: AcDbObjectId, except?: AcDbObject): boolean {
    if (!objectId || objectId.startsWith(TEMP_OBJECT_ID_PREFIX)) {
      return false
    }
    const owner = this._handleRegistry.get(objectId)
    return owner !== undefined && owner !== except
  }

  /**
   * Registers bootstrap tables, dictionaries, and the database object itself.
   */
  private registerBootstrapHandles() {
    this._handleRegistry.clear()
    this.registerObjectHandle(this)
    for (const table of [
      this._tables.blockTable,
      this._tables.dimStyleTable,
      this._tables.layerTable,
      this._tables.linetypeTable,
      this._tables.appIdTable,
      this._tables.textStyleTable,
      this._tables.ucsTable,
      this._tables.viewTable,
      this._tables.viewportTable
    ]) {
      this.registerObjectHandle(table)
    }
    for (const dictionary of [
      this._objects.dictionary,
      this._objects.group,
      this._objects.imageDefinition,
      this._objects.layerFilter,
      this._objects.layerIndex,
      this._objects.layout,
      this._objects.mleaderStyle,
      this._objects.mlineStyle,
      this._objects.sortentsTable,
      this._objects.xrecord
    ]) {
      this.registerObjectHandle(dictionary)
    }
  }

  /**
   * Assigns a freshly generated unique handle to an object.
   *
   * @internal
   */
  private assignGeneratedHandle(object: AcDbObject): AcDbObjectId {
    const oldId = object.objectId
    this.releaseObjectHandle(object)
    const handle = this.generateUniqueHandle()
    object.objectId = handle
    this.registerObjectHandle(object)
    if (oldId && oldId !== handle) {
      this.updateMaxHandle(handle)
      // When a BTR is displaced by a later import claiming its handle, keep
      // child entity ownerIds in sync. Otherwise ATTDEF.isLooseInDrawingSpace
      // cannot resolve the owner BTR and may draw attribute tags into the
      // block render cache (overlapping INSERT ATTRIB values).
      if (object instanceof AcDbBlockTableRecord) {
        for (const entity of object.newIterator()) {
          if (entity.getAttrWithoutException('ownerId') === oldId) {
            entity.ownerId = handle
          }
        }
      }
    }
    return handle
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
    this.trackMaxHandle(handle)
  }

  /**
   * Records the maximum seen handle, staying float-precise below
   * {@link Number.MAX_SAFE_INTEGER} and switching to BigInt tracking above it.
   */
  private trackMaxHandle(handle: string): void {
    if (this._maxHandleBig != null) {
      // BigInt mode only engages for handles above float-safe range, so any
      // handle with fewer than 14 hex digits is guaranteed smaller — skip the
      // per-entity BigInt parse on the hot commit path.
      if (handle.length >= 14) {
        const big = BigInt('0x' + handle)
        if (big > this._maxHandleBig) {
          this._maxHandleBig = big
        }
      }
      return
    }

    const value = parseInt(handle, 16)
    if (isNaN(value)) {
      return
    }
    if (value > Number.MAX_SAFE_INTEGER) {
      this._maxHandleBig = BigInt('0x' + handle)
      return
    }
    if (value > this._maxHandle) {
      this._maxHandle = value
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
    const tableDuplicate = hasId != null && objectId != null && hasId(objectId)
    const needsGenerated = !objectId || object.isTemp || tableDuplicate

    if (needsGenerated) {
      this.assignGeneratedHandle(object)
      return
    }

    const incumbent = this._handleRegistry.get(objectId)
    if (incumbent && incumbent !== object) {
      if (this.shouldPreserveIncomingHandle(object)) {
        this.assignGeneratedHandle(incumbent)
      } else {
        this.assignGeneratedHandle(object)
        return
      }
    }

    this.registerObjectHandle(object)
    this.updateMaxHandle(objectId)
  }

  /**
   * Returns true when an object already carries an explicit handle that should
   * be preserved over auto-generated registry occupants (typically DXF/DWG imports).
   */
  private shouldPreserveIncomingHandle(object: AcDbObject): boolean {
    return !object.isTemp
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
   * Display tessellation side count for a full circle.
   *
   * Configured via {@link AcDbOpenDatabaseOptions.circleSides} when the
   * database is opened. Defaults to {@link ACDB_DRAW_CIRCLE_SIDES_DRAFT}.
   */
  get drawCircleSides() {
    return this._drawCircleSides
  }
  set drawCircleSides(value: number) {
    this._drawCircleSides = AcGeCircArc2d.resolveCircleSides(value)
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
   * Gets or sets the drawing thumbnail preview image.
   *
   * Corresponds to AutoCAD .NET `Database.ThumbnailBitmap`, DXF
   * `THUMBNAILIMAGE` section (group codes 90/310), and the DWG file preview.
   * Stored as raw image bytes (typically BMP/DIB or PNG).
   *
   * @returns Thumbnail image bytes, or `undefined` when none exist.
   */
  get thumbnailImage(): Uint8Array | undefined {
    return this._thumbnailImage
  }
  set thumbnailImage(value: Uint8Array | undefined) {
    if (!value || value.length === 0) {
      this._thumbnailImage = undefined
      return
    }
    this._thumbnailImage = value
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

  /** TILEMODE: true = model space (1), false = paper space (0). */
  get tilemode(): boolean {
    return this._tilemode
  }
  set tilemode(value: boolean) {
    this._tilemode = value
  }

  /** PSLTSCALE: paper space linetype scaling. */
  get psltscale(): boolean {
    return this._psltscale
  }
  set psltscale(value: boolean) {
    this._psltscale = value
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
   * The dimension style name for new dimension objects (`$DIMSTYLE`).
   */
  get dimstyle(): string {
    return this._dimstyle
  }
  set dimstyle(value: string) {
    this.updateSysVar(
      AcDbSystemVariables.DIMSTYLE,
      this._dimstyle,
      value ?? DEFAULT_TEXT_STYLE,
      nextValue => {
        this._dimstyle = nextValue
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
   * Whether hatch objects are included in drawing comparison (**COMPAREHATCH**).
   *
   * - `0`: Hatch objects are excluded (AutoCAD default)
   * - `1`: Hatch objects are included
   *
   * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-BBB5E4A0-B607-4898-9A6B-A65C51551EE5
   */
  get comparehatch(): number {
    return this._comparehatch
  }
  set comparehatch(value: number) {
    const nextValue = acdbCoerceIntegerSysVar(
      'COMPAREHATCH',
      value ?? ACDB_COMPAREHATCH_DEFAULT,
      ACDB_COMPAREHATCH_MIN,
      ACDB_COMPAREHATCH_MAX
    )
    this.updateSysVar(
      AcDbSystemVariables.COMPAREHATCH,
      this._comparehatch,
      nextValue,
      coerced => {
        this._comparehatch = coerced
      }
    )
  }

  /**
   * Offset between a change-set boundary and the revision cloud
   * (**COMPARERCMARGIN**). AutoCAD range is **1–25**; default is **5**.
   *
   * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-7A230058-048B-4EE6-949D-105AF6AC8E73
   */
  get comparercmargin(): number {
    return this._comparercmargin
  }
  set comparercmargin(value: number) {
    const nextValue = acdbCoerceIntegerSysVar(
      'COMPARERCMARGIN',
      value ?? ACDB_COMPARERCMARGIN_DEFAULT,
      ACDB_COMPARERCMARGIN_MIN,
      ACDB_COMPARERCMARGIN_MAX
    )
    this.updateSysVar(
      AcDbSystemVariables.COMPARERCMARGIN,
      this._comparercmargin,
      nextValue,
      coerced => {
        this._comparercmargin = coerced
      }
    )
  }

  /**
   * Whether text objects are included in drawing comparison (**COMPARETEXT**).
   *
   * - `0`: Text objects are excluded
   * - `1`: Text objects are included (AutoCAD default)
   *
   * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-1BE58261-FA5F-4914-BAC6-C1DF7E3D1E9C
   */
  get comparetext(): number {
    return this._comparetext
  }
  set comparetext(value: number) {
    const nextValue = acdbCoerceIntegerSysVar(
      'COMPARETEXT',
      value ?? ACDB_COMPARETEXT_DEFAULT,
      ACDB_COMPARETEXT_MIN,
      ACDB_COMPARETEXT_MAX
    )
    this.updateSysVar(
      AcDbSystemVariables.COMPARETEXT,
      this._comparetext,
      nextValue,
      coerced => {
        this._comparetext = coerced
      }
    )
  }

  /**
   * Decimal-place geometric tolerance used when comparing two drawings
   * (**COMPARETOLERANCE**). AutoCAD range is **0–14**; default is **6**.
   *
   * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-3131F7C8-7199-4EC5-9892-88C2D2A86F78
   */
  get comparetolerance(): number {
    return this._comparetolerance
  }
  set comparetolerance(value: number) {
    const nextValue = acdbCoerceIntegerSysVar(
      'COMPARETOLERANCE',
      value ?? ACDB_COMPARETOLERANCE_DEFAULT,
      ACDB_COMPARETOLERANCE_MIN,
      ACDB_COMPARETOLERANCE_MAX
    )
    this.updateSysVar(
      AcDbSystemVariables.COMPARETOLERANCE,
      this._comparetolerance,
      nextValue,
      coerced => {
        this._comparetolerance = coerced
      }
    )
  }

  /**
   * The most recent failure from {@link read} or {@link openUri}, or `null` after a successful open.
   *
   * Useful when a caller catches no exception (for example a viewer that returns `false`)
   * but still needs to distinguish worker out-of-memory from other parse failures.
   */
  get lastOpenError(): AcDbOpenDatabaseError | null {
    return this._lastOpenError
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
    this._lastOpenError = null
    this._drawNoPlotLayers = options?.drawNoPlotLayers ?? true
    this.drawCircleSides = options?.circleSides ?? ACDB_DRAW_CIRCLE_SIDES_DRAFT
    if (options?.fileName) {
      this.setDwgName(options.fileName)
    }

    // Ensure this database is the host working database for the duration of
    // conversion. Converters (including peer packages such as dxf-json-converter)
    // assign real handles on unbound objects; some entity getters still fall
    // back to the working database before append/add binds them.
    acdbAssignWorkingDatabase(this)

    try {
      await converter.read(data, this, {
        minimumChunkSize: (options && options.minimumChunkSize) || 10,
        progress: this.createConversionProgressHandler(),
        timeout: options?.timeout,
        encoding: options?.encoding,
        sysVars: options?.sysVars
      })
    } catch (error) {
      const openError = AcDbOpenDatabaseError.from(error)
      this._lastOpenError = openError
      this.events.openFailed.dispatch({ database: this, error: openError })
      throw openError
    }

    this._lastOpenError = null
    this.ensureDatabaseDefaults()
  }

  private createConversionProgressHandler(): AcDbConversionProgressCallback {
    return async (
      percentage: number,
      stage: AcDbConversionStage,
      stageStatus: AcDbStageStatus,
      data?: unknown,
      taskError?: AcCmTaskError
    ) => {
      let progressData: unknown = data
      if (stageStatus === 'ERROR' && taskError) {
        const openError = AcDbOpenDatabaseError.fromTask(taskError)
        this._lastOpenError = openError
        progressData = {
          code: openError.code,
          message: openError.message,
          stage: openError.stage ?? stage
        }
      }

      this.events.openProgress.dispatch({
        database: this,
        percentage: percentage,
        stage: 'CONVERSION',
        subStage: stage,
        subStageStatus: stageStatus,
        data: progressData
      })
    }
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
   * Exports the current database into DXF (ASCII string or binary bytes).
   *
   * The `fileName` parameter is kept for ObjectARX API parity. In this web
   * implementation the method returns the DXF payload instead of writing the
   * filesystem directly.
   *
   * @param _fileName - Kept for ObjectARX parity. Ignored in this implementation.
   * @param precision - Numeric precision used by the DXF filer.
   * @param version - Target DXF/DWG version name or value.
   * @param optionsOrThumbnail - Legacy boolean thumbnail flag, or options with
   *   `saveThumbnailImage` and `format: 'ascii' | 'binary'`.
   * @returns ASCII DXF string, or `Uint8Array` when format is `'binary'`.
   */
  dxfOut(
    _fileName?: string,
    precision: number = 16,
    version: AcDbDwgVersion | string | number = this.version.name,
    optionsOrThumbnail:
      | boolean
      | { saveThumbnailImage?: boolean; format?: 'ascii' | 'binary' } = false
  ): string | Uint8Array {
    this.ensureDatabaseDefaults()
    if (
      this._layerFilters.root.getNestedFilters().length > 0 &&
      !this.tables.layerTable.extensionDictionary
    ) {
      this.tables.layerTable.extensionDictionary = this.generateHandle()
    }

    const options =
      typeof optionsOrThumbnail === 'boolean'
        ? {
            saveThumbnailImage: optionsOrThumbnail,
            format: 'ascii' as const
          }
        : {
            saveThumbnailImage: optionsOrThumbnail.saveThumbnailImage ?? false,
            format: optionsOrThumbnail.format ?? 'ascii'
          }

    const outVersion =
      version instanceof AcDbDwgVersion ? version : new AcDbDwgVersion(version)
    const filer = new AcDbDxfFiler({
      database: this,
      precision,
      version: outVersion,
      outputFormat: options.format
    })

    this.writeDxfHeaderSection(filer)
    this.writeDxfClassesSection(filer)
    this.writeDxfTablesSection(filer, outVersion)
    this.writeDxfBlocksSection(filer)
    this.writeDxfEntitiesSection(filer)
    this.writeDxfObjectsSection(filer)
    this.writeDxfThumbnailImageSection(filer, options.saveThumbnailImage)
    filer.writeStart('EOF')
    filer.finalizeHeaderHandleSeed()
    return options.format === 'binary' ? filer.toBinary() : filer.toString()
  }

  /**
   * Triggers xxxAppended events with data in the database to redraw the associated viewer.
   */
  async regen() {
    const converter = new AcDbRegenerator(this)
    await converter.read(null as unknown as ArrayBuffer, this, {
      minimumChunkSize: 500,
      progress: this.createConversionProgressHandler()
    })
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
      // LibreDWG / incomplete dictionaries can yield entries whose key or
      // `styleName` is missing — skip those instead of throwing mid-open.
      if (
        name?.toUpperCase() === normalizedName.toUpperCase() ||
        style.styleName?.toUpperCase() === normalizedName.toUpperCase()
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
      if (name?.toUpperCase() === normalizedName.toUpperCase()) {
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
    filer.writeHeaderHandleSeed()
    if (filer.capabilities.supportsUtf8CodePage) {
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
    if (filer.capabilities.supportsLineWeight) {
      filer.writeString(9, '$LWDISPLAY')
      filer.writeInt16(70, this.lwdisplay ? 1 : 0)
    }
    filer.writeString(9, '$CELTSCALE')
    filer.writeDouble(40, this.celtscale)
    if (filer.capabilities.supportsLineWeight) {
      filer.writeString(9, '$CELWEIGHT')
      filer.writeLineWeight(370, this.celweight)
    }
    filer.writeString(9, '$CECOLOR')
    filer.writeCmColor(this.cecolor)
    filer.writeString(9, '$TILEMODE')
    filer.writeInt16(70, this.tilemode ? 1 : 0)
    filer.writeString(9, '$PSLTSCALE')
    filer.writeInt16(70, this.psltscale ? 1 : 0)
    filer.writeString(9, '$CLAYER')
    filer.writeString(8, this.clayer)
    filer.writeString(9, '$CELTYPE')
    filer.writeString(6, this.celtype)
    if (
      filer.capabilities.supportsTransparency &&
      !this.cetransparency.isInvalid
    ) {
      filer.writeString(9, '$CETRANSPARENCY')
      filer.writeTransparency(this.cetransparency)
    }
    filer.writeString(9, '$CMLSTYLE')
    filer.writeString(2, this.cmlstyle)
    filer.writeString(9, '$CMLSCALE')
    filer.writeDouble(40, this.cmlscale)
    if ((filer.version?.value ?? 33) >= 27) {
      filer.writeString(9, '$CMLEADERSTYLE')
      filer.writeString(2, this.cmleaderstyle)
    }
    if (
      (filer.version?.value ?? 33) >= 25 &&
      this.hpcolor.colorMethod !== AcCmColorMethod.None
    ) {
      filer.writeString(9, '$HPCOLOR')
      filer.writeCmColor(this.hpcolor, 2)
    }
    if (
      (filer.version?.value ?? 33) >= 25 &&
      this.hpbackgroundcolor.colorMethod !== AcCmColorMethod.None
    ) {
      filer.writeString(9, '$HPBACKGROUNDCOLOR')
      filer.writeCmColor(this.hpbackgroundcolor, 2)
    }
    if ((filer.version?.value ?? 33) >= 25) {
      filer.writeString(9, '$HPLAYER')
      filer.writeString(8, this.hplayer)
    }
    if (
      filer.capabilities.supportsTransparency &&
      !this.hptransparency.isInvalid
    ) {
      filer.writeString(9, '$HPTRANSPARENCY')
      filer.writeTransparency(this.hptransparency)
    }
    filer.writeString(9, '$TEXTSTYLE')
    filer.writeString(7, this.textstyle)
    filer.writeString(9, '$DIMSTYLE')
    filer.writeString(2, this.dimstyle)
    filer.writeString(9, '$ANGBASE')
    filer.writeAngle(50, this.angbase)
    filer.writeString(9, '$ANGDIR')
    filer.writeInt16(70, this.angdir)
    filer.writeString(9, '$AUNITS')
    filer.writeInt16(70, this.aunits)
    filer.writeString(9, '$AUPREC')
    filer.writeInt16(70, this.auprec)
    if ([this.extmin.x, this.extmin.y, this.extmin.z].every(Number.isFinite)) {
      filer.writeString(9, '$EXTMIN')
      filer.writePoint3d(10, this.extmin)
    }
    if ([this.extmax.x, this.extmax.y, this.extmax.z].every(Number.isFinite)) {
      filer.writeString(9, '$EXTMAX')
      filer.writePoint3d(10, this.extmax)
    }
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
   * Writes the CLASSES section for the DXF export.
   *
   * Required for proxy entities whose group code **91** indexes into this
   * section. Skipped when no classes were loaded from the source drawing.
   *
   * @param filer - DXF output writer.
   */
  private writeDxfClassesSection(filer: AcDbDxfFiler) {
    if (
      !filer.capabilities.supportsClassesSection ||
      this._classes.length === 0
    ) {
      return
    }

    filer.startSection('CLASSES')
    for (const dxfClass of this._classes) {
      filer.writeStart('CLASS')
      filer.writeString(1, dxfClass.name)
      filer.writeString(2, dxfClass.cppClassName)
      filer.writeString(3, dxfClass.appName)
      filer.writeInt32(90, dxfClass.proxyFlag)
      filer.writeInt32(91, dxfClass.instanceCount)
      filer.writeInt8(280, dxfClass.wasProxy ? 1 : 0)
      filer.writeInt8(281, dxfClass.isEntity ? 1 : 0)
    }
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
      'UCS',
      this.tables.ucsTable,
      this.tables.ucsTable.newIterator(),
      'UCS'
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
    if (version.capabilities.supportsBlockRecordTable) {
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
    if (!filer.capabilities.supportsObjectsSection) {
      return
    }
    filer.startSection('OBJECTS')
    const rootDict = this.objects.dictionary
    rootDict.ownerId = '0'

    const writeDictionary = (dict: AcDbDictionary) => {
      // Dictionary entries (3/350 pairs) are embedded in the DICTIONARY object.
      filer.writeStart('DICTIONARY')
      dict.dxfOut(filer, true)
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
    if (this.objects.group.numEntries > 0) {
      ensureRootEntry('ACAD_GROUP', this.objects.group)
    } else {
      dropRootEntry('ACAD_GROUP')
    }
    if (this.objects.sortentsTable.numEntries > 0) {
      ensureRootEntry('ACAD_SORTENTS', this.objects.sortentsTable)
    } else {
      dropRootEntry('ACAD_SORTENTS')
    }
    if (
      (filer.version?.value ?? 33) >= 27 &&
      this.objects.mleaderStyle.numEntries > 0
    ) {
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

    if (this.objects.group.numEntries > 0) {
      writeDictionary(this.objects.group)
    }
    if (this.objects.sortentsTable.numEntries > 0) {
      writeDictionary(this.objects.sortentsTable)
    }
    if (
      (filer.version?.value ?? 33) >= 27 &&
      this.objects.mleaderStyle.numEntries > 0
    ) {
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
      layout.dxfOut(filer, true)
    }

    for (const [key, group] of this.objects.group.entries()) {
      if (!group.name) group.name = key
      filer.writeStart('GROUP')
      group.dxfOut(filer, true)
    }

    for (const [_, sortents] of this.objects.sortentsTable.entries()) {
      filer.writeStart('SORTENTSTABLE')
      sortents.dxfOut(filer, true)
    }

    for (const [_, imageDef] of this.objects.imageDefinition.entries()) {
      filer.writeStart('IMAGEDEF')
      imageDef.dxfOut(filer, true)
    }

    for (const [_, layerFilter] of this.objects.layerFilter.entries()) {
      filer.writeStart('LAYER_FILTER')
      layerFilter.dxfOut(filer, true)
    }

    for (const [_, layerIndex] of this.objects.layerIndex.entries()) {
      filer.writeStart('LAYER_INDEX')
      layerIndex.dxfOut(filer, true)
    }

    if ((filer.version?.value ?? 33) >= 27) {
      for (const [_, mleaderStyle] of this.objects.mleaderStyle.entries()) {
        filer.writeStart('MLEADERSTYLE')
        mleaderStyle.dxfOut(filer, true)
      }
    }
    for (const [_, mlineStyle] of this.objects.mlineStyle.entries()) {
      filer.writeStart('MLINESTYLE')
      mlineStyle.dxfOut(filer, true)
    }

    for (const [_, xrecord] of this.objects.xrecord.entries()) {
      filer.writeStart('XRECORD')
      xrecord.dxfOut(filer, true)
    }

    this.writeAcLyLayerFilterObjects(filer)
    filer.endSection()
  }

  /**
   * Writes Layer Manager filter tree objects (`ACAD_LAYERFILTERS` /
   * `ACLYDICTIONARY` + XRecords) into the OBJECTS section and attaches an
   * extension dictionary to the Layer Table.
   *
   * @param filer - DXF output writer.
   */
  private writeAcLyLayerFilterObjects(filer: AcDbDxfFiler) {
    const serialized = acdbSerializeLayerFilterTree(this._layerFilters)
    if (serialized.nodes.length === 0) {
      return
    }

    type BuiltDict = {
      handle: string
      ownerId: string
      entries: { name: string; id: string }[]
    }
    type BuiltXRec = {
      handle: string
      ownerId: string
      extensionDictionaryId?: string
      data: AcDbSerializedFilterNode['data']
    }

    const dicts: BuiltDict[] = []
    const xrecs: BuiltXRec[] = []
    const layerTable = this.tables.layerTable
    const layerExtHandle =
      layerTable.extensionDictionary ?? this.generateHandle()
    layerTable.extensionDictionary = layerExtHandle

    const aclyHandle = this.generateHandle()
    const acadHandle = this.generateHandle()
    const rootAclyEntries: { name: string; id: string }[] = []
    const rootAcadEntries: { name: string; id: string }[] = []

    const emit = (
      node: AcDbSerializedFilterNode,
      parentAclyHandle: string,
      addToLegacy: boolean
    ): string => {
      const xHandle = this.generateHandle()
      let extensionDictionaryId: string | undefined
      if (node.children.length > 0) {
        const extHandle = this.generateHandle()
        const childAclyHandle = this.generateHandle()
        const childEntries: { name: string; id: string }[] = []
        for (const child of node.children) {
          childEntries.push({
            name: child.key,
            id: emit(child, childAclyHandle, false)
          })
        }
        dicts.push({
          handle: extHandle,
          ownerId: xHandle,
          entries: [{ name: ACLY_DICTIONARY_NAME, id: childAclyHandle }]
        })
        dicts.push({
          handle: childAclyHandle,
          ownerId: extHandle,
          entries: childEntries
        })
        extensionDictionaryId = extHandle
      }

      xrecs.push({
        handle: xHandle,
        ownerId: parentAclyHandle,
        extensionDictionaryId,
        data: node.data
      })
      if (addToLegacy) {
        rootAcadEntries.push({ name: node.key, id: xHandle })
      }
      return xHandle
    }

    for (const node of serialized.nodes) {
      rootAclyEntries.push({
        name: node.key,
        id: emit(node, aclyHandle, true)
      })
    }

    const layerExtEntries = new Map<string, string>()
    const existingLayerExt = this.getObjectById(layerExtHandle)
    if (existingLayerExt instanceof AcDbDictionary) {
      for (const [key, value] of existingLayerExt.entries()) {
        layerExtEntries.set(key, value.objectId)
      }
    }
    layerExtEntries.set(ACLY_DICTIONARY_NAME, aclyHandle)
    layerExtEntries.set(ACAD_LAYERFILTERS_NAME, acadHandle)

    dicts.unshift(
      {
        handle: layerExtHandle,
        ownerId: layerTable.objectId,
        entries: Array.from(layerExtEntries, ([name, id]) => ({ name, id }))
      },
      {
        handle: aclyHandle,
        ownerId: layerExtHandle,
        entries: rootAclyEntries
      },
      {
        handle: acadHandle,
        ownerId: layerExtHandle,
        entries: rootAcadEntries
      }
    )

    for (const dict of dicts) {
      filer.writeStart('DICTIONARY')
      filer.writeHandle(5, dict.handle)
      filer.writeObjectId(330, dict.ownerId)
      filer.writeSubclassMarker('AcDbDictionary')
      filer.writeInt16(280, 1)
      filer.writeInt16(281, 1)
      for (const entry of dict.entries) {
        filer.writeString(3, entry.name)
        filer.writeObjectId(350, entry.id)
      }
    }

    for (const item of xrecs) {
      const xrecord = new AcDbXrecord()
      xrecord.objectId = item.handle
      xrecord.ownerId = item.ownerId
      if (item.extensionDictionaryId) {
        xrecord.extensionDictionary = item.extensionDictionaryId
      }
      xrecord.data = acdbLayerGroupsToResultBuffer(item.data)
      filer.writeStart('XRECORD')
      xrecord.dxfOut(filer)
    }
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
      record.dxfOut(filer, true)
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
    if (
      entity instanceof AcDbPolyline &&
      !filer.capabilities.supportsLwPolyline
    ) {
      filer.writeStart('POLYLINE')
      entity.dxfOutAs2dPolyline(filer, true)
      return
    }
    filer.writeStart(entity.dxfTypeName)
    entity.dxfOut(filer, true)
  }

  /**
   * Writes THUMBNAILIMAGE when preview bytes are present and export requested.
   */
  private writeDxfThumbnailImageSection(
    filer: AcDbDxfFiler,
    saveThumbnailImage = false
  ) {
    const bytes = this._thumbnailImage
    if (!saveThumbnailImage || !bytes || bytes.length === 0) {
      return
    }
    if (!filer.capabilities.supportsObjectsSection) {
      // Thumbnail section is post-R12; skip for AC1009.
      return
    }
    const chunkSize = 127
    filer.startSection('THUMBNAILIMAGE')
    filer.writeInt32(90, bytes.length)
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize)
      filer.writeString(310, acdbBytesToHexString(chunk))
    }
    filer.endSection()
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
    this._classes = []
    this._tables.blockTable.removeAll()
    this._tables.dimStyleTable.removeAll()
    this._tables.linetypeTable.removeAll()
    this._tables.textStyleTable.removeAll()
    this._tables.ucsTable.removeAll()
    this._tables.viewTable.removeAll()
    this._tables.layerTable.removeAll()
    this._tables.viewportTable.removeAll()
    this._tables.appIdTable.removeAll()
    this._objects.layout.removeAll()
    this._objects.group.removeAll()
    this._objects.imageDefinition.removeAll()
    this._objects.layerFilter.removeAll()
    this._objects.layerIndex.removeAll()
    this._objects.mleaderStyle.removeAll()
    this._objects.mlineStyle.removeAll()
    this._objects.sortentsTable.removeAll()
    this._objects.xrecord.removeAll()
    this._layerFilters = new AcLyLayerFilterTree()
    this._currentSpace = undefined
    this._extents.makeEmpty()
    this.registerBootstrapHandles()
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
