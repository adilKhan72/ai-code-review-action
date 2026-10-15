import { describe, expect, it } from 'vitest';
import { FINDINGS_SCHEMA, InvalidOutputError, parseFindings, parseJsonText } from '../src/findings.js';

const valid = {
  path: 'src/a.ts',
  line: 3,
  severity: 'high',
  title: 'SQL injection',
  body: 'Use a parameter.',
};

describe('parseFindings', () => {
  it('accepts valid findings and normalises paths and whitespace', () => {
    const { findings, dropped } = parseFindings({
      findings: [valid, { ...valid, path: './src/b.ts', title: '  multi\n line  title ' }],
    });
    expect(dropped).toBe(0);
    expect(findings[1]).toMatchObject({ path: 'src/b.ts', title: 'multi line title' });
  });

  it.each([
    ['line 0', { ...valid, line: 0 }],
    ['fractional line', { ...valid, line: 2.5 }],
    ['string line', { ...valid, line: '3' }],
    ['unknown severity', { ...valid, severity: 'blocker' }],
    ['empty title', { ...valid, title: ' ' }],
    ['empty path', { ...valid, path: '' }],
    ['missing body', { path: 'a', line: 1, severity: 'low', title: 't' }],
    ['not an object', 'oops'],
  ])('drops a finding with %s', (_label, bad) => {
    expect(parseFindings({ findings: [valid, bad] })).toMatchObject({ dropped: 1, findings: [valid] });
  });

  it('truncates very long titles and bodies', () => {
    const { findings } = parseFindings({
      findings: [{ ...valid, title: 't'.repeat(500), body: 'b'.repeat(5_000) }],
    });
    expect(findings[0]?.title).toHaveLength(120);
    expect(findings[0]?.body).toHaveLength(2_000);
    expect(findings[0]?.title.endsWith('…')).toBe(true);
  });

  it('rejects an envelope without a findings array', () => {
    expect(() => parseFindings([valid])).toThrow(InvalidOutputError);
    expect(() => parseFindings(null)).toThrow(InvalidOutputError);
    expect(() => parseFindings({ issues: [] })).toThrow(InvalidOutputError);
  });

  it('wraps JSON syntax errors', () => {
    expect(() => parseJsonText('{"findings": [')).toThrow(InvalidOutputError);
    expect(parseJsonText('{"findings":[]}')).toEqual({ findings: [] });
  });
});

describe('FINDINGS_SCHEMA', () => {
  it('meets OpenAI strict-mode rules: every property required, no additional properties', () => {
    const item = FINDINGS_SCHEMA.properties.findings.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.additionalProperties).toBe(false);
    expect(FINDINGS_SCHEMA.additionalProperties).toBe(false);
  });
});
