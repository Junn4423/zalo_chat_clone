/** Upload items sequentially in bounded batches and return the first unsent item onward. */
export async function uploadInChunks<T>(
  items: T[],
  chunkSize: number,
  uploadChunk: (chunk: T[]) => Promise<boolean>,
): Promise<T[]> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('chunkSize must be a positive integer');
  }

  for (let offset = 0; offset < items.length; offset += chunkSize) {
    const chunk = items.slice(offset, offset + chunkSize);
    if (!await uploadChunk(chunk)) return items.slice(offset);
  }

  return [];
}
