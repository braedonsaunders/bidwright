import { AcCmTaskError } from '@mlightcad/common'

import {
  acdbIsWorkerOutOfMemoryMessage,
  type AcDbWorkerErrorCode
} from '../converter/worker/AcDbBaseWorker'
import {
  ACDB_DWG_CONVERTER_LICENSE_ERROR_NAME,
  acdbClassifyDwgConverterLicenseMessage,
  acdbClassifyDwgConverterLicenseMessageOrInvalid,
  acdbIsDwgConverterLicenseCode
} from '../converter/worker/AcDbDwgConverterLicense'
import { AcDbWorkerResult } from '../converter/worker/AcDbWorkerManager'
import { AcDbConversionStage } from './AcDbDatabaseConverter'

/**
 * Machine-readable reason for a failed {@link AcDbDatabase.read} or {@link AcDbDatabase.openUri}.
 *
 * - `worker_oom` — worker serialization or postMessage failed due to memory limits
 * - `worker_timeout` — a worker task exceeded its configured timeout
 * - `worker_error` — generic worker or postMessage failure
 * - `parse_failed` — the drawing could not be parsed into an {@link AcDbDatabase}
 * - `font_load_failed` — required font files could not be downloaded or loaded
 * - `fetch_failed` — the drawing source could not be fetched from a URI
 * - `license_expired` — DWG converter evaluation period has ended
 * - `license_invalid` — DWG converter license key is missing, malformed, expired, or invalid
 * - `unknown` — failure reason could not be classified
 */
export type AcDbOpenDatabaseErrorCode =
  | 'worker_oom'
  | 'worker_timeout'
  | 'worker_error'
  | 'parse_failed'
  | 'font_load_failed'
  | 'fetch_failed'
  | 'license_expired'
  | 'license_invalid'
  | 'unknown'

/**
 * Structured error thrown when opening a drawing database fails.
 *
 * Callers can inspect {@link code} to distinguish worker out-of-memory failures
 * from parse errors, timeouts, license failures, and other failure modes.
 */
export class AcDbOpenDatabaseError extends Error {
  /** Machine-readable failure category for programmatic handling. */
  readonly code: AcDbOpenDatabaseErrorCode

  /**
   * Conversion stage that was active when the failure occurred, when known.
   *
   * Populated for failures raised during {@link AcDbDatabase.read} or
   * {@link AcDbDatabase.openUri} pipeline tasks.
   */
  readonly stage?: AcDbConversionStage

  /** Original thrown value that was normalized into this error, when available. */
  readonly cause?: unknown

  /**
   * Creates a new open-database error.
   *
   * @param message - Human-readable failure description
   * @param code - Machine-readable failure category
   * @param options - Optional conversion stage and original cause
   */
  constructor(
    message: string,
    code: AcDbOpenDatabaseErrorCode,
    options?: { stage?: AcDbConversionStage; cause?: unknown }
  ) {
    super(message)
    this.name = 'AcDbOpenDatabaseError'
    this.code = code
    this.stage = options?.stage
    this.cause = options?.cause
  }

  /**
   * Returns `true` when {@link code} is a license failure.
   */
  static isLicenseErrorCode(
    code: AcDbOpenDatabaseErrorCode
  ): code is 'license_expired' | 'license_invalid' {
    return acdbIsDwgConverterLicenseCode(code)
  }

  /**
   * Returns `true` when the message indicates a worker serialization OOM failure.
   *
   * @param message - Worker or postMessage error text to inspect
   * @returns Whether the message matches a known out-of-memory pattern
   */
  static isWorkerOutOfMemoryMessage(message: string): boolean {
    return acdbIsWorkerOutOfMemoryMessage(message)
  }

