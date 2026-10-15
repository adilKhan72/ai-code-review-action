# ADR-0004: Test suggestions are opt-in, deterministic in scope, and only shown in the summary

- Status: Accepted
- Date: 2026-10-15

## Context

A common review comment is "where are the tests?". An LLM can draft focused tests for a change, but generated tests
have known failure modes: they use the wrong framework, import functions that do not exist, assert on behaviour the
model guessed, and are long. If they were committed or pushed automatically, a reviewer would have to undo them.

## Decision

- **Opt-in.** `suggest-tests: true` enables it. It costs one extra model request per run, so it is off by default.
- **Scope is decided in code, not by the model.**
  - Frameworks are detected from the base commit's root files: `vitest.config.*`, `jest.config.*` or
    `package.json` (dependencies, `"jest"` key); `pytest.ini`, `conftest.py`, `pyproject.toml`, `setup.cfg`,
    `tox.ini`; `phpunit.xml(.dist)` or `composer.json`; `playwright.config.*` or `@playwright/test`.
  - A target is a reviewed source file (JS/TS, Python, PHP) with no changed test file sharing its stem
    (`src/map.ts` ↔ `test/map.test.ts`, `tests/test_map.py`, `tests/MapTest.php`). Declarations, tool config,
    migrations and stories are excluded.
  - Playwright specs are only allowed for UI files (`.tsx/.jsx/.vue/.svelte` or `pages/`, `app/`, `routes/`,
    `views/`, `components/`, `layouts/`) and only when Playwright is configured.
  - The schema's `framework` enum contains only the detected frameworks. Each answer is checked again: the target
    must be in the request, kind and framework must fit the target, the test path must be relative, stay in the
    repository and look like a test file.
- **Never committed.** Suggestions appear in the review summary as collapsed `<details>` blocks. The action still
  has no `contents: write` need (ADR-0003). A human copies what is useful.
- **Hard caps.** At most `max-test-suggestions` (default 5, max 10) per run, code at most 6,000 characters (longer
  answers are dropped, not truncated), at most 10 target files and 40 KB of patch per request, and the suggestion
  request shares the `max-diff-bytes` budget with the review. The rendered section is capped at 30,000 characters
  so findings always fit in GitHub's 65,536-character review body.
- **De-duplication.** Within one answer: same target, kind and normalised title, or identical code. Across runs:
  a hidden marker per target records `sha256(path + patch)`. If a file's patch is unchanged since suggestions were
  posted, the model is not asked again. Suggestions with a previously posted title fingerprint are dropped.
- **Best effort.** A failed or malformed suggestion request is noted in the summary and never fails the step or
  drops the review findings.

## Consequences

- No wrong-framework or wrong-language tests, by construction. Hallucinated imports are still possible: the model
  sees only the diff, not the rest of the file or existing tests. The prompt forbids using anything not visible in
  the diff, and the summary says to check imports and fixtures.
- Detection only looks at the repository root. Monorepos with per-package configs are not detected yet.
- Stem matching is a heuristic. A PR that touches `src/a/index.ts` and an unrelated `test/b/index.test.ts` counts
  as tested.
- Suggestions are not executed, so there is no guarantee they pass. Running them would mean executing PR code,
  which this action never does (ADR-0003).
