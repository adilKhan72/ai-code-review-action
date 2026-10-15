import { describe, expect, it } from 'vitest';
import { extractFingerprints } from '../src/review/fingerprint.js';
import { MAX_SECTION_CHARS, renderSuggestions } from '../src/suggest/render.js';
import type { TestSuggestion } from '../src/suggest/schema.js';

const suggestion = (overrides: Partial<TestSuggestion> = {}): TestSuggestion => ({
  target: 'src/a.ts',
  kind: 'unit',
  framework: 'vitest',
  testPath: 'test/a.test.ts',
  title: 'rejects negative amounts',
  rationale: 'The new guard is untested.',
  code: "it('x', () => {});",
  fingerprint: 'aaaaaaaaaaaaaaaa',
  ...overrides,
});

describe('renderSuggestions', () => {
  it('renders each suggestion as a collapsible block with a fenced code sample and markers', () => {
    const md = renderSuggestions({ suggestions: [suggestion()], targetFingerprints: ['bbbbbbbbbbbbbbbb'] });
    expect(md).toContain('### Suggested tests');
    expect(md).toContain(
      '<details><summary>🧪 unit · vitest · <code>src/a.ts</code>: rejects negative amounts</summary>',
    );
    expect(md).toContain("```ts\nit('x', () => {});\n```");
    expect(md).toContain('Suggested file: <code>test/a.test.ts</code>');
    expect(extractFingerprints(md)).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  });

  it('uses a fence longer than any backtick run in the code', () => {
    const md = renderSuggestions({
      suggestions: [suggestion({ code: 'const s = `x`;\n// ```` four', testPath: 'tests/test_a.py' })],
      targetFingerprints: [],
    });
    expect(md).toContain('`````python\nconst s = `x`;\n// ```` four\n`````');
  });

  it('escapes HTML in model text so it cannot break out of the details block', () => {
    const md = renderSuggestions({
      suggestions: [
        suggestion({ title: '</summary></details><img src=x>', rationale: 'a\n</details>\n<script>' }),
      ],
      targetFingerprints: [],
    });
    expect(md).not.toContain('<img');
    expect(md).not.toContain('<script>');
    expect(md.match(/<\/details>/g)).toHaveLength(1);
    expect(md).toContain('&lt;/summary&gt;&lt;/details&gt;&lt;img src=x&gt;');
  });

  it('keeps the section under the size limit and says how many were left out', () => {
    const big = (i: number) =>
      suggestion({
        title: `t${String(i)}`,
        code: 'x'.repeat(5_900),
        fingerprint: String(i).padStart(16, '0'),
      });
    const md = renderSuggestions({
      suggestions: Array.from({ length: 8 }, (_, i) => big(i)),
      targetFingerprints: [],
    });
    expect(md.length).toBeLessThan(MAX_SECTION_CHARS + 500);
    expect(md).toMatch(/\d more suggestions omitted \(review size limit\)/);
  });

  it('reports a failure and renders nothing when there is nothing to say', () => {
    expect(renderSuggestions({ suggestions: [], targetFingerprints: [] })).toBe('');
    expect(renderSuggestions({ suggestions: [], targetFingerprints: [], failure: 'refusal' })).toBe(
      'Test suggestions unavailable: refusal.',
    );
  });
});
