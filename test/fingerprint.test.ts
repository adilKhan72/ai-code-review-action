import { describe, expect, it } from 'vitest';
import { extractFingerprints, fingerprint, fingerprintMarker } from '../src/review/fingerprint.js';

const finding = { path: 'src/a.ts', title: 'Possible SQL injection' };

describe('fingerprint', () => {
  it('depends on the line content, not the line number, so it survives code moving', () => {
    expect(fingerprint(finding, '  return db.query(sql);')).toBe(
      fingerprint(finding, 'return db.query(sql);'),
    );
    expect(fingerprint(finding, 'return db.query(sql);')).not.toBe(
      fingerprint(finding, 'return db.query(safe);'),
    );
  });

  it('ignores case and punctuation in the title, but not the path', () => {
    expect(fingerprint(finding, 'x')).toBe(
      fingerprint({ ...finding, title: 'possible sql-injection!' }, 'x'),
    );
    expect(fingerprint(finding, 'x')).not.toBe(fingerprint({ ...finding, path: 'src/b.ts' }, 'x'));
  });

  it('is a 16-character hex string', () => {
    expect(fingerprint(finding, undefined)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('extractFingerprints', () => {
  it('finds every marker in a body and ignores lookalikes', () => {
    const a = fingerprint(finding, 'a');
    const b = fingerprint(finding, 'b');
    const body = `text ${fingerprintMarker(a)}\n- item ${fingerprintMarker(b)}\n<!-- ai-code-review-action:fp=nothex -->`;
    expect(extractFingerprints(body)).toEqual([a, b]);
    expect(extractFingerprints('no markers')).toEqual([]);
  });
});
