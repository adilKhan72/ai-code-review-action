import { parse } from 'yaml';
import { ConfigError, SEVERITIES, type Severity } from './config.js';

/**
 * Repository-level settings from `.github/ai-review.yml`. The action reads this file from the PR's **base**
 * commit, so a pull request cannot change the rules it is reviewed under (ADR-0003).
 */
export interface RepoConfig {
  rules: string[];
  minSeverity?: Severity;
  include?: string[];
  exclude: string[];
  maxFiles?: number;
}

export const MAX_RULES = 20;
export const MAX_RULE_LENGTH = 500;

const KNOWN_KEYS = new Set(['rules', 'min-severity', 'include', 'exclude', 'max-files']);

export function parseRepoConfig(text: string, path: string): { config: RepoConfig; warnings: string[] } {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ConfigError(`${path} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const warnings: string[] = [];
  if (doc === null || doc === undefined) return { config: { rules: [], exclude: [] }, warnings };
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new ConfigError(`${path} must be a YAML mapping.`);

  const raw = doc as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    // A warning, not an error: a typo should not stop every review in the repository.
    if (!KNOWN_KEYS.has(key)) warnings.push(`${path}: unknown key "${key}" ignored.`);
  }

  const rules = stringList(raw['rules'], 'rules', path) ?? [];
  if (rules.length > MAX_RULES)
    throw new ConfigError(`${path}: at most ${String(MAX_RULES)} rules are allowed.`);
  for (const rule of rules) {
    if (rule.length > MAX_RULE_LENGTH) {
      throw new ConfigError(`${path}: each rule must be at most ${String(MAX_RULE_LENGTH)} characters.`);
    }
  }

  const config: RepoConfig = { rules, exclude: stringList(raw['exclude'], 'exclude', path) ?? [] };
  const include = stringList(raw['include'], 'include', path);
  if (include) config.include = include;

  const severity = raw['min-severity'];
  if (severity !== undefined) {
    if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) {
      throw new ConfigError(`${path}: min-severity must be one of ${SEVERITIES.join(', ')}.`);
    }
    config.minSeverity = severity as Severity;
  }

  const maxFiles = raw['max-files'];
  if (maxFiles !== undefined) {
    if (typeof maxFiles !== 'number' || !Number.isSafeInteger(maxFiles) || maxFiles < 1) {
      throw new ConfigError(`${path}: max-files must be a positive integer.`);
    }
    config.maxFiles = maxFiles;
  }
  return { config, warnings };
}

function stringList(value: unknown, key: string, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ConfigError(`${path}: ${key} must be a list of strings.`);
  }
  return value.map((v) => v.trim()).filter((v) => v !== '');
}

export interface EffectiveSettings {
  include: string[];
  exclude: string[];
  minSeverity: Severity;
  maxFiles: number;
  rules: string[];
}

/**
 * Merges the repo file over the action inputs. A key set in the file wins, except `exclude`, which is
 * additive like the input. Excludes only ever narrow what is sent to the model.
 */
export function applyRepoConfig(
  base: Omit<EffectiveSettings, 'rules'>,
  repo: RepoConfig | undefined,
): EffectiveSettings {
  if (!repo) return { ...base, rules: [] };
  return {
    include: repo.include ?? base.include,
    exclude: [...base.exclude, ...repo.exclude],
    minSeverity: repo.minSeverity ?? base.minSeverity,
    maxFiles: repo.maxFiles ?? base.maxFiles,
    rules: repo.rules,
  };
}
