import { describe, expect, it } from 'vitest';
import { annotatePatch, parsePatch } from '../src/diff/patch.js';
import { TWO_HUNK_PATCH } from './fixtures.js';

describe('parsePatch', () => {
  const parsed = parsePatch(TWO_HUNK_PATCH);

  it('tracks new-file line numbers across hunks', () => {
    expect(parsed.hunks).toHaveLength(2);
    expect([...parsed.addedLines]).toEqual([2, 3, 22]);
    // Context and added lines are commentable; deleted lines are not.
    expect([...parsed.commentableLines].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 21, 22, 23]);
  });

  it('records old-file numbers for deletions', () => {
    const deletions = parsed.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'del');
    expect(deletions.map((l) => [l.oldLine, l.newLine])).toEqual([
      [2, undefined],
      [21, undefined],
    ]);
  });

  it('ignores "No newline at end of file" markers', () => {
    expect(parsed.hunks[1]?.lines.map((l) => l.kind)).toEqual(['context', 'del', 'add', 'context']);
  });

  it('handles a hunk header without counts and a new file', () => {
    const p = parsePatch('@@ -0,0 +1 @@\n+only line');
    expect([...p.commentableLines]).toEqual([1]);
  });

  it('returns nothing for an empty patch', () => {
    const p = parsePatch('');
    expect(p.hunks).toEqual([]);
    expect(p.commentableLines.size).toBe(0);
  });
});

describe('annotatePatch', () => {
  it('prints new-file numbers, leaving deleted lines unnumbered', () => {
    const out = annotatePatch(parsePatch(TWO_HUNK_PATCH)).split('\n');
    expect(out[0]).toBe('@@ -1,4 +1,5 @@');
    expect(out[1]).toBe("     1   import { db } from './db';");
    expect(out[2]).toBe('       - const LIMIT = 10;');
    expect(out[3]).toBe('     2 + const LIMIT = 100;');
    expect(out).toContain('    22 +   return db.query(`DELETE FROM t WHERE id = ${id}`);');
  });
});
