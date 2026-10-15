import type { Severity } from './config.js';

/** The fields of a `GET /pulls/{n}/files` entry that the action uses. */
export interface PrFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  /** Absent for binary files and for diffs GitHub considers too large to return. */
  patch?: string | undefined;
}

export interface Finding {
  path: string;
  line: number;
  severity: Severity;
  title: string;
  body: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
