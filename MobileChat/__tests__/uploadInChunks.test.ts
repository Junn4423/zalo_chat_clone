import {uploadInChunks} from '../src/utils/uploadInChunks';

describe('uploadInChunks', () => {
  it('uploads large selections in bounded sequential batches', async () => {
    const batches: number[][] = [];
    const unsent = await uploadInChunks(Array.from({length: 11}, (_, index) => index), 5, async chunk => {
      batches.push(chunk);
      return true;
    });

    expect(batches).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10]]);
    expect(unsent).toEqual([]);
  });

  it('keeps the failed batch and every later item for retry', async () => {
    const batches: number[][] = [];
    const unsent = await uploadInChunks(Array.from({length: 11}, (_, index) => index), 5, async chunk => {
      batches.push(chunk);
      return batches.length === 1;
    });

    expect(batches).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
    expect(unsent).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('rejects invalid chunk sizes', async () => {
    await expect(uploadInChunks([1], 0, async () => true)).rejects.toThrow('chunkSize must be a positive integer');
  });
});
