import { DxfParser, ParsedDxf } from '@mlightcad/dxf-json'

import { AcDbDxfParser } from '../src/AcDbDxfParser'

describe('AcDbDxfParser', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })
  it('parses minimal valid dxf content', () => {
    const parser = new AcDbDxfParser()
    const content = [
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$ACADVER',
      '1',
      'AC1032',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'ENDSEC',
      '0',
      'EOF'
    ].join('\n')

    const data = new TextEncoder().encode(content).buffer
    const parsed = parser.parse(data as ArrayBuffer)
    expect(parsed).toBeTruthy()
    expect(parsed.header.$ACADVER).toBe('AC1032')
  })

  it('routes binary DXF to parseBuffer instead of parseSync', () => {
    const parser = new AcDbDxfParser()
    const binarySentinel = new Uint8Array([
      0x41, 0x75, 0x74, 0x6f, 0x43, 0x41, 0x44, 0x20, 0x42, 0x69, 0x6e, 0x61,
      0x72, 0x79, 0x20, 0x44, 0x58, 0x46, 0x0d, 0x0a, 0x1a, 0x00
    ])
    const parseBuffer = jest
      .spyOn(DxfParser.prototype, 'parseBuffer')
      .mockReturnValue({
        header: { $ACADVER: 'AC1032' }
      } as unknown as ParsedDxf)
    const parseSync = jest.spyOn(DxfParser.prototype, 'parseSync')

    const parsed = parser.parse(binarySentinel.buffer)

    expect(parseBuffer).toHaveBeenCalledWith(binarySentinel)
    expect(parseSync).not.toHaveBeenCalled()
    expect(parsed.header.$ACADVER).toBe('AC1032')
  })
})
