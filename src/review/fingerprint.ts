import { createHash } from 'node:crypto';
import type { Finding } from '../types.js';

/**
 * A finding's identity across runs. Line numbers move when code is added above, so the fingerprint uses the
 * *content* of the anchored line instead. If the line is unchanged, the finding is the same.
 */
export function fingerprint(finding: Pick<Finding, 'path' | 'title'>, lineText: string | undefined): string {
  const normalisedTitle = finding.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const normalisedLine = (lineText ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(`${finding.path}\n${normalisedTitle}\n${normalisedLine}`)
    .digest('hex')
    .slice(0, 16);
}

const MARKER = /<!-- ai-code-review-action:fp=([0-9a-f]{16}) -->/g;

export function fingerprintMarker(fp: string): string {
  return `<!-- ai-code-review-action:fp=${fp} -->`;
}

export function extractFingerprints(body: string): string[] {
  return [...body.matchAll(MARKER)].map((m) => m[1] ?? '').filter((fp) => fp !== '');
}
