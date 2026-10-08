import {
  ACDB_DXF_MTEXT_CHUNK_CHARS,
  ACDB_DXF_XDATA_BINARY_MAX_BYTES,
  ACDB_DXF_XDATA_STRING_MAX_BYTES,
  AcDbDxfFiler,
  AcDbResultBuffer,
  acdbChunkBinaryByMaxBytes,
  acdbChunkDxfMTextContents,
  acdbChunkUtf8ByMaxBytes
} from '../src/base'

describe('AcDbDxfStringChunks', () => {
  it('chunks MTEXT contents into group 3 then group 1', () => {
    expect(acdbChunkDxfMTextContents('short')).toEqual([
      { code: 1, value: 'short' }
    ])

    const text = 'A'.repeat(ACDB_DXF_MTEXT_CHUNK_CHARS * 2 + 20)
    const chunks = acdbChunkDxfMTextContents(text)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({
      code: 3,
      value: 'A'.repeat(ACDB_DXF_MTEXT_CHUNK_CHARS)
    })
    expect(chunks[1]).toEqual({
      code: 3,
      value: 'A'.repeat(ACDB_DXF_MTEXT_CHUNK_CHARS)
    })
    expect(chunks[2]).toEqual({ code: 1, value: 'A'.repeat(20) })
    expect(chunks.map(c => c.value).join('')).toBe(text)
  })

  it('chunks UTF-8 XData strings by byte length, not character count', () => {
    // Each CJK ideograph is 3 UTF-8 bytes → 255/3 = 85 chars per chunk.
    const text = '中'.repeat(100)
    const chunks = acdbChunkUtf8ByMaxBytes(
      text,
      ACDB_DXF_XDATA_STRING_MAX_BYTES
    )
    expect(chunks.length).toBeGreaterThan(1)
    const encoder = new TextEncoder()
    for (const chunk of chunks) {
      expect(encoder.encode(chunk).byteLength).toBeLessThanOrEqual(
        ACDB_DXF_XDATA_STRING_MAX_BYTES
      )
    }
    expect(chunks.join('')).toBe(text)
  })

  it('chunks binary payloads to the XData 1004 max', () => {
    const bytes = new Uint8Array(300)
    bytes.fill(0xab)
    const chunks = acdbChunkBinaryByMaxBytes(
      bytes,
      ACDB_DXF_XDATA_BINARY_MAX_BYTES
    )
    expect(chunks).toHaveLength(3)
    expect(chunks[0]!.byteLength).toBe(ACDB_DXF_XDATA_BINARY_MAX_BYTES)
    expect(chunks[1]!.byteLength).toBe(ACDB_DXF_XDATA_BINARY_MAX_BYTES)
    expect(chunks[2]!.byteLength).toBe(300 - ACDB_DXF_XDATA_BINARY_MAX_BYTES * 2)
  })
})

describe('AcDbDxfFiler XData chunking', () => {
  it('splits long group-1000 strings across multiple tags', () => {
    const filer = new AcDbDxfFiler()
    const long = 'B'.repeat(ACDB_DXF_XDATA_STRING_MAX_BYTES + 40)
    filer.writeResultBuffer(
      new AcDbResultBuffer([
        { code: 1001, value: 'MYAPP' },
        { code: 1000, value: long }
      ])
    )
    const out = filer.toString()
    const values = [...out.matchAll(/(?:^|\n)1000\n([^\n]*)/g)].map(m => m[1])
    expect(values).toHaveLength(2)
    expect(values.join('')).toBe(long)
    expect(out).toContain('1001\nMYAPP')
  })

  it('splits long group-1004 binary into 127-byte hex chunks', () => {
    const filer = new AcDbDxfFiler()
    const bytes = new Uint8Array(200)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff
    filer.writeResultBuffer(
      new AcDbResultBuffer([{ code: 1004, value: bytes }])
    )
    const out = filer.toString()
    const values = [...out.matchAll(/(?:^|\n)1004\n([0-9A-Fa-f]*)/g)].map(
      m => m[1]
    )
    expect(values).toHaveLength(2)
    // First chunk is 127 bytes → 254 hex chars
    expect(values[0]).toHaveLength(ACDB_DXF_XDATA_BINARY_MAX_BYTES * 2)
    expect(values[1]).toHaveLength((200 - ACDB_DXF_XDATA_BINARY_MAX_BYTES) * 2)
  })

  it('expands XData 1010 point objects to 1010/1020/1030 doubles', () => {
    const filer = new AcDbDxfFiler({ precision: 6 })
    filer.writeResultBuffer(
      new AcDbResultBuffer([
        { code: 1001, value: 'MYAPP' },
        { code: 1010, value: { x: 1.5, y: 2.25, z: 3 } },
        { code: 1011, value: [10, 20, 30] }
      ])
    )
    const out = filer.toString()
    expect(out).not.toContain('[object Object]')
    expect(out).toContain('1010\n1.5\n1020\n2.25\n1030\n3\n')
    expect(out).toContain('1011\n10\n1021\n20\n1031\n30\n')
  })

  it('writes group-1004 binary from number arrays as valid hex', () => {
    const filer = new AcDbDxfFiler()
    filer.writeResultBuffer(
      new AcDbResultBuffer([{ code: 1004, value: [0xab, 0xcd, 0xef] }])
    )
    const out = filer.toString()
    expect(out).toBe('1004\nABCDEF\n')
    expect(out).not.toContain('[object Object]')
    expect(out).not.toContain('171,205,239')
  })

  it('writeMTextContents emits AutoCAD group 3 / group 1 order', () => {
    const filer = new AcDbDxfFiler()
    const text = 'C'.repeat(520)
    filer.writeMTextContents(text)
    const out = filer.toString()
    const group3 = [...out.matchAll(/(?:^|\n)3\n([^\n]*)/g)].map(m => m[1])
    const group1 = [...out.matchAll(/(?:^|\n)1\n([^\n]*)/g)].map(m => m[1])
    expect(group3).toHaveLength(2)
    expect(group3[0]).toBe('C'.repeat(250))
    expect(group3[1]).toBe('C'.repeat(250))
    expect(group1).toEqual(['C'.repeat(20)])
  })
})
