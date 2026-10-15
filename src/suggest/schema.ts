import { createHash } from 'node:crypto';
import { InvalidOutputError } from '../findings.js';
import type { Framework } from './detect.js';
import { isTestFile, type TestTarget } from './targets.js';

export const TEST_KINDS = ['unit', 'e2e'] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export interface TestSuggestion {
  target: string;
  kind: TestKind;
  framework: Framework;
  testPath: string;
  title: string;
  rationale: string;
  code: string;
  /** Stable identity across runs, for de-duplication. */
  fingerprint: string;
}

/** Hard limits on what the model may return. Code over the limit is dropped, never truncated: half a test file
 * is worse than none. */
export const LIMITS = {
  title: 120,
  rationale: 600,
  code: 6_000,
  testPath: 200,
} as const;

/**
 * The schema the provider is constrained to. Like the findings schema it is the strict common subset (all
 * properties required, no additional properties, no numeric or length bounds). `framework` is limited to the
 * frameworks detected in the repository, so the model cannot pick one the project does not use.
 */
export function suggestionSchema(frameworks: readonly Framework[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Path of the changed source file this test covers.' },
            kind: { type: 'string', enum: [...TEST_KINDS] },
            framework: { type: 'string', enum: [...frameworks] },
            testPath: {
              type: 'string',
              description: 'Where the test file would go, relative to the repo root.',
            },
            title: { type: 'string', description: 'What the test checks, under 100 characters.' },
            rationale: {
              type: 'string',
              description: 'Which change or risk this test covers, in one or two sentences.',
            },
            code: { type: 'string', description: 'The complete test file.' },
          },
          required: ['target', 'kind', 'framework', 'testPath', 'title', 'rationale', 'code'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  };
}

export interface ParsedSuggestions {
  suggestions: TestSuggestion[];
  /** Malformed, out of scope, wrong framework, or over the size limit. */
  dropped: number;
  /** Same target and title, or the same code, as an earlier suggestion in this answer. */
  duplicates: number;
  /** Valid but over the count cap. */
  overCap: number;
}

/**
 * Validates the model's answer after the provider's schema enforcement. Each suggestion must name a target that
 * was in the request, a kind and framework that fit that target, and a relative test path that looks like a test.
 * Malformed items are dropped; a malformed envelope throws.
 */
export function parseSuggestions(
  raw: unknown,
  targets: ReadonlyMap<string, TestTarget>,
  maxSuggestions: number,
): ParsedSuggestions {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { suggestions?: unknown }).suggestions)
  ) {
    throw new InvalidOutputError('Model output is not an object with a "suggestions" array.');
  }
  const items = (raw as { suggestions: unknown[] }).suggestions;
  const result: ParsedSuggestions = { suggestions: [], dropped: 0, duplicates: 0, overCap: 0 };
  const seenTitles = new Set<string>();
  const seenCode = new Set<string>();

  for (const item of items) {
    const suggestion = toSuggestion(item, targets);
    if (!suggestion) {
      result.dropped++;
      continue;
    }
    const codeKey = suggestion.code.replace(/\s+/g, ' ').trim();
    if (seenTitles.has(suggestion.fingerprint) || seenCode.has(codeKey)) {
      result.duplicates++;
      continue;
    }
    seenTitles.add(suggestion.fingerprint);
    seenCode.add(codeKey);
    if (result.suggestions.length >= maxSuggestions) {
      result.overCap++;
      continue;
    }
    result.suggestions.push(suggestion);
  }
  return result;
}

function toSuggestion(item: unknown, targets: ReadonlyMap<string, TestTarget>): TestSuggestion | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const raw = item as Record<string, unknown>;
  const fields = ['target', 'kind', 'framework', 'testPath', 'title', 'rationale', 'code'] as const;
  const values: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    const value = raw[field];
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    values[field] = field === 'code' ? value.replace(/\s+$/, '') : value.trim();
  }
  const { kind, framework, rationale = '', code = '' } = values;
  const target = (values.target ?? '').replace(/^\.\//, '');
  const testPath = (values.testPath ?? '').replace(/^\.\//, '');
  const title = (values.title ?? '').replace(/\s+/g, ' ');

  const spec = targets.get(target);
  if (!spec) return undefined; // the model never saw that file
  if (kind === 'unit') {
    if (spec.unit === undefined || framework !== spec.unit) return undefined;
  } else if (kind === 'e2e') {
    if (!spec.e2e || framework !== 'playwright') return undefined;
  } else {
    return undefined;
  }
  if (!isSafeTestPath(testPath)) return undefined;
  if (code.length > LIMITS.code) return undefined;

  return {
    target,
    kind,
    framework,
    testPath,
    title: truncate(title, LIMITS.title),
    rationale: truncate(rationale, LIMITS.rationale),
    code,
    fingerprint: suggestionFingerprint(target, kind, title),
  };
}

/** A relative path inside the repository that looks like a test file. It is only displayed, never written. */
export function isSafeTestPath(path: string): boolean {
  return (
    path.length <= LIMITS.testPath &&
    /^[\w@+()[\]. -]+(?:\/[\w@+()[\]. -]+)*$/.test(path) &&
    !path.split('/').some((segment) => segment === '..' || segment === '.') &&
    isTestFile(path)
  );
}

export function suggestionFingerprint(target: string, kind: TestKind, title: string): string {
  const normalised = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return hash(`test-suggestion\n${target}\n${kind}\n${normalised}`);
}

/**
 * Identity of "tests were suggested for this exact version of this file". If a later run sees the same patch for
 * the same path, the model is not asked again.
 */
export function targetFingerprint(path: string, patch: string): string {
  return hash(`test-target\n${path}\n${patch}`);
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
