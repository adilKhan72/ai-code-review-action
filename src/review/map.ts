import { SEVERITIES, type Severity } from '../config.js';
import type { Finding } from '../types.js';

export interface MappedFindings {
  /** Findings anchored on a line GitHub will accept a review comment on. */
  inline: Finding[];
  /** Findings whose path/line is not in the diff. Reported in the summary, never as inline comments. */
  offDiff: Finding[];
  belowThreshold: number;
  duplicates: number;
}

const rank = (s: Severity): number => SEVERITIES.indexOf(s);

/**
 * Applies the severity threshold, removes duplicates and validates anchors against the diff (ADR-0001).
 * Findings are never moved to a nearby line. A comment on the wrong line is worse than none.
 *
 * Output is sorted by severity (highest first), then by path and line. Inline comments over `maxInline` go to the
 * summary, so a noisy model cannot flood the PR.
 */
export function mapFindings(
  findings: readonly Finding[],
  commentable: ReadonlyMap<string, ReadonlySet<number>>,
  minSeverity: Severity,
  maxInline: number,
): MappedFindings {
  const seen = new Set<string>();
  const inline: Finding[] = [];
  const offDiff: Finding[] = [];
  let belowThreshold = 0;
  let duplicates = 0;

  const sorted = [...findings].sort(
    (a, b) => rank(b.severity) - rank(a.severity) || a.path.localeCompare(b.path) || a.line - b.line,
  );
  for (const finding of sorted) {
    if (rank(finding.severity) < rank(minSeverity)) {
      belowThreshold++;
      continue;
    }
    const key = `${finding.path}\0${String(finding.line)}\0${finding.title.toLowerCase()}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    const onDiff = commentable.get(finding.path)?.has(finding.line) === true;
    if (onDiff && inline.length < maxInline) inline.push(finding);
    else offDiff.push(finding);
  }
  return { inline, offDiff, belowThreshold, duplicates };
}
