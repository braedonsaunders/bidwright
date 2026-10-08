import { AcDbOpenDatabaseError } from '../src/database/AcDbOpenDatabaseError'

describe('AcDbOpenDatabaseError', () => {
  it('detects worker OOM messages', () => {
    expect(
      AcDbOpenDatabaseError.isWorkerOutOfMemoryMessage(
        "Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': Data cannot be cloned, out of memory."
      )
    ).toBe(true)
    expect(
      AcDbOpenDatabaseError.isWorkerOutOfMemoryMessage(
        'memory access out of bounds'
      )
    ).toBe(true)
    expect(
      AcDbOpenDatabaseError.isWorkerOutOfMemoryMessage('allocation failed')
    ).toBe(true)
    expect(
      AcDbOpenDatabaseError.classifyWorkerErrorMessage(
        'Worker operation timed out after 30ms'
      )
    ).toBe('worker_timeout')
  })

  it('preserves worker_oom from the worker result code', () => {
    try {
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error: 'memory access out of bounds',
        errorCode: 'worker_oom',
        duration: 1
      })
      fail('expected throw')
    } catch (error) {
      expect((error as AcDbOpenDatabaseError).code).toBe('worker_oom')
    }
  })

  it('trusts an explicit worker_error code from the worker', () => {
    try {
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error: 'memory access out of bounds',
        errorCode: 'worker_error',
        duration: 1
      })
      fail('expected throw')
    } catch (error) {
      // Classification of WASM OOM wording belongs in AcDbBaseWorker so the
      // worker reports worker_oom; mapWorkerResultCode does not second-guess
      // an explicit worker_error code.
      expect((error as AcDbOpenDatabaseError).code).toBe('worker_error')
    }
  })

  it('classifies missing worker codes from the error message', () => {
    try {
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error: 'memory access out of bounds',
        duration: 1
      })
      fail('expected throw')
    } catch (error) {
      expect((error as AcDbOpenDatabaseError).code).toBe('worker_oom')
    }
  })

  it('normalizes generic errors', () => {
    const error = AcDbOpenDatabaseError.from(new Error('bad dwg'), 'PARSE')
    expect(error.name).toBe('AcDbOpenDatabaseError')
    expect(error.code).toBe('worker_error')
    expect(error.stage).toBe('PARSE')
  })

  it('classifies structured license errors from thrown values', () => {
    const expired = new Error(
      'Your 30-day evaluation of @mlightcad/dwg-converter has expired. Contact MLightCAD to obtain a license key.'
    )
    expired.name = 'DwgConverterLicenseError'
    ;(expired as Error & { code: string }).code = 'license_expired'

    const openError = AcDbOpenDatabaseError.from(expired, 'PARSE')
    expect(openError.code).toBe('license_expired')
    expect(openError.cause).toBe(expired)
    expect(AcDbOpenDatabaseError.isLicenseErrorCode(openError.code)).toBe(true)

    const invalid = new Error(
      'Invalid @mlightcad/dwg-converter license key. Check the key or contact MLightCAD support.'
    )
    invalid.name = 'DwgConverterLicenseError'
    ;(invalid as Error & { code: string }).code = 'license_invalid'

    expect(AcDbOpenDatabaseError.from(invalid).code).toBe('license_invalid')
  })

  it('classifies license failures from message markers', () => {
    expect(
      AcDbOpenDatabaseError.classifyWorkerErrorMessage(
        'Your 30-day evaluation of @mlightcad/dwg-converter has expired. Contact MLightCAD to obtain a license key.'
      )
    ).toBe('license_expired')
    expect(
      AcDbOpenDatabaseError.classifyWorkerErrorMessage(
        'Invalid @mlightcad/dwg-converter license key. Check the key or contact MLightCAD support.'
      )
    ).toBe('license_invalid')
  })

  it('throws typed parse failures from worker results', () => {
    expect(() =>
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error:
          "Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': Data cannot be cloned, out of memory.",
        errorCode: 'worker_oom',
        duration: 1
      })
    ).toThrow(/out of memory/)

    try {
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error:
          "Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': Data cannot be cloned, out of memory.",
        errorCode: 'worker_oom',
        duration: 1
      })
    } catch (error) {
      expect((error as AcDbOpenDatabaseError).code).toBe('worker_oom')
      expect((error as AcDbOpenDatabaseError).name).toBe('AcDbOpenDatabaseError')
    }
  })

  it('maps worker license error codes through parse failures', () => {
    try {
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error:
          'Your 30-day evaluation of @mlightcad/dwg-converter has expired. Contact MLightCAD to obtain a license key.',
        errorCode: 'license_expired',
        duration: 1
      })
      fail('expected throw')
    } catch (error) {
      expect((error as AcDbOpenDatabaseError).code).toBe('license_expired')
    }

    try {
      AcDbOpenDatabaseError.throwOnWorkerParseFailure({
        success: false,
        error:
          'Invalid @mlightcad/dwg-converter license key. Check the key or contact MLightCAD support.',
        errorCode: 'license_invalid',
        duration: 1
      })
      fail('expected throw')
    } catch (error) {
      expect((error as AcDbOpenDatabaseError).code).toBe('license_invalid')
    }
  })
})
