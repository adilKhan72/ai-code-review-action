import { describe, expect, it } from 'vitest';
import type { DetectedFrameworks } from '../src/suggest/detect.js';
import { isTestFile, isUiFile, languageOf, selectTestTargets, testStem } from '../src/suggest/targets.js';
import { file } from './fixtures.js';

const PATCH = '@@ -0,0 +1,1 @@\n+x';
const detected = (overrides: Partial<DetectedFrameworks> = {}): DetectedFrameworks => ({
  unit: { javascript: 'vitest' },
  playwright: false,
  evidence: {},
  warnings: [],
  ...overrides,
});

describe('test file heuristics', () => {
  it.each([
    'test/map.test.ts',
    'src/map.spec.tsx',
    'src/__tests__/map.ts',
    'tests/test_map.py',
    'pkg/map_test.py',
    'tests/Unit/MapTest.php',
    'e2e/login.spec.ts',
  ])('%s is a test file', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each(['src/map.ts', 'src/testing.ts', 'app/Http/Controller.php', 'src/latest.py'])(
    '%s is not a test file',
    (path) => {
      expect(isTestFile(path)).toBe(false);
    },
  );

  it.each([
    ['src/review/map.ts', 'map'],
    ['test/map.test.ts', 'map'],
    ['src/__tests__/map.spec.tsx', 'map'],
    ['tests/test_map.py', 'map'],
    ['pkg/map_test.py', 'map'],
    ['tests/Unit/MapTest.php', 'map'],
    ['app/Map.php', 'map'],
    ['src/repo-config.ts', 'repoconfig'],
    ['test/repo-config.test.ts', 'repoconfig'],
  ])('stem of %s is %s', (path, stem) => {
    expect(testStem(path)).toBe(stem);
  });

  it('classifies languages and UI files', () => {
    expect(languageOf('a/b.tsx')).toBe('javascript');
    expect(languageOf('a/b.py')).toBe('python');
    expect(languageOf('a/b.php')).toBe('php');
    expect(languageOf('README.md')).toBeUndefined();
    expect(isUiFile('src/components/Button.tsx')).toBe(true);
    expect(isUiFile('src/routes/login.ts')).toBe(true);
    expect(isUiFile('src/Page.vue')).toBe(true);
    expect(isUiFile('src/lib/math.ts')).toBe(false);
    expect(isUiFile('app/views/home.py')).toBe(false); // Playwright specs are only suggested for JS UI code
  });
});

describe('selectTestTargets', () => {
  it('targets changed source files without matching test changes', () => {
    const files = [
      file('src/a.ts', PATCH),
      file('src/b.ts', PATCH),
      file('test/b.test.ts', PATCH),
      file('README.md', PATCH),
      file('vite.config.ts', PATCH),
      file('src/types.d.ts', PATCH),
    ];
    const { targets, skipped } = selectTestTargets(files, files, detected());
    expect(targets.map((t) => t.file.filename)).toEqual(['src/a.ts']);
    expect(targets[0]).toMatchObject({ language: 'javascript', unit: 'vitest', e2e: false });
    expect(skipped).toEqual([{ path: 'src/b.ts', reason: 'tests changed in this PR' }]);
  });

  it('counts test changes the review itself skipped, but not deleted tests', () => {
    const reviewed = [file('src/a.ts', PATCH), file('src/b.ts', PATCH)];
    const all = [...reviewed, file('test/a.test.ts', PATCH), file('test/b.test.ts', undefined, 'removed')];
    const { targets } = selectTestTargets(all, reviewed, detected());
    expect(targets.map((t) => t.file.filename)).toEqual(['src/b.ts']);
  });

  it('skips languages without a detected framework and says why', () => {
    const files = [file('svc/api.py', PATCH), file('src/a.ts', PATCH)];
    const { targets, skipped } = selectTestTargets(files, files, detected());
    expect(targets.map((t) => t.file.filename)).toEqual(['src/a.ts']);
    expect(skipped).toEqual([{ path: 'svc/api.py', reason: 'no python test framework detected' }]);
  });

  it('offers Playwright for UI files, even without a JavaScript unit framework', () => {
    const files = [file('src/components/Login.tsx', PATCH), file('src/lib/math.ts', PATCH)];
    const { targets } = selectTestTargets(files, files, detected({ unit: {}, playwright: true }));
    expect(targets).toEqual([expect.objectContaining({ unit: undefined, e2e: true })]);
    expect(targets[0]?.file.filename).toBe('src/components/Login.tsx');
  });

  it('offers both kinds for a UI file when both are configured', () => {
    const files = [file('app/routes/checkout.tsx', PATCH)];
    const { targets } = selectTestTargets(files, files, detected({ playwright: true }));
    expect(targets[0]).toMatchObject({ unit: 'vitest', e2e: true });
  });
});
