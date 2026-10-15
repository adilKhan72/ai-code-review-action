import { describe, expect, it } from 'vitest';
import { mapFindings } from '../src/review/map.js';
import { REVIEW_MARKER, buildReview, commentBody, type ReviewSummary } from '../src/review/payload.js';
import type { Finding } from '../src/types.js';

const f = (
  path: string,
  line: number,
  severity: Finding['severity'],
  title = `issue ${path}:${line}`,
): Finding => ({
  path,
  line,
  severity,
  title,
  body: 'details',
});

const commentable = new Map([
  ['src/a.ts', new Set([1, 2, 3])],
  ['src/b.ts', new Set([10])],
]);

describe('mapFindings', () => {
  it('keeps on-diff findings inline and moves the rest to the summary without moving lines', () => {
    const result = mapFindings(
      [
        f('src/a.ts', 2, 'high'),
        f('src/a.ts', 4, 'high'),
        f('src/c.ts', 1, 'low'),
        f('src/b.ts', 10, 'medium'),
      ],
      commentable,
      'low',
      25,
    );
    expect(result.inline.map((x) => `${x.path}:${x.line}`)).toEqual(['src/a.ts:2', 'src/b.ts:10']);
    expect(result.offDiff.map((x) => `${x.path}:${x.line}`)).toEqual(['src/a.ts:4', 'src/c.ts:1']);
  });

  it('applies the severity threshold', () => {
    const result = mapFindings(
      [f('src/a.ts', 1, 'low'), f('src/a.ts', 2, 'critical')],
      commentable,
      'high',
      25,
    );
    expect(result.inline.map((x) => x.severity)).toEqual(['critical']);
    expect(result.belowThreshold).toBe(1);
  });

  it('removes duplicates (same path, line and title, ignoring case)', () => {
    const result = mapFindings(
      [
        f('src/a.ts', 1, 'low', 'Null check'),
        f('src/a.ts', 1, 'low', 'null CHECK'),
        f('src/a.ts', 1, 'low', 'Other'),
      ],
      commentable,
      'low',
      25,
    );
    expect(result.inline).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });

  it('orders by severity and caps inline comments, moving the overflow to the summary', () => {
    const result = mapFindings(
      [f('src/a.ts', 1, 'low'), f('src/a.ts', 2, 'critical'), f('src/a.ts', 3, 'medium')],
      commentable,
      'low',
      2,
    );
    expect(result.inline.map((x) => x.severity)).toEqual(['critical', 'medium']);
    expect(result.offDiff.map((x) => x.severity)).toEqual(['low']);
  });
});

describe('buildReview', () => {
  const summary: ReviewSummary = {
    headSha: 'abc123',
    model: 'claude-opus-5-5',
    reviewedFiles: 2,
    inline: [f('src/a.ts', 2, 'high', 'SQL injection')],
    offDiff: [f('src/c.ts', 9, 'low', 'Use `const` <here>')],
    skipped: [{ path: 'yarn.lock', reason: 'matched by exclude' }],
    failedChunks: ['`src/z.ts`: refusal'],
    usage: { inputTokens: 1000, outputTokens: 200 },
    belowThreshold: 3,
  };
  const review = buildReview(summary);

  it('posts a COMMENT review pinned to the head commit with RIGHT-side inline comments', () => {
    expect(review.event).toBe('COMMENT');
    expect(review.commit_id).toBe('abc123');
    expect(review.comments).toEqual([
      { path: 'src/a.ts', line: 2, side: 'RIGHT', body: '**🟠 high: SQL injection**\n\ndetails' },
    ]);
  });

  it('summarises off-diff findings, failures, skipped files and usage', () => {
    expect(review.body.startsWith(REVIEW_MARKER)).toBe(true);
    expect(review.body).toContain('2 findings in 2 reviewed files: 1 inline, 1 below.');
    expect(review.body).toContain('- ⚪ low: `src/c.ts:9` Use \\`const\\` \\<here\\>');
    expect(review.body).toContain('**Partially reviewed.**');
    expect(review.body).toContain('<details><summary>1 file not reviewed</summary>');
    expect(review.body).toContain('- `yarn.lock`: matched by exclude');
    expect(review.body).toContain('1000 input / 200 output tokens');
    expect(review.body).toContain('3 below min-severity hidden');
  });

  it('escapes Markdown in model-written titles', () => {
    expect(commentBody(f('a', 1, 'low', '**bold** [link](x)\nnext'))).toContain(
      '\\*\\*bold\\*\\* \\[link\\](x) next',
    );
  });
});
