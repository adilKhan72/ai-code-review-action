/**
 * Parsing for the per-file `patch` strings returned by `GET /repos/{o}/{r}/pulls/{n}/files`.
 * These are unified-diff hunks without the `diff --git` / `---` / `+++` file headers.
 */

export interface PatchLine {
  kind: 'add' | 'del' | 'context';
  /** Line number in the new file. Undefined for deleted lines. */
  newLine: number | undefined;
  /** Line number in the old file. Undefined for added lines. */
  oldLine: number | undefined;
  text: string;
}

export interface Hunk {
  header: string;
  lines: PatchLine[];
}

export interface ParsedPatch {
  hunks: Hunk[];
  /** New-file lines GitHub accepts a `side: RIGHT` review comment on: added and context lines inside a hunk. */
  commentableLines: ReadonlySet<number>;
  addedLines: ReadonlySet<number>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string): ParsedPatch {
  const hunks: Hunk[] = [];
  const commentable = new Set<number>();
  const added = new Set<number>();
  let current: Hunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    // Anything before the first hunk header is not part of a hunk; GitHub does not send any, but be defensive.
    if (!current) continue;

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === '+') {
      current.lines.push({ kind: 'add', newLine, oldLine: undefined, text });
      commentable.add(newLine);
      added.add(newLine);
      newLine++;
    } else if (marker === '-') {
      current.lines.push({ kind: 'del', newLine: undefined, oldLine, text });
      oldLine++;
    } else if (marker === ' ') {
      current.lines.push({ kind: 'context', newLine, oldLine, text });
      commentable.add(newLine);
      newLine++;
      oldLine++;
    }
    // "\ No newline at end of file" and a trailing empty string from split() are deliberately ignored:
    // they do not correspond to a line in either file.
  }

  return { hunks, commentableLines: commentable, addedLines: added };
}

/**
 * Renders a patch with explicit new-file line numbers, so the model can cite lines exactly instead of
 * counting from hunk headers (which LLMs do badly).
 *
 *     @@ -10,2 +10,3 @@
 *       10   const a = 1;
 *       11 + const b = 2;
 *          - const c = 3;
 */
export function annotatePatch(parsed: ParsedPatch): string {
  const out: string[] = [];
  for (const hunk of parsed.hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) {
      const num = line.newLine === undefined ? '' : String(line.newLine);
      const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
      out.push(`${num.padStart(6)} ${sign} ${line.text}`);
    }
  }
  return out.join('\n');
}
