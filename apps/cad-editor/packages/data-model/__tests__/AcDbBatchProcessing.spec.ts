import { AcDbBatchProcessing } from '../src/converter/AcDbBatchProcessing'

describe('AcDbBatchProcessing', () => {
  it('processes ranges in chunks and calls complete callback', async () => {
    const batch = new AcDbBatchProcessing(5, 2, 2)
    const ranges: Array<[number, number]> = []
    let completed = false

    await batch.processChunk(
      async (start, end) => {
        ranges.push([start, end])
      },
      async () => {
        completed = true
      }
    )

    expect(batch.count).toBe(5)
    expect(batch.numerOfChunk).toBe(2)
    expect(batch.minimumChunkSize).toBe(2)
    expect(batch.chunkSize).toBe(2)
    expect(ranges).toEqual([
      [0, 2],
      [2, 4],
      [4, 5]
    ])
    expect(completed).toBe(true)
  })

  it('handles empty count and minimum size recalculation', async () => {
    const batch = new AcDbBatchProcessing(0, 0, 50)
    let completed = false
    await batch.processChunk(
      async () => {},
      () => {
        completed = true
      }
    )
    expect(completed).toBe(true)

    const batch2 = new AcDbBatchProcessing(5, 10, 1)
    batch2.minimumChunkSize = 3
    expect(batch2.chunkSize).toBe(3)
  })
})
