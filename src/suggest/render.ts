import { fingerprintMarker } from '../review/fingerprint.js';
import type { TestSuggestion } from './schema.js';

/** The review body limit is 65,536 characters. Suggestions get a fixed share so findings always fit. */
export const MAX_SECTION_CHARS = 30_000;

export interface SuggestionSection {
  suggestions: readonly TestSuggestion[];
  /** Fingerprints of the target files the model was asked about, so a later run does not ask again. */
  targetFingerprints: readonly string[];
  /** Set when the suggestion request failed. */
  failure?: string | undefined;
}

const FENCE_LANGUAGE: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  py: 'python',
  php: 'php',
};

/**
 * Renders suggestions as collapsible blocks for the review summary. Nothing here is committed to the repository.
 * Model text is untrusted: titles and paths are HTML-escaped (they sit inside `<summary>`), the rationale is
 * escaped so it cannot close the `<details>` block, and code goes in a fence longer than any backtick run in it.
 */
export function renderSuggestions(section: SuggestionSection): string {
  const lines: string[] = [];
  if (section.suggestions.length > 0) {
    lines.push(
      '### Suggested tests',
      '',
      '<sub>Changed files without matching test changes. Generated from the diff only and not committed; ' +
        'check imports and fixtures before using them.</sub>',
    );
    let used = 0;
    let omitted = 0;
    for (const s of section.suggestions) {
      const block = renderOne(s);
      if (used + block.length > MAX_SECTION_CHARS) {
        omitted++;
        continue;
      }
      used += block.length;
      lines.push('', block);
    }
    if (omitted > 0) lines.push('', `${String(omitted)} more suggestions omitted (review size limit).`);
  }
  if (section.failure) lines.push('', `Test suggestions unavailable: ${escapeHtml(section.failure)}.`);
  if (section.targetFingerprints.length > 0) {
    lines.push('', section.targetFingerprints.map(fingerprintMarker).join(''));
  }
  return lines.join('\n').replace(/^\n+/, '');
}

function renderOne(s: TestSuggestion): string {
  const ext = /\.([a-z]+)$/i.exec(s.testPath)?.[1]?.toLowerCase() ?? '';
  const longestRun = Math.max(0, ...[...s.code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return [
    `<details><summary>🧪 ${s.kind} · ${s.framework} · <code>${escapeHtml(s.target)}</code>: ${escapeHtml(s.title)}</summary>`,
    '',
    escapeHtml(s.rationale),
    '',
    `Suggested file: <code>${escapeHtml(s.testPath)}</code>`,
    '',
    `${fence}${FENCE_LANGUAGE[ext] ?? ''}`,
    s.code,
    fence,
    '',
    fingerprintMarker(s.fingerprint),
    '</details>',
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
