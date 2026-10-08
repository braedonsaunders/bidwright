/**
 * Base class for worker scripts that handles all message passing
 * Users only need to implement the executeTask method
 */

/// <reference lib="webworker" />

import {
  ACDB_DWG_CONVERTER_LICENSE_ERROR_NAME,
  acdbClassifyDwgConverterLicenseMessage,
  acdbClassifyDwgConverterLicenseMessageOrInvalid,
  acdbIsDwgConverterLicenseCode
} from './AcDbDwgConverterLicense'

/** Message sent from the main thread to a worker task. */
export interface AcDbWorkerMessage<TInput = unknown> {
  /** Unique task identifier used to correlate the response. */
  id: string
  /** Task input payload. */
  input: TInput
}

/**
 * Machine-readable error category for worker failures.
 *
 * - `worker_oom` — postMessage failed due to memory or clone limits
 * - `worker_timeout` — task exceeded the configured timeout (main thread)
 * - `worker_error` — generic worker or postMessage failure
 * - `license_expired` — DWG converter evaluation period has ended
 * - `license_invalid` — DWG converter license key is missing, malformed, expired, or invalid
 */
export type AcDbWorkerErrorCode =
  | 'worker_oom'
  | 'worker_timeout'
  | 'worker_error'
  | 'license_expired'
  | 'license_invalid'

/**
 * Substrings matched against worker / WASM error messages to detect OOM.
 *
 * Shared by {@link AcDbBaseWorker} and {@link AcDbOpenDatabaseError} so worker
 * `errorCode` classification stays aligned with main-thread heuristics.
 */
export const ACDB_WORKER_OOM_PATTERNS = [
  'out of memory',
  'data cannot be cloned',
  'allocation failed',
  'memory access out of bounds'
] as const

/**
 * Returns `true` when the message indicates a worker / WASM out-of-memory failure.
 *
 * @param message - Worker, postMessage, or parse error text to inspect
 */
export function acdbIsWorkerOutOfMemoryMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return ACDB_WORKER_OOM_PATTERNS.some(pattern => lower.includes(pattern))
}

/** Response posted back to the main thread after a worker task completes. */
export interface AcDbWorkerResponse<TOutput = unknown> {
  /** Task identifier matching the originating {@link AcDbWorkerMessage.id}. */
  id: string
  /** Whether the task completed without throwing. */
  success: boolean
  /** Task result when {@link success} is true. */
  data?: TOutput
  /** Human-readable error message when {@link success} is false. */
  error?: string
  /** Structured error category when {@link success} is false. */
  errorCode?: AcDbWorkerErrorCode
}

/**
 * Base class for worker scripts
 * Handles all message passing - users only need to implement executeTask
 */
export abstract class AcDbBaseWorker<TInput = unknown, TOutput = unknown> {
  constructor() {
    this.setupMessageHandler()
  }

  /**
   * Set up message handler - called automatically
   */
  private setupMessageHandler(): void {
    self.onmessage = async (event: MessageEvent<AcDbWorkerMessage<TInput>>) => {
      const { id, input } = event.data

      try {
        const result = await this.executeTask(input)
        this.sendResponse(id, true, result)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        this.sendResponse(
          id,
          false,
          undefined,
          message,
          this.classifyTaskError(error, message)
        )
      }
    }
  }

  /**
   * Send response back to main thread
   */
  private sendResponse(
    id: string,
    success: boolean,
    data?: TOutput,
    error?: string,
    errorCode?: AcDbWorkerErrorCode
  ): void {
    const response: AcDbWorkerResponse<TOutput> = {
      id,
      success,
      data,
      error,
      errorCode
    }

    try {
      self.postMessage(response)
    } catch (postError) {
      const message =
        postError instanceof Error ? postError.message : String(postError)
      self.postMessage({
        id,
        success: false,
        error: message,
        errorCode: this.classifyPostMessageError(message)
      })
    }
  }

  /**
   * Map a thrown worker task error to a structured error code.
   *
   * Prefers a structured `code` on the error (for example license failures),
   * then the error name, then message heuristics.
   */
  private classifyTaskError(
    error: unknown,
    message: string
  ): AcDbWorkerErrorCode {
    if (error instanceof Error) {
      const code = (error as { code?: unknown }).code
      if (acdbIsDwgConverterLicenseCode(code)) {
        return code
      }
      if (error.name === ACDB_DWG_CONVERTER_LICENSE_ERROR_NAME) {
        return acdbClassifyDwgConverterLicenseMessageOrInvalid(message)
      }
    }

    const licenseCode = acdbClassifyDwgConverterLicenseMessage(message)
    if (licenseCode) {
      return licenseCode
    }

    return this.classifyPostMessageError(message)
  }

  /**
   * Map a worker / postMessage failure message to a structured error code.
   *
   * Uses {@link acdbIsWorkerOutOfMemoryMessage} so WASM faults such as
   * `memory access out of bounds` are reported as `worker_oom`, not a generic
   * `worker_error`.
   */
  private classifyPostMessageError(message: string): AcDbWorkerErrorCode {
    if (acdbIsWorkerOutOfMemoryMessage(message)) {
      return 'worker_oom'
    }
    if (message.toLowerCase().includes('timed out')) {
      return 'worker_timeout'
    }
    return 'worker_error'
  }

  /**
   * Execute the actual task - users must implement this
   * @param input - Input data for the task
   * @returns Promise or direct result
   */
  protected abstract executeTask(input: TInput): Promise<TOutput> | TOutput
}
