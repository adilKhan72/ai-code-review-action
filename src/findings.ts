import { SEVERITIES, type Severity } from './config.js';
import type { Finding } from './types.js';

/**
 * The single schema every provider is constrained to. It is the strictest common subset: every property is
 * required and `additionalProperties` is false (OpenAI strict mode requires both). There are no numeric bounds
 * or string formats, because support for those differs between vendors. Those checks live in `parseFindings`.
 */
export const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path exactly as given in the diff header.' },
          line: {
            type: 'integer',
            description: 'New-file line number shown in the left column of the diff.',
          },
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string', description: 'One-line summary, under 100 characters.' },
          body: { type: 'string', description: 'Why it is a problem and a concrete fix. Markdown allowed.' },
        },
        required: ['path', 'line', 'severity', 'title', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

const MAX_TITLE = 120;
const MAX_BODY = 2_000;

export class InvalidOutputError extends Error {
  override name = 'InvalidOutputError';
}

/**
 * Validates model output again after the provider's own schema enforcement. Constrained decoding guarantees
 * shape, not sense. Smaller local models in particular can still produce line 0, empty titles or (without
 * constrained decoding) prose. Malformed individual findings are dropped. A malformed envelope throws.
 */
export function parseFindings(raw: unknown): { findings: Finding[]; dropped: number } {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { findings?: unknown }).findings)) {
    throw new InvalidOutputError('Model output is not an object with a "findings" array.');
  }
  const items = (raw as { findings: unknown[] }).findings;
  const findings: Finding[] = [];
  for (const item of items) {
    const finding = toFinding(item);
    if (finding) findings.push(finding);
  }
  return { findings, dropped: items.length - findings.length };
}

function toFinding(item: unknown): Finding | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const { path, line, severity, title, body } = item as Record<string, unknown>;
  if (typeof path !== 'string' || path.trim() === '') return undefined;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return undefined;
  if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) return undefined;
  if (typeof title !== 'string' || title.trim() === '') return undefined;
  if (typeof body !== 'string') return undefined;
  return {
    path: path.trim().replace(/^\.\//, ''),
    line,
    severity: severity as Severity,
    title: truncate(title.trim().replace(/\s+/g, ' '), MAX_TITLE),
    body: truncate(body.trim(), MAX_BODY),
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Parses provider text as JSON, with a typed error instead of a bare SyntaxError. */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidOutputError(`Model output is not valid JSON (${text.length} chars).`);
  }
}
