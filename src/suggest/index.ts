import { InvalidOutputError } from '../findings.js';
import type { GitHubApi } from '../github.js';
import { ProviderError, type Provider } from '../providers/types.js';
import type { PrFile, TokenUsage } from '../types.js';
import { MANIFESTS, detectFrameworks, frameworksInUse, type Manifest, type RepoSnapshot } from './detect.js';
import { buildSuggestPrompt } from './prompt.js';
import { parseSuggestions, suggestionSchema, targetFingerprint, type TestSuggestion } from './schema.js';
import { selectTestTargets, type TestTarget } from './targets.js';

/** Per-run patch budget for the suggestion request, further limited by what is left of max-diff-bytes. */
export const MAX_SUGGEST_BYTES = 40_000;
/** At most this many files go into the suggestion request. */
export const MAX_TEST_TARGETS = 10;

export interface SuggestDeps {
  github: GitHubApi;
  provider: Provider;
  log: { info(message: string): void; warning(message: string): void };
  nonce?: string | undefined;
}

export interface SuggestInput {
  title: string;
  baseSha: string;
  allFiles: readonly PrFile[];
  reviewed: readonly PrFile[];
  /** Fingerprints from this reviewer's earlier comments. */
  earlier: ReadonlySet<string>;
  /** Patch bytes still allowed under max-diff-bytes. */
  budgetBytes: number;
  maxSuggestions: number;
  maxOutputTokens: number;
}

export interface SuggestOutcome {
  suggestions: TestSuggestion[];
  targetFingerprints: string[];
  failure?: string | undefined;
  usage: TokenUsage;
}

const EMPTY: SuggestOutcome = {
  suggestions: [],
  targetFingerprints: [],
  usage: { inputTokens: 0, outputTokens: 0 },
};

/**
 * Asks the model for tests for changed source files that have no matching test changes. Optional and best effort:
 * any provider or output failure is reported in the summary but never fails the review.
 */
export async function suggestTests(deps: SuggestDeps, input: SuggestInput): Promise<SuggestOutcome> {
  const { log } = deps;
  const detected = detectFrameworks(await readSnapshot(deps.github, input.baseSha));
  detected.warnings.forEach((w) => {
    log.warning(w);
  });
  const evidence = Object.entries(detected.evidence).map(([f, why]) => `${f} (${why})`);
  log.info(`Test frameworks: ${evidence.length > 0 ? evidence.join(', ') : 'none detected'}.`);
  const frameworks = frameworksInUse(detected);
  if (frameworks.length === 0) return EMPTY;

  const selection = selectTestTargets(input.allFiles, input.reviewed, detected);
  const targets: TestTarget[] = [];
  const fingerprints: string[] = [];
  let bytes = 0;
  const budget = Math.min(MAX_SUGGEST_BYTES, input.budgetBytes);
  for (const target of selection.targets) {
    const patch = target.file.patch ?? '';
    const fp = targetFingerprint(target.file.filename, patch);
    if (input.earlier.has(fp)) {
      selection.skipped.push({
        path: target.file.filename,
        reason: 'tests already suggested for this version',
      });
      continue;
    }
    const size = Buffer.byteLength(patch, 'utf8');
    if (targets.length >= MAX_TEST_TARGETS || bytes + size > budget) {
      selection.skipped.push({ path: target.file.filename, reason: 'over the test-suggestion budget' });
      continue;
    }
    targets.push(target);
    fingerprints.push(fp);
    bytes += size;
  }
  for (const s of selection.skipped) log.info(`No test suggestions for ${s.path}: ${s.reason}.`);
  if (targets.length === 0) return EMPTY;

  const prompt = buildSuggestPrompt(
    { title: input.title, targets, maxSuggestions: input.maxSuggestions },
    deps.nonce,
  );
  try {
    const result = await deps.provider.complete({
      ...prompt,
      schema: suggestionSchema(frameworks),
      maxOutputTokens: input.maxOutputTokens,
    });
    const byPath = new Map(targets.map((t) => [t.file.filename, t] as const));
    const parsed = parseSuggestions(result.json, byPath, input.maxSuggestions);
    // A suggestion already posted on an earlier run (same target, kind and title) is not repeated.
    const fresh = parsed.suggestions.filter((s) => !input.earlier.has(s.fingerprint));
    const repeated = parsed.suggestions.length - fresh.length;
    log.info(
      `Test suggestions: ${String(fresh.length)} kept, ${String(parsed.dropped)} invalid, ` +
        `${String(parsed.duplicates + repeated)} duplicate, ${String(parsed.overCap)} over the cap.`,
    );
    return {
      suggestions: fresh,
      targetFingerprints: fingerprints,
      usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
    };
  } catch (err) {
    if (!(err instanceof ProviderError || err instanceof InvalidOutputError)) throw err;
    const kind = err instanceof ProviderError ? err.kind : 'invalid_output';
    log.warning(`Test suggestion request failed (${kind}): ${err.message}`);
    // No target fingerprints: a later run should try again.
    return { ...EMPTY, failure: kind };
  }
}

async function readSnapshot(github: GitHubApi, ref: string): Promise<RepoSnapshot> {
  const rootFiles = await github.listDirectory('', ref);
  const manifests: Partial<Record<Manifest, string>> = {};
  await Promise.all(
    MANIFESTS.filter((name) => rootFiles.includes(name)).map(async (name) => {
      const text = await github.getFileContent(name, ref);
      if (text !== undefined) manifests[name] = text;
    }),
  );
  return { rootFiles, manifests };
}
