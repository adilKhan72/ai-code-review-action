import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDE } from '../src/config.js';
import { selectFiles } from '../src/filter.js';
import { file, patchOfSize } from './fixtures.js';

const options = { include: ['**'], exclude: DEFAULT_EXCLUDE, maxFiles: 30, maxFileBytes: 1_000 };
const p = '@@ -1 +1 @@\n-a\n+b';

describe('selectFiles', () => {
  it('skips lockfiles, generated output, deleted and binary files with a reason', () => {
    const { selected, skipped } = selectFiles(
      [
        file('src/app.ts', p),
        file('package-lock.json', p),
        file('web/dist/bundle.js', p),
        file('old.ts', p, 'removed'),
        file('logo.png', undefined, 'added'),
        file('.github/workflows/ci.yml', p),
      ],
      options,
    );
    expect(selected.map((f) => f.filename)).toEqual(['src/app.ts', '.github/workflows/ci.yml']);
    expect(skipped).toEqual([
      { path: 'package-lock.json', reason: 'matched by exclude' },
      { path: 'web/dist/bundle.js', reason: 'matched by exclude' },
      { path: 'old.ts', reason: 'file deleted' },
      { path: 'logo.png', reason: expect.stringContaining('no patch') as unknown },
    ]);
  });

  it('applies include globs', () => {
    const { selected, skipped } = selectFiles([file('src/a.ts', p), file('docs/a.md', p)], {
      ...options,
      include: ['src/**'],
    });
    expect(selected.map((f) => f.filename)).toEqual(['src/a.ts']);
    expect(skipped[0]?.reason).toBe('not matched by include');
  });

  it('skips files over max-file-bytes, measured in UTF-8 bytes', () => {
    const multiByte = '@@ -0,0 +1 @@\n+' + 'é'.repeat(600); // 600 chars, ~1200 bytes
    const { selected, skipped } = selectFiles(
      [file('a.ts', patchOfSize(900)), file('b.ts', multiByte)],
      options,
    );
    expect(selected.map((f) => f.filename)).toEqual(['a.ts']);
    expect(skipped[0]?.reason).toMatch(/over max-file-bytes \(1000\)/);
  });

  it('stops at max-files and lists the rest', () => {
    const files = ['a', 'b', 'c', 'd'].map((n) => file(`${n}.ts`, p));
    const { selected, skipped } = selectFiles(files, { ...options, maxFiles: 2 });
    expect(selected).toHaveLength(2);
    expect(skipped.map((s) => s.reason)).toEqual(['over max-files (2)', 'over max-files (2)']);
  });

  it('does not count skipped files towards max-files', () => {
    const files = [file('yarn.lock', p), file('a.ts', p), file('b.ts', p)];
    expect(selectFiles(files, { ...options, maxFiles: 2 }).selected).toHaveLength(2);
  });
});
