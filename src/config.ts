export const PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface Config {
  provider: ProviderName;
  model: string;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  /** Anthropic only. Set explicitly because the default differs between models. */
  effort: Effort;
  githubToken: string;
  include: string[];
  exclude: string[];
  maxFiles: number;
  maxDiffBytes: number;
  maxFileBytes: number;
  maxOutputTokens: number;
  minSeverity: Severity;
  skipDraft: boolean;
  dryRun: boolean;
}

/**
 * Only Anthropic gets a default model. OpenAI and Ollama model names change often and Ollama depends on what the
 * user has pulled, so a guessed default would fail in a confusing way. Asking for it explicitly is clearer.
 */
export const DEFAULT_MODELS: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-opus-5-5',
};

export const DEFAULT_INCLUDE = ['**'];

/** Files that are large, generated or not reviewable. Reviewing them costs money and produces noise. */
export const DEFAULT_EXCLUDE = [
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/composer.lock',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/go.sum',
  '**/*.lock',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/*.svg',
  '**/dist/**',
  '**/build/**',
  '**/vendor/**',
  '**/node_modules/**',
];

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Reads one action input; returns '' when unset (the same contract as `core.getInput`). */
export type InputReader = (name: string) => string;

export function readConfig(input: InputReader): Config {
  const provider = oneOf('provider', input('provider') || 'anthropic', PROVIDERS);
  const model = input('model') || DEFAULT_MODELS[provider];
  if (!model) {
    throw new ConfigError(`Input "model" is required when provider is "${provider}".`);
  }

  const apiKey = input('api-key') || undefined;
  if (provider !== 'ollama' && !apiKey) {
    throw new ConfigError(`Input "api-key" is required when provider is "${provider}".`);
  }

  const githubToken = input('github-token');
  if (!githubToken) {
    throw new ConfigError('Input "github-token" is empty. The default is `${{ github.token }}`.');
  }

  const include = lines(input('include'));
  const exclude = lines(input('exclude'));

  return {
    provider,
    model,
    apiKey,
    baseUrl: input('base-url') || undefined,
    effort: oneOf('effort', input('effort') || 'medium', EFFORTS),
    githubToken,
    include: include.length > 0 ? include : DEFAULT_INCLUDE,
    // User excludes are added to the defaults; `no-default-excludes` exists for the rare repo that needs them.
    exclude: bool('no-default-excludes', input('no-default-excludes'), false)
      ? exclude
      : [...DEFAULT_EXCLUDE, ...exclude],
    maxFiles: positiveInt('max-files', input('max-files'), 30),
    maxDiffBytes: positiveInt('max-diff-bytes', input('max-diff-bytes'), 200_000),
    maxFileBytes: positiveInt('max-file-bytes', input('max-file-bytes'), 50_000),
    maxOutputTokens: positiveInt('max-output-tokens', input('max-output-tokens'), 16_000),
    minSeverity: oneOf('min-severity', input('min-severity') || 'low', SEVERITIES),
    skipDraft: bool('skip-draft', input('skip-draft'), true),
    dryRun: bool('dry-run', input('dry-run'), false),
  };
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  const normalised = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(normalised)) {
    return normalised as T;
  }
  throw new ConfigError(`Input "${name}" must be one of ${allowed.join(', ')}; got "${value}".`);
}

function positiveInt(name: string, raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`Input "${name}" must be a positive integer; got "${raw}".`);
  }
  const n = Number(raw.trim());
  if (n <= 0 || !Number.isSafeInteger(n)) {
    throw new ConfigError(`Input "${name}" must be a positive integer; got "${raw}".`);
  }
  return n;
}

function bool(name: string, raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === '') return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`Input "${name}" must be "true" or "false"; got "${raw}".`);
}

function lines(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'));
}
