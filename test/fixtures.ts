import type { PrFile } from '../src/types.js';

/** A realistic two-hunk patch, as returned in `pulls.listFiles[].patch`. */
export const TWO_HUNK_PATCH = [
  '@@ -1,4 +1,5 @@',
  " import { db } from './db';",
  '-const LIMIT = 10;',
  '+const LIMIT = 100;',
  '+const TIMEOUT_MS = 5000;',
  ' ',
  ' export function list() {',
  '@@ -20,3 +21,3 @@ export function list() {',
  ' function remove(id) {',
  '-  return db.delete(id);',
  '+  return db.query(`DELETE FROM t WHERE id = ${id}`);',
  ' }',
  '\\ No newline at end of file',
].join('\n');

export function file(
  filename: string,
  patch: string | undefined,
  status: PrFile['status'] = 'modified',
): PrFile {
  return { filename, status, patch };
}

/** A patch of roughly `bytes` bytes. */
export function patchOfSize(bytes: number): string {
  const header = '@@ -0,0 +1,1 @@\n+';
  return header + 'x'.repeat(Math.max(0, bytes - header.length));
}
