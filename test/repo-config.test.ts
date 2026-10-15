import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { MAX_RULES, applyRepoConfig, parseRepoConfig } from '../src/repo-config.js';

const PATH = '.github/ai-review.yml';

describe('parseRepoConfig', () => {
  it('parses every supported key', () => {
    const { config, warnings } = parseRepoConfig(
      `
rules:
  - Money is integer cents; flag floats used for currency.
  - "Every new endpoint needs an authorization check."
min-severity: medium
include: ["src/**", "app/**"]
exclude:
  - "**/*.generated.ts"
max-files: 12
`,
      PATH,
    );
    expect(warnings).toEqual([]);
    expect(config).toEqual({
      rules: [
        'Money is integer cents; flag floats used for currency.',
        'Every new endpoint needs an authorization check.',
      ],
      minSeverity: 'medium',
      include: ['src/**', 'app/**'],
      exclude: ['**/*.generated.ts'],
      maxFiles: 12,
    });
  });

  it('treats an empty file as no settings', () => {
    expect(parseRepoConfig('# nothing yet\n', PATH)).toEqual({
      config: { rules: [], exclude: [] },
      warnings: [],
    });
  });

  it('warns about unknown keys instead of failing every review', () => {
    const { warnings } = parseRepoConfig('rulez: [x]\nmin-severity: low\n', PATH);
    expect(warnings).toEqual(['.github/ai-review.yml: unknown key "rulez" ignored.']);
  });

  it.each([
    ['invalid YAML', 'rules: [unclosed', /not valid YAML/],
    ['a list at the top level', '- a\n- b', /must be a YAML mapping/],
    ['rules that are not strings', 'rules: [1, 2]', /rules must be a list of strings/],
    ['a single string instead of a list', 'exclude: "docs/**"', /exclude must be a list of strings/],
    ['an unknown severity', 'min-severity: blocker', /min-severity must be one of/],
    ['a non-integer max-files', 'max-files: 2.5', /max-files must be a positive integer/],
    ['zero max-files', 'max-files: 0', /max-files must be a positive integer/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseRepoConfig(text, PATH)).toThrow(ConfigError);
    expect(() => parseRepoConfig(text, PATH)).toThrow(message);
  });

  it('bounds the number and length of rules, which go into every prompt', () => {
    const many = `rules:\n${Array.from({ length: MAX_RULES + 1 }, (_, i) => `  - rule ${String(i)}`).join('\n')}`;
    expect(() => parseRepoConfig(many, PATH)).toThrow(/at most 20 rules/);
    expect(() => parseRepoConfig(`rules:\n  - "${'x'.repeat(501)}"`, PATH)).toThrow(/at most 500 characters/);
  });
});

describe('applyRepoConfig', () => {
  const base = { include: ['**'], exclude: ['**/*.lock'], minSeverity: 'low' as const, maxFiles: 30 };

  it('returns the inputs unchanged when there is no file', () => {
    expect(applyRepoConfig(base, undefined)).toEqual({ ...base, rules: [] });
  });

  it('lets keys set in the file win, but only ever adds excludes', () => {
    const merged = applyRepoConfig(base, {
      rules: ['r'],
      include: ['src/**'],
      exclude: ['docs/**'],
      minSeverity: 'high',
      maxFiles: 5,
    });
    expect(merged).toEqual({
      include: ['src/**'],
      exclude: ['**/*.lock', 'docs/**'],
      minSeverity: 'high',
      maxFiles: 5,
      rules: ['r'],
    });
  });

  it('keeps input values for keys the file does not set', () => {
    expect(applyRepoConfig(base, { rules: [], exclude: [] })).toEqual({ ...base, rules: [] });
  });
});