  /**
   * Classifies a thrown value into an {@link AcDbOpenDatabaseErrorCode}.
   *
   * Prefers a structured `code` on the error (for example
   * `DwgConverterLicenseError.code`), then the error `name`, then message
   * heuristics used for worker/postMessage failures.
   *
   * @param error - Thrown value from an open or conversion operation
   * @returns The inferred open-database error code
   */
  static classifyThrownError(error: unknown): AcDbOpenDatabaseErrorCode {
    if (error instanceof Error) {
      const structured = AcDbOpenDatabaseError.readStructuredCode(error)
      if (structured) {
        return structured
      }

      if (error.name === ACDB_DWG_CONVERTER_LICENSE_ERROR_NAME) {
        return acdbClassifyDwgConverterLicenseMessageOrInvalid(error.message)
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return AcDbOpenDatabaseError.classifyWorkerErrorMessage(message)
  }

  /**
   * Classifies a worker error message into an {@link AcDbOpenDatabaseErrorCode}.
   *
   * Checks license markers, then out-of-memory patterns, then timeout wording,
   * and falls back to `worker_error` for all other messages.
   *
   * @param message - Worker or postMessage error text to classify
   * @returns The inferred open-database error code
   */
  static classifyWorkerErrorMessage(
    message: string
  ): AcDbOpenDatabaseErrorCode {
    const licenseCode = acdbClassifyDwgConverterLicenseMessage(message)
    if (licenseCode) {
      return licenseCode
    }
    if (AcDbOpenDatabaseError.isWorkerOutOfMemoryMessage(message)) {
      return 'worker_oom'
    }
    if (message.toLowerCase().includes('timed out')) {
      return 'worker_timeout'
    }
    return 'worker_error'
  }

  /**
   * Normalizes any thrown value into an {@link AcDbOpenDatabaseError}.
   *
   * Returns the input unchanged when it is already an instance of this class.
   * Otherwise extracts a message, classifies it, and wraps it in a new error.
   *
   * @param error - Thrown value from an open or conversion operation
   * @param stage - Conversion stage active when the failure occurred
   * @returns A typed open-database error
   */
  static from(
    error: unknown,
    stage?: AcDbConversionStage
  ): AcDbOpenDatabaseError {
    if (error instanceof AcDbOpenDatabaseError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)
    const code = AcDbOpenDatabaseError.classifyThrownError(error)
    return new AcDbOpenDatabaseError(message, code, { stage, cause: error })
  }

  /**
   * Normalizes a task scheduler failure into an {@link AcDbOpenDatabaseError}.
   *
   * Uses the failed task name as the conversion {@link stage}.
   *
   * @param taskError - Error emitted by {@link AcCmTaskScheduler} for a failed task
   * @returns A typed open-database error with stage populated from the task name
   */
  static fromTask(taskError: AcCmTaskError): AcDbOpenDatabaseError {
    const stage = taskError.task.name as AcDbConversionStage
    return AcDbOpenDatabaseError.from(taskError.error, stage)
  }

  /**
   * Throws an {@link AcDbOpenDatabaseError} when a worker parse result failed.
   *
   * Acts as a type guard: when this method returns normally, `result.success`
   * is known to be `true` and {@link AcDbWorkerResult.data} is defined.
   *
   * @param result - Worker task result to validate
   * @param stage - Conversion stage to attach to the thrown error
   * @throws {@link AcDbOpenDatabaseError} when `result.success` is `false`
   */
  static throwOnWorkerParseFailure<T>(
    result: AcDbWorkerResult<T>,
    stage: AcDbConversionStage = 'PARSE'
  ): asserts result is AcDbWorkerResult<T> & { success: true; data: T } {
    if (result.success) {
      return
    }

    const message =
      result.error != null
        ? `Failed to parse drawing due to error: '${result.error}'`
        : 'Failed to parse drawing due to an unknown worker error'

    const code = AcDbOpenDatabaseError.mapWorkerResultCode(
      result.errorCode,
      result.error
    )
    throw new AcDbOpenDatabaseError(message, code, { stage })
  }

  /**
   * Maps a structured worker error code to an {@link AcDbOpenDatabaseErrorCode}.
   *
   * When the worker code is missing or unrecognized, falls back to
   * {@link classifyWorkerErrorMessage} on the optional message text.
   *
   * OOM detection belongs in the worker ({@link AcDbBaseWorker}): once the
   * worker reports `worker_oom`, this method simply preserves that code.
   *
   * @param errorCode - Structured error category from the worker response
   * @param message - Worker error text used for heuristic classification
   * @returns The corresponding open-database error code
   */
  private static mapWorkerResultCode(
    errorCode?: AcDbWorkerErrorCode,
    message?: string
  ): AcDbOpenDatabaseErrorCode {
    switch (errorCode) {
      case 'worker_oom':
        return 'worker_oom'
      case 'worker_timeout':
        return 'worker_timeout'
      case 'worker_error':
        return 'worker_error'
      case 'license_expired':
        return 'license_expired'
      case 'license_invalid':
        return 'license_invalid'
      default:
        return AcDbOpenDatabaseError.classifyWorkerErrorMessage(message ?? '')
    }
  }

  /**
   * Reads a structured machine-readable code from a thrown error when present.
   */
  private static readStructuredCode(
    error: Error
  ): AcDbOpenDatabaseErrorCode | undefined {
    const code = (error as { code?: unknown }).code
    if (typeof code !== 'string') {
      return undefined
    }

    switch (code) {
      case 'license_expired':
      case 'license_invalid':
      case 'worker_oom':
      case 'worker_timeout':
      case 'worker_error':
      case 'parse_failed':
      case 'font_load_failed':
      case 'fetch_failed':
      case 'unknown':
        return code
      default:
        return undefined
    }
  }
}
