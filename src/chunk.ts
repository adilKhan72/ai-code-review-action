import type { PrFile, SkippedFile } from './types.js';

export interface ChunkResult {
  chunks: PrFile[][];
  skipped: SkippedFile[];
  totalBytes: number;
}

/**
 * Groups files into model requests. Files are never split: a finding needs the whole hunk context, and
 * splitting a file would let two requests disagree about it.
 *
 * - `maxChunkBytes`: soft per-request budget. A single file larger than this gets a request of its own.
 * - `maxTotalBytes`: hard budget across the whole review (`max-diff-bytes`). Files that do not fit are
 *   skipped, not truncated. Half a diff produces confident but wrong findings.
 *
 * Input order is kept (GitHub returns files in path order), so the result is the same on every run.
 */
export function chunkFiles(
  files: readonly PrFile[],
  maxChunkBytes: number,
  maxTotalBytes: number,
): ChunkResult {
  const chunks: PrFile[][] = [];
  const skipped: SkippedFile[] = [];
  let current: PrFile[] = [];
  let currentBytes = 0;
  let totalBytes = 0;

  for (const file of files) {
    const bytes = Buffer.byteLength(file.patch ?? '', 'utf8');
    if (totalBytes + bytes > maxTotalBytes) {
      skipped.push({ path: file.filename, reason: `over max-diff-bytes (${maxTotalBytes})` });
      continue;
    }
    if (current.length > 0 && currentBytes + bytes > maxChunkBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += bytes;
    totalBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, skipped, totalBytes };
}
