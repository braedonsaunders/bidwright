import * as THREE from 'three'

/**
 * Util class for Threejs Object
 * @internal
 */
export class AcTrObjectUtil {
  public static isEmptyObject(object: THREE.Object3D) {
    const length = object.children.length
    if (length === 0) {
      const geom = (object as any).geometry // eslint-disable-line
      if (
        !geom ||
        !geom.hasAttribute('position') ||
        geom.getAttribute('position').count === 0
      ) {
        return true
      }
    }
    return false
  }

  public static removeEmptyObjects(object: THREE.Object3D) {
    for (let i = 0; i < object.children.length; ) {
      if (!this.removeEmptyObjects(object.children[i])) {
        ++i
      }
    }

    if (this.isEmptyObject(object)) {
      object.removeFromParent()
      return true
    }
    return false
  }
}
