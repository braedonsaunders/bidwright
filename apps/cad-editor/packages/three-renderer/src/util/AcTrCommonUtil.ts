/**
 * @internal
 */
export class AcTrCommonUtil {
  static getExtension(url: string) {
    return url.substring(url.lastIndexOf('.') + 1)
  }

  /**
   * Estimates the memory size of an object in bytes.
   * @param {any} obj - The object to estimate.
   * @returns {number} Estimated size in bytes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static estimateObjectSize(obj: any): number {
    const seen = new WeakSet()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function sizeOf(value: any): number {
      if (value === null || value === undefined) return 0

      const type = typeof value

      if (type === 'boolean') return 4
      if (type === 'number') return 8
      if (type === 'string') return value.length * 2
      if (type === 'symbol') return 0
      if (type === 'function') return 0

      if (seen.has(value)) return 0
      seen.add(value)

      if (Array.isArray(value)) {
        return value.map(sizeOf).reduce((acc, curr) => acc + curr, 0)
      }

      if (type === 'object') {
        let bytes = 0
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            bytes += key.length * 2 // key is a string
            bytes += sizeOf(value[key])
          }
        }
        return bytes
      }

      return 0
    }

    return sizeOf(obj)
  }

  public static getFileName(url: string) {
    return url.split('/').pop()
  }

  static getFileNameWithoutExtension(url: string) {
    const fileName = AcTrCommonUtil.getFileName(url)
    if (fileName) {
      // Find the last dot to separate the extension, if any
      const dotIndex = fileName.lastIndexOf('.')

      // If no dot is found, return the file name as is
      if (dotIndex === -1) {
        return fileName
      }

      // Otherwise, return the part before the last dot (file name without extension)
      return fileName.substring(0, dotIndex)
    }
    return url
  }
}
