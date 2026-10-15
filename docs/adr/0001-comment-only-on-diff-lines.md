# ADR-0001: Comment only on diff lines

- Status: Accepted
- Date: 2026-10-15

## Context

The Pulls reviews API accepts inline comments only on lines that appear in the PR diff. If any comment in a review
points outside the diff, the **whole review** fails with `422 Unprocessable Entity`. LLMs often return line
numbers that are slightly off, or that refer to unchanged code they were shown as context.

## Decision

- Parse each file's unified-diff patch into the set of commentable `RIGHT`-side line numbers. These are added
  lines and context lines inside a hunk.
- A finding becomes an inline comment only if its `(path, line)` is in that set.
- Findings that miss are **not snapped to the nearest line**. A comment on the wrong line is worse than no inline
  comment. They are listed in the review summary with their claimed location instead.
- Only the `RIGHT` side (the new version) is targeted. Comments on deleted lines go to the summary.
- The review is posted with `event: COMMENT`. The bot never approves and never requests changes.

## Consequences

- A review can never be rejected because of a hallucinated anchor.
- Some real findings end up in the summary instead of inline. We accept this cost for correctness.
- The diff parser is a core, heavily tested module.
