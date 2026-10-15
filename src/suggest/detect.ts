/**
 * Deterministic test-framework detection from files at the repository root. No model is involved: the
 * framework decides the schema the model is constrained to, so it must come from the repository, not a guess.
 */

export const FRAMEWORKS = ['vitest', 'jest', 'pytest', 'phpunit', 'playwright'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const LANGUAGES = ['javascript', 'python', 'php'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Unit-test frameworks per language, in order of preference when a repository has more than one. */
const UNIT_FRAMEWORKS: Record<Language, readonly Framework[]> = {
  javascript: ['vitest', 'jest'],
  python: ['pytest'],
  php: ['phpunit'],
};

/** Root files whose content detection reads. Everything else is decided by file name alone. */
export const MANIFESTS = ['package.json', 'pyproject.toml', 'setup.cfg', 'tox.ini', 'composer.json'] as const;
export type Manifest = (typeof MANIFESTS)[number];

export interface RepoSnapshot {
  /** Names of the files in the repository root. */
  rootFiles: readonly string[];
  /** Contents of the root manifests that exist. */
  manifests: Partial<Record<Manifest, string>>;
}

export interface DetectedFrameworks {
  /** The unit-test framework to use per language, if any. */
  unit: Partial<Record<Language, Framework>>;
  /** Playwright is configured, so E2E specs can be suggested for UI changes. */
  playwright: boolean;
  /** Why each framework was detected, for the job log. */
  evidence: Partial<Record<Framework, string>>;
  warnings: string[];
}

const JS_CONFIG = String.raw`\.(?:ts|mts|cts|js|mjs|cjs)`;
const CONFIG_FILES: Partial<Record<Framework, RegExp>> = {
  vitest: new RegExp(`^vitest\\.config${JS_CONFIG}$`),
  jest: new RegExp(`^jest\\.config(?:${JS_CONFIG}|\\.json)$`),
  playwright: new RegExp(`^playwright\\.config${JS_CONFIG}$`),
  pytest: /^(?:pytest\.ini|conftest\.py)$/,
  phpunit: /^phpunit(?:\.dist)?\.xml(?:\.dist)?$/,
};

export function detectFrameworks(repo: RepoSnapshot): DetectedFrameworks {
  const evidence: Partial<Record<Framework, string>> = {};
  const warnings: string[] = [];
  const found = (framework: Framework, why: string): void => {
    evidence[framework] ??= why;
  };

  // Config files are the strongest signal, so they are checked first and win the evidence slot.
  for (const name of [...repo.rootFiles].sort()) {
    for (const framework of FRAMEWORKS) {
      if (CONFIG_FILES[framework]?.test(name)) found(framework, name);
    }
  }

  const pkg = parseJson(repo.manifests['package.json'], 'package.json', warnings);
  if (pkg) {
    const deps = dependencyNames(pkg, ['dependencies', 'devDependencies']);
    if (deps.has('vitest')) found('vitest', 'package.json dependency "vitest"');
    if (deps.has('jest')) found('jest', 'package.json dependency "jest"');
    if ('jest' in pkg) found('jest', 'package.json "jest" key');
    if (deps.has('@playwright/test')) found('playwright', 'package.json dependency "@playwright/test"');
  }

  const pyproject = repo.manifests['pyproject.toml'];
  if (pyproject !== undefined) {
    if (/^\s*\[tool\.pytest[.\]]/m.test(pyproject)) found('pytest', 'pyproject.toml [tool.pytest]');
    else if (/["'\s]pytest\b/.test(pyproject)) found('pytest', 'pyproject.toml mentions pytest');
  }
  if (repo.manifests['setup.cfg'] !== undefined && /^\s*\[tool:pytest\]/m.test(repo.manifests['setup.cfg'])) {
    found('pytest', 'setup.cfg [tool:pytest]');
  }
  if (repo.manifests['tox.ini'] !== undefined && /^\s*\[pytest\]/m.test(repo.manifests['tox.ini'])) {
    found('pytest', 'tox.ini [pytest]');
  }

  const composer = parseJson(repo.manifests['composer.json'], 'composer.json', warnings);
  if (composer && dependencyNames(composer, ['require', 'require-dev']).has('phpunit/phpunit')) {
    found('phpunit', 'composer.json dependency "phpunit/phpunit"');
  }

  const unit: Partial<Record<Language, Framework>> = {};
  for (const language of LANGUAGES) {
    const framework = UNIT_FRAMEWORKS[language].find((f) => evidence[f] !== undefined);
    if (framework) unit[language] = framework;
  }
  return { unit, playwright: evidence.playwright !== undefined, evidence, warnings };
}

/** Frameworks the model may name, in a fixed order. This becomes the schema's `enum`. */
export function frameworksInUse(detected: DetectedFrameworks): Framework[] {
  const used = new Set<Framework>(Object.values(detected.unit));
  if (detected.playwright) used.add('playwright');
  return FRAMEWORKS.filter((f) => used.has(f));
}

function parseJson(
  text: string | undefined,
  name: string,
  warnings: string[],
): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Reported below.
  }
  warnings.push(`${name} is not a JSON object; ignored for test framework detection.`);
  return undefined;
}

function dependencyNames(manifest: Record<string, unknown>, keys: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const key of keys) {
    const section = manifest[key];
    if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
      for (const name of Object.keys(section)) names.add(name);
    }
  }
  return names;
}
