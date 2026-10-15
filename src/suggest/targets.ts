import type { PrFile, SkippedFile } from '../types.js';
import type { DetectedFrameworks, Framework, Language } from './detect.js';

/** A changed source file the model is asked to suggest tests for. */
export interface TestTarget {
  file: PrFile;
  language: Language;
  /** Unit-test framework for this file's language, if one was detected. */
  unit: Framework | undefined;
  /** Playwright is configured and the file looks like a UI route or component. */
  e2e: boolean;
}

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  ts: 'javascript',
  tsx: 'javascript',
  mts: 'javascript',
  cts: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'javascript',
  svelte: 'javascript',
  py: 'python',
  php: 'php',
};

const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|tests?|specs?|e2e|cypress)\//i;
const TEST_FILE = [/\.(?:test|spec)\.[cm]?[jt]sx?$/i, /(?:^|\/)test_[^/]+\.py$/, /_test\.py$/, /Test\.php$/];
/** Files in a supported language that are not worth unit tests: declarations, tool config, migrations, stories. */
const NOT_SOURCE = [
  /\.d\.[cm]?ts$/,
  /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/,
  /(?:^|\/)(?:conftest|setup|manage|__init__)\.py$/,
  /\.stories\.[jt]sx?$/,
  /(?:^|\/)migrations?\//,
];
const UI_EXTENSION = /\.(?:tsx|jsx|vue|svelte)$/;
const UI_DIRECTORY = /(?:^|\/)(?:pages|app|routes|views|components|layouts)\//;

export function languageOf(path: string): Language | undefined {
  const ext = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext === undefined ? undefined : LANGUAGE_BY_EXTENSION[ext];
}

export function isTestFile(path: string): boolean {
  return TEST_DIRECTORY.test(path) || TEST_FILE.some((re) => re.test(path));
}

export function isUiFile(path: string): boolean {
  return languageOf(path) === 'javascript' && (UI_EXTENSION.test(path) || UI_DIRECTORY.test(path));
}

/**
 * The name a source file and its tests share: `src/review/map.ts`, `test/map.test.ts`, `tests/test_map.py`
 * and `tests/MapTest.php` all give `map`. Used to decide whether a PR already changed a file's tests.
 */
export function testStem(path: string): string {
  let name = path.slice(path.lastIndexOf('/') + 1);
  name = name.replace(/\.[^.]+$/, ''); // extension
  name = name.replace(/\.(?:test|spec)$/i, '');
  name = name.replace(/^test_/, '').replace(/_test$/, '');
  name = name.replace(/Test$/, '');
  return name.toLowerCase().replace(/[-_.]/g, '');
}

export interface TargetSelection {
  targets: TestTarget[];
  skipped: SkippedFile[];
}

/**
 * Picks the reviewed source files that changed without a matching test change in the same PR.
 *
 * @param allFiles every file in the PR, including ones the review filters skipped (test changes count wherever
 *   they are)
 * @param reviewed the files that were sent to the model for review, in order
 */
export function selectTestTargets(
  allFiles: readonly PrFile[],
  reviewed: readonly PrFile[],
  detected: DetectedFrameworks,
): TargetSelection {
  const testedStems = new Set(
    allFiles.filter((f) => f.status !== 'removed' && isTestFile(f.filename)).map((f) => testStem(f.filename)),
  );
  const targets: TestTarget[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of reviewed) {
    const path = file.filename;
    const language = languageOf(path);
    // Not code, a test itself, or config: not a target, and not worth a line in the log either.
    if (!language || isTestFile(path) || NOT_SOURCE.some((re) => re.test(path))) continue;
    if (testedStems.has(testStem(path))) {
      skipped.push({ path, reason: 'tests changed in this PR' });
      continue;
    }
    const unit = detected.unit[language];
    const e2e = detected.playwright && isUiFile(path);
    if (!unit && !e2e) {
      skipped.push({ path, reason: `no ${language} test framework detected` });
      continue;
    }
    targets.push({ file, language, unit, e2e });
  }
  return { targets, skipped };
}
