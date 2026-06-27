import { defaults } from '@mlightcad/common'
import { AcGePoint2d, AcGePoint3d } from '@mlightcad/geometry-engine'
import {
  AcGiDefaultLightingType,
  AcGiOrthographicType,
  AcGiRenderMode,
  AcGiView
} from '@mlightcad/graphic-interface'

import {
  AcDbSymbolTableRecord,
  AcDbSymbolTableRecordAttrs
} from './AcDbSymbolTableRecord'

const createDefaultView = (): AcGiView => ({
  center: new AcGePoint2d(),
  viewDirectionFromTarget: new AcGePoint3d(0, 0, 1),
  viewTarget: new AcGePoint3d(0, 0, 0),
  lensLength: 500,
  frontClippingPlane: 0,
  backClippingPlane: 0,
  viewHeight: 1000,
  viewTwistAngle: 0,
  frozenLayers: [],
  styleSheet: '',
  renderMode: AcGiRenderMode.OPTIMIZED_2D,
  viewMode: 0,
  ucsIconSetting: 0,
  ucsOrigin: new AcGePoint3d(0, 0, 0),
  ucsXAxis: new AcGePoint3d(1, 0, 0),
  ucsYAxis: new AcGePoint3d(0, 1, 0),
  orthographicType: AcGiOrthographicType.TOP,
  shadePlotSetting: 0,
  shadePlotObjectId: undefined,
  visualStyleObjectId: undefined,
  isDefaultLightingOn: false,
  defaultLightingType: AcGiDefaultLightingType.ONE_DISTANT_LIGHT,
  brightness: 0,
  contrast: 0,
  ambientColor: undefined,
  aspectRatio: undefined
})

/**
 * Interface defining the attributes for view-related symbol table records.
 */
export interface AcDbAbstractViewTableRecordAttrs
  extends AcDbSymbolTableRecordAttrs {
  /** Graphics system view configuration */
  gsView: AcGiView
}

/**
 * Base class for view-related symbol table records.
 *
 * Both AcDbViewTableRecord and AcDbViewportTableRecord share the same
 * view/camera properties (center, target, direction, twist, etc.). This
 * abstract class centralizes those common fields.
 */
export abstract class AcDbAbstractViewTableRecord<
  ATTRS extends
    AcDbAbstractViewTableRecordAttrs = AcDbAbstractViewTableRecordAttrs
