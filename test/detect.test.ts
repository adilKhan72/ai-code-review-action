import { describe, expect, it } from 'vitest';
import { detectFrameworks, frameworksInUse, type RepoSnapshot } from '../src/suggest/detect.js';

const repo = (rootFiles: string[], manifests: RepoSnapshot['manifests'] = {}): RepoSnapshot => ({
  rootFiles,
  manifests,
});

describe('detectFrameworks', () => {
  it('finds nothing in an empty repository', () => {
    const detected = detectFrameworks(repo([]));
    expect(detected).toMatchObject({ unit: {}, playwright: false, warnings: [] });
    expect(frameworksInUse(detected)).toEqual([]);
  });

  it.each([
    ['vitest.config.ts', 'vitest'],
    ['vitest.config.mjs', 'vitest'],
    ['jest.config.js', 'jest'],
    ['jest.config.json', 'jest'],
  ])('detects a JavaScript unit framework from %s', (name, framework) => {
    expect(detectFrameworks(repo([name])).unit.javascript).toBe(framework);
  });

  it('detects JavaScript frameworks from package.json dependencies and the "jest" key', () => {
    const vitest = JSON.stringify({ devDependencies: { vitest: '^5.0.0' } });
    expect(detectFrameworks(repo(['package.json'], { 'package.json': vitest })).unit.javascript).toBe(
      'vitest',
    );

    const jestKey = JSON.stringify({ jest: { testEnvironment: 'node' } });
    const detected = detectFrameworks(repo(['package.json'], { 'package.json': jestKey }));
    expect(detected.unit.javascript).toBe('jest');
    expect(detected.evidence.jest).toBe('package.json "jest" key');
  });

  it('prefers vitest when both vitest and jest are present, and records the config file as evidence', () => {
    const pkg = JSON.stringify({ devDependencies: { jest: '30', vitest: '5' } });
    const detected = detectFrameworks(repo(['package.json', 'vitest.config.ts'], { 'package.json': pkg }));
    expect(detected.unit.javascript).toBe('vitest');
    expect(detected.evidence.vitest).toBe('vitest.config.ts');
  });

  it('detects Playwright from its config file or dependency', () => {
    expect(detectFrameworks(repo(['playwright.config.ts'])).playwright).toBe(true);
    const pkg = JSON.stringify({ devDependencies: { '@playwright/test': '1.56.0' } });
    const detected = detectFrameworks(repo(['package.json'], { 'package.json': pkg }));
    expect(detected).toMatchObject({ playwright: true, unit: {} });
    expect(frameworksInUse(detected)).toEqual(['playwright']);
  });

  it.each<[string, RepoSnapshot]>([
    ['pytest.ini', repo(['pytest.ini'])],
    ['conftest.py', repo(['conftest.py'])],
    [
      'pyproject [tool.pytest.ini_options]',
      repo(['pyproject.toml'], { 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' }),
    ],
    [
      'pyproject dependency',
      repo(['pyproject.toml'], {
        'pyproject.toml': '[project.optional-dependencies]\ndev = ["pytest>=8"]\n',
      }),
    ],
    [
      'setup.cfg',
      repo(['setup.cfg'], { 'setup.cfg': '[metadata]\nname = x\n\n[tool:pytest]\ntestpaths = tests\n' }),
    ],
    ['tox.ini', repo(['tox.ini'], { 'tox.ini': '[pytest]\nminversion = 8.0\n' })],
  ])('detects pytest from %s', (_, snapshot) => {
    expect(detectFrameworks(snapshot).unit.python).toBe('pytest');
  });

  it('does not detect pytest from an unrelated pyproject or setup.cfg', () => {
    const detected = detectFrameworks(
      repo(['pyproject.toml', 'setup.cfg'], {
        'pyproject.toml': '[project]\nname = "x"\ndependencies = ["httpx"]\n',
        'setup.cfg': '[flake8]\nmax-line-length = 100\n',
      }),
    );
    expect(detected.unit.python).toBeUndefined();
  });

  it('detects PHPUnit from phpunit.xml(.dist) or composer.json', () => {
    expect(detectFrameworks(repo(['phpunit.xml.dist'])).unit.php).toBe('phpunit');
    expect(detectFrameworks(repo(['phpunit.xml'])).unit.php).toBe('phpunit');
    const composer = JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '^11' } });
    expect(detectFrameworks(repo(['composer.json'], { 'composer.json': composer })).unit.php).toBe('phpunit');
  });

  it('handles a polyglot repository and lists frameworks in a fixed order', () => {
    const detected = detectFrameworks(
      repo(['pytest.ini', 'playwright.config.ts', 'jest.config.js', 'phpunit.xml']),
    );
    expect(detected.unit).toEqual({ javascript: 'jest', python: 'pytest', php: 'phpunit' });
    expect(frameworksInUse(detected)).toEqual(['jest', 'pytest', 'phpunit', 'playwright']);
  });

  it('warns about a malformed manifest instead of failing', () => {
    const detected = detectFrameworks(
      repo(['package.json', 'composer.json'], { 'package.json': '{', 'composer.json': '[]' }),
    );
    expect(detected.unit).toEqual({});
    expect(detected.warnings).toHaveLength(2);
  });

  it('ignores lookalike file names', () => {
    expect(
      detectFrameworks(repo(['vitest.config.ts.bak', 'my-jest.config.js', 'playwright.md'])).unit,
    ).toEqual({});
  });
});
