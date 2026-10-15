import type { Finding, SkippedFile, TokenUsage } from '../types.js';

/** Hidden marker that identifies this action's reviews (used for de-duplication in a later milestone). */
export const REVIEW_MARKER = '<!-- ai-code-review-action -->';

export interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

/** Body of `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`. */
export interface ReviewPayload {
  commit_id: string;
  event: 'COMMENT';
  body: string;
  comments: ReviewComment[];
}

export interface ReviewSummary {
  headSha: string;
  model: string;
  reviewedFiles: number;
  inline: readonly Finding[];
  offDiff: readonly Finding[];
  skipped: readonly SkippedFile[];
  failedChunks: readonly string[];
  usage: TokenUsage;
  belowThreshold: number;
}

const BADGE: Record<Finding['severity'], string> = {
  critical: '🔴 critical',
  high: '🟠 high',
  medium: '🟡 medium',
  low: '⚪ low',
};

export function commentBody(finding: Finding): string {
  return `**${BADGE[finding.severity]}: ${escapeInline(finding.title)}**\n\n${finding.body}`;
}

export function buildReview(summary: ReviewSummary): ReviewPayload {
  return {
    commit_id: summary.headSha,
    // Never APPROVE or REQUEST_CHANGES: an LLM should not be able to gate a merge (ADR-0003).
    event: 'COMMENT',
    body: summaryBody(summary),
    comments: summary.inline.map((f) => ({
      path: f.path,
      line: f.line,
      side: 'RIGHT',
      body: commentBody(f),
    })),
  };
}

function summaryBody(s: ReviewSummary): string {
  const total = s.inline.length + s.offDiff.length;
  const lines = [
    REVIEW_MARKER,
    '### AI review',
    '',
    total === 0
      ? `No issues found in ${plural(s.reviewedFiles, 'file')}.`
      : `${plural(total, 'finding')} in ${plural(s.reviewedFiles, 'reviewed file')}: ${String(s.inline.length)} inline` +
        (s.offDiff.length > 0 ? `, ${String(s.offDiff.length)} below.` : '.'),
  ];

  if (s.offDiff.length > 0) {
    lines.push(
      '',
      '**Findings outside the diff or over the inline limit** (not anchored to a changed line):',
      '',
    );
    for (const f of s.offDiff) {
      lines.push(`- ${BADGE[f.severity]}: \`${f.path}:${String(f.line)}\` ${escapeInline(f.title)}`);
    }
  }
  if (s.failedChunks.length > 0) {
    lines.push('', '**Partially reviewed.** Some requests failed:', '');
    for (const reason of s.failedChunks) lines.push(`- ${reason}`);
  }
  if (s.skipped.length > 0) {
    lines.push('', `<details><summary>${plural(s.skipped.length, 'file')} not reviewed</summary>`, '');
    for (const f of s.skipped) lines.push(`- \`${f.path}\`: ${f.reason}`);
    lines.push('', '</details>');
  }

  const footer = [
    `model \`${s.model}\``,
    `${String(s.usage.inputTokens)} input / ${String(s.usage.outputTokens)} output tokens`,
  ];
  if (s.belowThreshold > 0) footer.push(`${String(s.belowThreshold)} below min-severity hidden`);
  lines.push('', `<sub>${footer.join(' · ')}. AI-generated; verify before acting.</sub>`);
  return lines.join('\n');
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Model text goes into Markdown. Neutralise characters that could break the surrounding formatting. */
function escapeInline(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/([*_`<>[\]])/g, '\\$1');
}
