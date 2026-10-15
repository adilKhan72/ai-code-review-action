import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_EXCLUDE, readConfig } from '../src/config.js';

const reader =
  (values: Record<string, string>) =>
  (name: string): string =>
    values[name] ?? '';

const base = { 'api-key': 'sk-test', 'github-token': 'ghs_test' };

describe('readConfig', () => {
  it('applies defaults for an Anthropic setup', () => {
    const config = readConfig(reader(base));
    expect(config).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'medium',
      include: ['**'],
      exclude: DEFAULT_EXCLUDE,
      maxFiles: 30,
      maxDiffBytes: 200_000,
      maxFileBytes: 50_000,
      maxOutputTokens: 16_000,
      minSeverity: 'low',
      skipDraft: true,
      dryRun: false,
      baseUrl: undefined,
    });
  });

  it('requires a model for providers without a safe default', () => {
    expect(() => readConfig(reader({ ...base, provider: 'openai' }))).toThrow(/"model" is required/);
    expect(() => readConfig(reader({ ...base, provider: 'ollama' }))).toThrow(ConfigError);
  });

  it('does not require an API key for Ollama', () => {
    const config = readConfig(
      reader({
        'github-token': 'ghs',
        provider: 'ollama',
        model: 'qwen3-coder',
        'base-url': 'http://gpu:11434',
      }),
    );
    expect(config.apiKey).toBeUndefined();
    expect(config.baseUrl).toBe('http://gpu:11434');
  });

  it('requires an API key for hosted providers', () => {
    expect(() => readConfig(reader({ 'github-token': 'ghs' }))).toThrow(/"api-key" is required/);
  });

  it('normalises enum inputs and rejects unknown values', () => {
    expect(readConfig(reader({ ...base, provider: ' Anthropic ', 'min-severity': 'HIGH' }))).toMatchObject({
      provider: 'anthropic',
      minSeverity: 'high',
    });
    expect(() => readConfig(reader({ ...base, provider: 'gemini' }))).toThrow(
      /one of anthropic, openai, ollama/,
    );
    expect(() => readConfig(reader({ ...base, effort: 'extreme' }))).toThrow(/"effort"/);
  });

  it.each(['0', '-1', '1.5', 'ten', '99999999999999999999'])('rejects max-files=%s', (value) => {
    expect(() => readConfig(reader({ ...base, 'max-files': value }))).toThrow(/positive integer/);
  });

  it('parses booleans strictly', () => {
    expect(readConfig(reader({ ...base, 'skip-draft': 'false', 'dry-run': 'TRUE' }))).toMatchObject({
      skipDraft: false,
      dryRun: true,
    });
    expect(() => readConfig(reader({ ...base, 'dry-run': 'yes' }))).toThrow(/"true" or "false"/);
  });

  it('adds user excludes to the defaults, skipping blanks and comments', () => {
    const config = readConfig(
      reader({ ...base, exclude: '# generated\ndocs/**\n\n  *.pb.go , fixtures/**' }),
    );
    expect(config.exclude).toEqual([...DEFAULT_EXCLUDE, 'docs/**', '*.pb.go', 'fixtures/**']);
  });

  it('can drop the default excludes', () => {
    const config = readConfig(reader({ ...base, exclude: 'docs/**', 'no-default-excludes': 'true' }));
    expect(config.exclude).toEqual(['docs/**']);
  });

  it('fails clearly when the GitHub token is empty', () => {
    expect(() => readConfig(reader({ 'api-key': 'k' }))).toThrow(/github-token/);
  });

  it('reads the test-suggestion inputs: off by default, capped at 10', () => {
    expect(readConfig(reader(base))).toMatchObject({ suggestTests: false, maxTestSuggestions: 5 });
    expect(
      readConfig(reader({ ...base, 'suggest-tests': 'true', 'max-test-suggestions': '10' })),
    ).toMatchObject({ suggestTests: true, maxTestSuggestions: 10 });
    expect(() => readConfig(reader({ ...base, 'max-test-suggestions': '11' }))).toThrow(/at most 10/);
    expect(() => readConfig(reader({ ...base, 'suggest-tests': 'yes' }))).toThrow(ConfigError);
  });
});
