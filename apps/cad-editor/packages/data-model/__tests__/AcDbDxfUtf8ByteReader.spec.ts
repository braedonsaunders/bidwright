import type { AcDbDxfPair } from '../src/base/AcDbDxfPair'
import {
  acdbCreateDxfPairReader,
  acdbMakeAsciiDxfPairReader,
  acdbMakeUtf8AsciiDxfPairReader,
  type AcDbDxfPairReader
} from '../src/base/AcDbDxfPairReader'

function buildDxf(lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n')
}

function collectPairs(reader: AcDbDxfPairReader): AcDbDxfPair[] {
  const pairs: AcDbDxfPair[] = []
  for (;;) {
    const pair = reader.next()
    if (pair === undefined) return pairs
    pairs.push(pair)
  }
}

function hasValue(pairs: AcDbDxfPair[], value: unknown): boolean {
  return pairs.some(pair => pair.value === value)
}

/** UTF-8 bytes with a stale pre-2007 ANSI_936 codepage header. */
const STALE_HEADER_UTF8_DXF = [
  '0',
  'SECTION',
  '2',
  'HEADER',
  '9',
  '$ACADVER',
  '1',
  'AC1015',
  '9',
  '$DWGCODEPAGE',
  '3',
  'ANSI_936',
  '0',
  'ENDSEC',
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'TEXT',
  '8',
  '图层',
  '1',
  '中文文本',
  '0',
  'ENDSEC',
  '0',
  'EOF'
]

describe('UTF-8 byte DXF reader', () => {
  it('parses ASCII DXF and skips a UTF-8 BOM', () => {
    const body = buildDxf([
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '1',
      '中文文本',
      '0',
      'EOF'
    ])
    const bytes = new Uint8Array(3 + body.length)
    bytes.set([0xef, 0xbb, 0xbf])
    bytes.set(body, 3)

    const pairs = collectPairs(acdbMakeUtf8AsciiDxfPairReader(bytes))
    expect(pairs[0]).toEqual({
      code: 0,
      type: 'string',
      value: 'SECTION'
    })
    expect(hasValue(pairs, '中文文本')).toBe(true)
  })

  it('decodes a multi-byte value crossing the old 64KiB window boundary', () => {
    // Old windowed reader cut windows at 64KiB; the byte reader has no such
    // boundary. The value line starts after '0\r\nTEXT\r\n1\r\n' (12 bytes).
    const longText = 'A'.repeat(65536 - 12) + '中文'
    const bytes = buildDxf([
      '0',
      'TEXT',
      '1',
      longText,
      '8',
      '图层',
      '0',
      'EOF'
    ])

    const pairs = collectPairs(acdbMakeUtf8AsciiDxfPairReader(bytes))
    const textPair = pairs.find(pair => pair.code === 1)
    expect(textPair?.value).toBe(longText)
    expect(hasValue(pairs, '图层')).toBe(true)
  })

  it('always decodes ASCII DXF as UTF-8 regardless of a stale ANSI_936 header', () => {
    const pairs = collectPairs(
      acdbCreateDxfPairReader(buildDxf(STALE_HEADER_UTF8_DXF))
    )
    expect(hasValue(pairs, '中文文本')).toBe(true)
    expect(hasValue(pairs, '图层')).toBe(true)
  })

  it('keeps the decoded-string helper in agreement with the byte reader', () => {
    const text =
      [
        '0',
        'SECTION',
        '2',
        'ENTITIES',
        '1',
        '中文文本',
        '8',
        '图层',
        '10',
        '1.5',
        '70',
        '3',
        '0',
        'EOF'
      ].join('\r\n') + '\r\n'

    expect(collectPairs(acdbMakeAsciiDxfPairReader(text))).toEqual(
      collectPairs(
        acdbMakeUtf8AsciiDxfPairReader(new TextEncoder().encode(text))
      )
    )
  })
})
