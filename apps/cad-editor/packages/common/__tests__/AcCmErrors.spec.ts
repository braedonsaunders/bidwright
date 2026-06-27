import { AcCmErrors } from '../src'

describe('AcCmErrors', () => {
  it('returns typed errors with expected messages and fresh instances', () => {
    const illegal1 = AcCmErrors.ILLEGAL_PARAMETERS
    const illegal2 = AcCmErrors.ILLEGAL_PARAMETERS
    expect(illegal1).toBeInstanceOf(ReferenceError)
    expect(illegal1.message).toBe('Illegal Parameters')
    expect(illegal1).not.toBe(illegal2)

    expect(AcCmErrors.ZERO_DIVISION.message).toBe('Zero division')
    expect(AcCmErrors.UNRESOLVED_BOUNDARY_CONFLICT.message).toContain(
      'Unresolved boundary conflict'
    )
    expect(AcCmErrors.INFINITE_LOOP.message).toBe('Infinite loop')
    expect(AcCmErrors.CANNOT_INVOKE_ABSTRACT_METHOD.message).toBe(
      'Abstract method cannot be invoked'
    )
    expect(AcCmErrors.OPERATION_IS_NOT_SUPPORTED.message).toBe(
      'Operation is not supported'
    )
    expect(AcCmErrors.NOT_IMPLEMENTED.message).toBe('Not implemented yet')
  })
})
