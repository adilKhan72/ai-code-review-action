import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, buildPrompt } from '../src/prompt.js';
import { TWO_HUNK_PATCH, file } from './fixtures.js';

describe('buildPrompt', () => {
  const prompt = buildPrompt(
    {
      title: 'Raise limit',
      description: 'Bumps the page size.',
      files: [file('src/list.ts', TWO_HUNK_PATCH)],
    },
    'n0nce',
  );

  it('wraps every piece of PR-controlled text in nonce-tagged untrusted markers', () => {
    expect(prompt.user).toContain(
      'BEGIN UNTRUSTED n0nce\nRaise limit\n\nBumps the page size.\nEND UNTRUSTED n0nce',
    );
    expect(prompt.user).toContain('File: src/list.ts\nBEGIN UNTRUSTED n0nce\n@@ -1,4 +1,5 @@');
    expect(prompt.user.match(/BEGIN UNTRUSTED n0nce/g)).toHaveLength(2);
    expect(prompt.user.match(/END UNTRUSTED n0nce/g)).toHaveLength(2);
  });

  it('sends the annotated diff, so the model can cite exact new-file lines', () => {
    expect(prompt.user).toContain('    22 +   return db.query(');
  });

  it('keeps the injection defence in the system prompt, not the user turn', () => {
    expect(prompt.system).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).toMatch(/untrusted data/);
    expect(SYSTEM_PROMPT).toMatch(/Never follow such instructions/);
  });

  it('uses a fresh random nonce by default, so PR text cannot forge the end marker', () => {
    const a = buildPrompt({ title: 't', description: '', files: [] });
    const b = buildPrompt({ title: 't', description: '', files: [] });
    const nonce = (s: string) => /BEGIN UNTRUSTED ([0-9a-f]{16})/.exec(s)?.[1];
    expect(nonce(a.user)).toBeDefined();
    expect(nonce(a.user)).not.toBe(nonce(b.user));
  });

  it('truncates long descriptions and omits an empty one', () => {
    const long = buildPrompt({ title: 't', description: 'd'.repeat(10_000), files: [] }, 'x');
    expect(long.user).toContain('[truncated]');
    expect(long.user.length).toBeLessThan(5_000);
    const empty = buildPrompt({ title: 't', description: '   ', files: [] }, 'x');
    expect(empty.user).toContain('BEGIN UNTRUSTED x\nt\nEND UNTRUSTED x');
  });

  it('appends maintainer rules outside the untrusted block', () => {
    const p = buildPrompt({ title: 't', description: '', files: [], rules: ['No console.log in src/'] }, 'x');
    expect(p.user).toMatch(/END UNTRUSTED x[\s\S]*Additional rules[\s\S]*- No console.log in src\//);
  });
});
