import { describe, expect, it } from 'vitest';
import { InvalidOutputError } from '../src/findings.js';
import {
  LIMITS,
  isSafeTestPath,
  parseSuggestions,
  suggestionFingerprint,
  suggestionSchema,
  targetFingerprint,
} from '../src/suggest/schema.js';
import type { TestTarget } from '../src/suggest/targets.js';
import { file } from './fixtures.js';

const targets = new Map<string, TestTarget>([
  ['src/a.ts', { file: file('src/a.ts', 'p'), language: 'javascript', unit: 'vitest', e2e: false }],
  ['src/Login.tsx', { file: file('src/Login.tsx', 'p'), language: 'javascript', unit: undefined, e2e: true }],
]);

const item = (overrides: Record<string, unknown> = {}) => ({
  target: 'src/a.ts',
  kind: 'unit',
  framework: 'vitest',
  testPath: 'test/a.test.ts',
  title: 'rejects negative amounts',
  rationale: 'The new guard is untested.',
  code: "import { it } from 'vitest';\nit('works', () => {});\n",
  ...overrides,
});

describe('suggestionSchema', () => {
  it('is strict and limits frameworks to the detected ones', () => {
    const schema = suggestionSchema(['vitest', 'playwright']) as {
      additionalProperties: boolean;
      properties: {
        suggestions: {
          items: {
            required: string[];
            additionalProperties: boolean;
            properties: { framework: { enum: string[] } };
          };
        };
      };
    };
    const items = schema.properties.suggestions.items;
    expect(schema.additionalProperties).toBe(false);
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(['target', 'kind', 'framework', 'testPath', 'title', 'rationale', 'code']);
    expect(items.properties.framework.enum).toEqual(['vitest', 'playwright']);
  });
});

describe('parseSuggestions', () => {
  it('accepts valid unit and e2e suggestions', () => {
    const e2e = item({
      target: 'src/Login.tsx',
      kind: 'e2e',
      framework: 'playwright',
      testPath: 'e2e/login.spec.ts',
      title: 'shows an error for a wrong password',
      code: "import { test } from '@playwright/test';",
    });
    const result = parseSuggestions({ suggestions: [item(), e2e] }, targets, 5);
    expect(result).toMatchObject({ dropped: 0, duplicates: 0, overCap: 0 });
    expect(result.suggestions.map((s) => `${s.kind}:${s.framework}:${s.target}`)).toEqual([
      'unit:vitest:src/a.ts',
      'e2e:playwright:src/Login.tsx',
    ]);
    expect(result.suggestions[0]?.code.endsWith('\n')).toBe(false); // trailing whitespace trimmed
    expect(result.suggestions[0]?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('throws on a malformed envelope', () => {
    expect(() => parseSuggestions({ findings: [] }, targets, 5)).toThrow(InvalidOutputError);
    expect(() => parseSuggestions(null, targets, 5)).toThrow(InvalidOutputError);
  });

  it.each([
    ['an unknown target', { target: 'src/other.ts' }],
    ['a framework the target cannot use', { framework: 'jest' }],
    ['e2e for a non-UI target', { kind: 'e2e', framework: 'playwright', testPath: 'e2e/a.spec.ts' }],
    ['unit for a target without a unit framework', { target: 'src/Login.tsx' }],
    ['an unknown kind', { kind: 'integration' }],
    ['a path outside the repo', { testPath: '../evil.test.ts' }],
    ['an absolute path', { testPath: '/etc/a.test.ts' }],
    ['a path that is not a test', { testPath: 'src/a.ts' }],
    ['empty code', { code: '   ' }],
    ['a missing field', { title: undefined }],
    ['a non-string field', { code: 42 }],
    ['oversized code', { code: 'x'.repeat(LIMITS.code + 1) }],
  ])('drops a suggestion with %s', (_, overrides) => {
    const result = parseSuggestions({ suggestions: [item(overrides), 'junk'] }, targets, 5);
    expect(result).toMatchObject({ suggestions: [], dropped: 2 });
  });

  it('removes duplicates by target, kind and normalised title, and by identical code', () => {
    const result = parseSuggestions(
      {
        suggestions: [
          item(),
          item({ title: 'Rejects  NEGATIVE amounts!', code: 'other code' }),
          item({ title: 'something else' }), // same code as the first
          item({ title: 'third', code: 'third code' }),
        ],
      },
      targets,
      5,
    );
    expect(result.suggestions.map((s) => s.title)).toEqual(['rejects negative amounts', 'third']);
    expect(result.duplicates).toBe(2);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 4 }, (_, i) => item({ title: `t${String(i)}`, code: `c${String(i)}` }));
    const result = parseSuggestions({ suggestions: many }, targets, 2);
    expect(result.suggestions).toHaveLength(2);
    expect(result.overCap).toBe(2);
  });

  it('truncates long titles and rationales but normalises paths', () => {
    const result = parseSuggestions(
      { suggestions: [item({ target: './src/a.ts', title: 'x'.repeat(300), rationale: 'y'.repeat(2_000) })] },
      targets,
      5,
    );
    const [s] = result.suggestions;
    expect(s?.target).toBe('src/a.ts');
    expect(s?.title).toHaveLength(LIMITS.title);
    expect(s?.rationale).toHaveLength(LIMITS.rationale);
  });
});

describe('fingerprints and paths', () => {
  it('suggestion fingerprints ignore case and punctuation in the title', () => {
    expect(suggestionFingerprint('a.ts', 'unit', 'Handles null!')).toBe(
      suggestionFingerprint('a.ts', 'unit', 'handles  NULL'),
    );
    expect(suggestionFingerprint('a.ts', 'unit', 'x')).not.toBe(suggestionFingerprint('a.ts', 'e2e', 'x'));
  });

  it('target fingerprints change when the patch changes', () => {
    expect(targetFingerprint('a.ts', 'p1')).toBe(targetFingerprint('a.ts', 'p1'));
    expect(targetFingerprint('a.ts', 'p1')).not.toBe(targetFingerprint('a.ts', 'p2'));
  });

  it.each([
    ['tests/Unit/MoneyTest.php', true],
    ['tests/test_money.py', true],
    ['src/__tests__/money.test.ts', true],
    ['tests/./a.test.ts', false],
    ['tests\\a.test.ts', false],
    ['tests/a.test.ts\n', false],
    [`tests/${'a'.repeat(250)}.test.ts`, false],
  ])('isSafeTestPath(%j) is %s', (path, expected) => {
    expect(isSafeTestPath(path)).toBe(expected);
  });
});
