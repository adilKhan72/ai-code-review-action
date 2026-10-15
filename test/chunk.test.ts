import { describe, expect, it } from 'vitest';
import { chunkFiles } from '../src/chunk.js';
import { file, patchOfSize } from './fixtures.js';

const names = (chunks: { filename: string }[][]) => chunks.map((c) => c.map((f) => f.filename));

describe('chunkFiles', () => {
  it('packs whole files into chunks under the per-request budget, keeping order', () => {
    const files = [file('a', patchOfSize(400)), file('b', patchOfSize(400)), file('c', patchOfSize(400))];
    const result = chunkFiles(files, 1_000, 10_000);
    expect(names(result.chunks)).toEqual([['a', 'b'], ['c']]);
    expect(result.totalBytes).toBe(1_200);
  });

  it('gives an oversized file its own chunk instead of splitting it', () => {
    const files = [file('a', patchOfSize(100)), file('big', patchOfSize(5_000)), file('c', patchOfSize(100))];
    expect(names(chunkFiles(files, 1_000, 10_000).chunks)).toEqual([['a'], ['big'], ['c']]);
  });

  it('skips files that would exceed the total budget, but still fits later smaller ones', () => {
    const files = [file('a', patchOfSize(600)), file('b', patchOfSize(600)), file('c', patchOfSize(300))];
    const result = chunkFiles(files, 10_000, 1_000);
    expect(names(result.chunks)).toEqual([['a', 'c']]);
    expect(result.skipped).toEqual([{ path: 'b', reason: 'over max-diff-bytes (1000)' }]);
    expect(result.totalBytes).toBe(900);
  });

  it('returns no chunks for no files', () => {
    expect(chunkFiles([], 1_000, 1_000)).toEqual({ chunks: [], skipped: [], totalBytes: 0 });
  });
});