> extends AcDbSymbolTableRecord<ATTRS> {
  /**
   * Creates a new AcDbAbstractViewTableRecord instance.
   *
   * @param attrs - Input attribute values for this view table record
   * @param defaultAttrs - Default values for attributes of this view table record
   */
  constructor(attrs?: Partial<ATTRS>, defaultAttrs?: Partial<ATTRS>) {
    attrs = attrs || ({} as Partial<ATTRS>)
    defaults(attrs, {
      gsView: createDefaultView()
    } as Partial<ATTRS>)
    super(attrs, defaultAttrs)
  }

  /**
   * Gets the AcGiView associated with this record.
   */
  get gsView(): AcGiView {
    return this.getAttr('gsView') as AcGiView
  }

  /**
   * Gets or sets the view center point (DCS).
   */
  get centerPoint() {
    return this.gsView.center
  }
  set centerPoint(value: AcGePoint2d) {
    this.gsView.center.copy(value)
  }

  /**
   * Gets or sets the view direction from target.
   */
  get viewDirectionFromTarget() {
    return this.gsView.viewDirectionFromTarget
  }
  set viewDirectionFromTarget(value: AcGePoint3d) {
    this.gsView.viewDirectionFromTarget.copy(value)
  }

  /**
   * Gets or sets the view target.
   */
  get viewTarget() {
    return this.gsView.viewTarget
  }
  set viewTarget(value: AcGePoint3d) {
    this.gsView.viewTarget.copy(value)
  }

  /**
   * Gets or sets the view height.
   */
  get viewHeight() {
    return this.gsView.viewHeight
  }
  set viewHeight(value: number) {
    this.gsView.viewHeight = value
  }

  /**
   * Gets or sets the view twist angle (radians).
   */
  get viewTwistAngle() {
    return this.gsView.viewTwistAngle
  }
  set viewTwistAngle(value: number) {
    this.gsView.viewTwistAngle = value
  }

  /**
   * Gets or sets the lens length.
   */
  get lensLength() {
    return this.gsView.lensLength
  }
  set lensLength(value: number) {
    this.gsView.lensLength = value
  }

  /**
   * Gets or sets the front clipping plane distance.
   */
  get frontClippingPlane() {
    return this.gsView.frontClippingPlane
  }
  set frontClippingPlane(value: number) {
    this.gsView.frontClippingPlane = value
  }

  /**
   * Gets or sets the back clipping plane distance.
   */
  get backClippingPlane() {
    return this.gsView.backClippingPlane
  }
  set backClippingPlane(value: number) {
    this.gsView.backClippingPlane = value
  }

  /**
   * Gets or sets the render mode.
   */
  get renderMode() {
    return this.gsView.renderMode
  }
  set renderMode(value: AcGiRenderMode) {
    this.gsView.renderMode = value
  }

  /**
   * Gets or sets the view mode.
   */
  get viewMode() {
    return this.gsView.viewMode
  }
  set viewMode(value: number) {
    this.gsView.viewMode = value
  }

  /**
   * Gets or sets the UCS icon setting.
   */
  get ucsIconSetting() {
    return this.gsView.ucsIconSetting
  }
  set ucsIconSetting(value: number) {
    this.gsView.ucsIconSetting = value
  }

  /**
   * Gets or sets the UCS origin.
   */
  get ucsOrigin() {
    return this.gsView.ucsOrigin
  }
  set ucsOrigin(value: AcGePoint3d) {
    this.gsView.ucsOrigin.copy(value)
  }

  /**
   * Gets or sets the UCS X axis.
   */
  get ucsXAxis() {
    return this.gsView.ucsXAxis
  }
  set ucsXAxis(value: AcGePoint3d) {
    this.gsView.ucsXAxis.copy(value)
  }

  /**
   * Gets or sets the UCS Y axis.
   */
  get ucsYAxis() {
    return this.gsView.ucsYAxis
  }
  set ucsYAxis(value: AcGePoint3d) {
    this.gsView.ucsYAxis.copy(value)
  }

  /**
   * Gets or sets the orthographic type.
   */
  get orthographicType() {
    return this.gsView.orthographicType
  }
  set orthographicType(value: AcGiOrthographicType) {
    this.gsView.orthographicType = value
  }

  /**
   * Gets or sets the shade plot setting.
   */
  get shadePlotSetting() {
    return this.gsView.shadePlotSetting
  }
  set shadePlotSetting(value: number) {
    this.gsView.shadePlotSetting = value
  }

  /**
   * Gets or sets the shade plot object ID.
   */
  get shadePlotObjectId() {
    return this.gsView.shadePlotObjectId
  }
  set shadePlotObjectId(value: string | undefined) {
    this.gsView.shadePlotObjectId = value
  }

  /**
   * Gets or sets the visual style object ID.
   */
  get visualStyleObjectId() {
    return this.gsView.visualStyleObjectId
  }
  set visualStyleObjectId(value: string | undefined) {
    this.gsView.visualStyleObjectId = value
  }

  /**
   * Gets or sets whether default lighting is on.
   */
  get isDefaultLightingOn() {
    return this.gsView.isDefaultLightingOn
  }
  set isDefaultLightingOn(value: boolean) {
    this.gsView.isDefaultLightingOn = value
  }

  /**
   * Gets or sets the default lighting type.
   */
  get defaultLightingType() {
    return this.gsView.defaultLightingType
  }
  set defaultLightingType(value: AcGiDefaultLightingType) {
    this.gsView.defaultLightingType = value
  }

  /**
   * Gets or sets the brightness.
   */
  get brightness() {
    return this.gsView.brightness
  }
  set brightness(value: number) {
    this.gsView.brightness = value
  }

  /**
   * Gets or sets the contrast.
   */
  get contrast() {
    return this.gsView.contrast
  }
  set contrast(value: number) {
    this.gsView.contrast = value
  }

  /**
   * Gets or sets the ambient color.
   */
  get ambientColor() {
    return this.gsView.ambientColor
  }
  set ambientColor(value: number | undefined) {
    this.gsView.ambientColor = value
  }

  /**
   * Gets or sets the view aspect ratio (view width / view height).
   */
  get aspectRatio() {
    return this.gsView.aspectRatio
  }
  set aspectRatio(value: number | undefined) {
    this.gsView.aspectRatio = value
  }
}