import { chunkFiles } from './chunk.js';
import type { Config } from './config.js';
import { parsePatch } from './diff/patch.js';
import { selectFiles } from './filter.js';
import { FINDINGS_SCHEMA, InvalidOutputError, parseFindings } from './findings.js';
import type { GitHubApi } from './github.js';
import { buildPrompt } from './prompt.js';
import { ProviderError, type Provider } from './providers/types.js';
import { mapFindings } from './review/map.js';
import { buildReview, type ReviewPayload } from './review/payload.js';
import type { Finding, SkippedFile, TokenUsage } from './types.js';

/** Soft per-request diff budget (about 15k tokens of code). Keeps each request focused and within timeouts. */
export const MAX_CHUNK_BYTES = 60_000;
/** Inline comments over this go to the summary. Twenty-five comments on one PR is already a lot. */
export const MAX_INLINE_COMMENTS = 25;

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
}

export type ReviewOutcome =
  | { status: 'skipped'; reason: string }
  | {
      status: 'reviewed' | 'clean' | 'dry-run';
      inline: number;
      offDiff: number;
      failedChunks: number;
      usage: TokenUsage;
      url?: string;
      payload?: ReviewPayload;
    };

export interface EngineDeps {
  github: GitHubApi;
  provider: Provider;
  log: Logger;
  /** Fixed prompt nonce for tests. */
  nonce?: string;
}

type ReviewConfig = Pick<
  Config,
  | 'include'
  | 'exclude'
  | 'maxFiles'
  | 'maxFileBytes'
  | 'maxDiffBytes'
  | 'maxOutputTokens'
  | 'minSeverity'
  | 'skipDraft'
  | 'dryRun'
  | 'model'
>;

export async function reviewPullRequest(deps: EngineDeps, config: ReviewConfig): Promise<ReviewOutcome> {
  const { github, provider, log } = deps;
  const pr = await github.getPullRequest();
  // Re-checked here because the event payload can be stale on a re-run.
  if (pr.draft && config.skipDraft) return { status: 'skipped', reason: `PR #${pr.number} is a draft` };

  const files = await github.listFiles();
  const filtered = selectFiles(files, config);
  const { chunks, skipped: overBudget } = chunkFiles(
    filtered.selected,
    Math.min(MAX_CHUNK_BYTES, config.maxDiffBytes),
    config.maxDiffBytes,
  );
  const skipped: SkippedFile[] = [...filtered.skipped, ...overBudget];
  if (chunks.length === 0) {
    return { status: 'skipped', reason: `no reviewable files (${String(skipped.length)} skipped)` };
  }

  const commentable = new Map<string, ReadonlySet<number>>();
  for (const file of chunks.flat())
    commentable.set(file.filename, parsePatch(file.patch ?? '').commentableLines);

  const findings: Finding[] = [];
  const failedChunks: string[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let model = config.model;

  // Sequential, not parallel: chunk counts are small, and it keeps the action well inside provider rate limits.
  for (const [index, chunk] of chunks.entries()) {
    const label = `request ${String(index + 1)}/${String(chunks.length)} (${chunk.map((f) => f.filename).join(', ')})`;
    const prompt = buildPrompt({ title: pr.title, description: pr.body, files: chunk }, deps.nonce);
    try {
      const result = await provider.complete({
        ...prompt,
        schema: FINDINGS_SCHEMA,
        maxOutputTokens: config.maxOutputTokens,
      });
      model = result.model;
      if (result.usage) {
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
      }
      const parsed = parseFindings(result.json);
      // A finding for a file that was not in this request is invented. The model never saw that diff.
      const paths = new Set(chunk.map((f) => f.filename));
      const own = parsed.findings.filter((f) => paths.has(f.path));
      const dropped = parsed.dropped + parsed.findings.length - own.length;
      if (dropped > 0)
        log.warning(`${label}: dropped ${String(dropped)} malformed or out-of-scope findings.`);
      findings.push(...own);
      log.info(`${label}: ${String(own.length)} findings.`);
    } catch (err) {
      if (!(err instanceof ProviderError || err instanceof InvalidOutputError)) throw err;
      const kind = err instanceof ProviderError ? err.kind : 'invalid_output';
      failedChunks.push(`${chunk.map((f) => `\`${f.filename}\``).join(', ')}: ${kind}`);
      log.warning(`${label} failed (${kind}): ${err.message}`);
    }
  }

  if (failedChunks.length === chunks.length) {
    throw new Error(`All ${String(chunks.length)} review requests failed; see the warnings above.`);
  }

  const mapped = mapFindings(findings, commentable, config.minSeverity, MAX_INLINE_COMMENTS);
  const counts = {
    inline: mapped.inline.length,
    offDiff: mapped.offDiff.length,
    failedChunks: failedChunks.length,
    usage,
  };
  if (counts.inline === 0 && counts.offDiff === 0 && failedChunks.length === 0) {
    // Posting "no issues" on every push is noise; the job log and the `status` output are enough.
    log.info('No findings; not posting a review.');
    return { status: 'clean', ...counts };
  }

  const summary = {
    headSha: pr.headSha,
    model,
    reviewedFiles: commentable.size,
    inline: mapped.inline,
    offDiff: mapped.offDiff,
    skipped,
    failedChunks,
    usage,
    belowThreshold: mapped.belowThreshold,
  };
  const payload = buildReview(summary);
  if (config.dryRun) {
    log.info(`Dry run; review not posted:\n${JSON.stringify(payload, null, 2)}`);
    return { status: 'dry-run', ...counts, payload };
  }

  try {
    const { url } = await github.createReview(payload);
    return { status: 'reviewed', ...counts, url };
  } catch (err) {
    // 422 means GitHub rejected an anchor, usually because a new commit was pushed while this run was in
    // progress and the diff changed. Post everything in the summary instead of losing the review.
    if (!isStatus(err, 422) || payload.comments.length === 0) throw err;
    log.warning('GitHub rejected the inline comments (422); posting all findings in the summary instead.');
    const fallback = buildReview({ ...summary, inline: [], offDiff: [...mapped.inline, ...mapped.offDiff] });
    const { url } = await github.createReview(fallback);
    return { status: 'reviewed', ...counts, inline: 0, offDiff: counts.inline + counts.offDiff, url };
  }
}

function isStatus(err: unknown, status: number): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === status;
}
