import picomatch from 'picomatch';
import type { PrFile, SkippedFile } from './types.js';

export interface FilterOptions {
  include: string[];
  exclude: string[];
  maxFiles: number;
  maxFileBytes: number;
}

export interface FilterResult {
  selected: PrFile[];
  skipped: SkippedFile[];
}

/**
 * Decides which changed files are worth sending to the model. Runs before any model call, so everything
 * skipped here costs nothing. Every skip is recorded with a reason for the review summary.
 */
export function selectFiles(files: readonly PrFile[], options: FilterOptions): FilterResult {
  // `dot: true` so that `**` also matches files such as `.github/workflows/ci.yml`.
  const isIncluded = picomatch(options.include, { dot: true });
  const isExcluded = picomatch(options.exclude, { dot: true });
  const selected: PrFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const reason = skipReason(file, isIncluded, isExcluded, options.maxFileBytes);
    if (reason) {
      skipped.push({ path: file.filename, reason });
    } else if (selected.length >= options.maxFiles) {
      skipped.push({ path: file.filename, reason: `over max-files (${options.maxFiles})` });
    } else {
      selected.push(file);
    }
  }
  return { selected, skipped };
}

function skipReason(
  file: PrFile,
  isIncluded: (path: string) => boolean,
  isExcluded: (path: string) => boolean,
  maxFileBytes: number,
): string | undefined {
  if (file.status === 'removed') return 'file deleted';
  if (!isIncluded(file.filename)) return 'not matched by include';
  if (isExcluded(file.filename)) return 'matched by exclude';
  if (file.patch === undefined || file.patch === '') {
    return 'no patch (binary, rename only, or too large for the GitHub API)';
  }
  const bytes = Buffer.byteLength(file.patch, 'utf8');
  if (bytes > maxFileBytes) return `patch is ${bytes} bytes, over max-file-bytes (${maxFileBytes})`;
  return undefined;
}
