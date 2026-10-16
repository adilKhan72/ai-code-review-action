# ai-code-review-action

A GitHub Action that reviews pull requests with an LLM and posts **one** review with inline comments, **only on
lines the PR actually changed**, under hard cost limits.

> **Status: v1.0.0 released.** Built in public, one pull request per milestone. See [Roadmap](#roadmap) and the
> [changelog](CHANGELOG.md). The review engine works end to end against the real GitHub API, but it has **not yet been run against a live
> model**. Every provider test uses a mock.

## The problem

LLM review bots usually fail in one of three ways:

1. **Noise.** They comment on unchanged code, repeat the same finding on every push, or flag style a linter
   already enforces. Reviewers learn to ignore them.
2. **Broken anchors.** The model invents a line number. GitHub rejects the whole review with `422`, or the comment
   lands on the wrong line.
3. **Unbounded cost.** A lockfile update or a generated client sends 2 MB of diff to a frontier model.

This action deals with each of these in code. It does not rely on the prompt alone:

- Findings are **validated against the diff hunks**. A finding on a line outside the diff never becomes an inline
  comment. It moves to the review summary or is dropped ([ADR-0001](docs/adr/0001-comment-only-on-diff-lines.md)).
- Every vendor's **native structured output** (a JSON schema) is used, and the result is parsed again strictly
  ([ADR-0002](docs/adr/0002-pluggable-providers-with-native-structured-output.md)).
- **Guardrails come before any model call.** These are max files, max diff bytes, max output tokens and
  include/exclude globs. Lockfiles, generated code and binaries are excluded by default.
- **The diff is treated as untrusted input.** The action never executes PR code. It asks for no write permission
  beyond posting a review, and its prompt says that instructions inside the code are data, not commands
  ([ADR-0003](docs/adr/0003-diff-is-untrusted-input.md)).

## How it works

```mermaid
flowchart LR
    E[pull_request event] --> F[Fetch PR files + patches<br/>GitHub REST]
    F --> G{Guardrails<br/>globs · size · max files}
    G -- skipped files --> S
    G --> C[Chunk diff<br/>by file, byte budget]
    C --> P{LLM provider}
    P --> A[Anthropic<br/>default]
    P --> O[OpenAI]
    P --> L[Ollama<br/>self-hosted]
    A & O & L --> V[Strict JSON parse<br/>findings]
    V --> M[Map to diff lines<br/>RIGHT side only]
    M -- valid --> R[One review:<br/>inline comments]
    M -- off-diff --> S[Summary]
    S --> R
```

| Step     | Module                          | Notes                                                                                                                   |
| -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Fetch    | `src/github.ts`                 | `pulls.get` + paginated `pulls.listFiles`: per-file patches, no checkout                                                |
| Filter   | `src/filter.ts`                 | include/exclude globs, per-file byte cap, skip deleted/binary files, `max-files`                                        |
| Diff     | `src/diff/patch.ts`             | parse hunks into commentable `RIGHT`-side lines; render the patch with explicit new-file line numbers for the model     |
| Chunk    | `src/chunk.ts`                  | whole files per request (about 60 KB), hard `max-diff-bytes` total. Files over budget are skipped, never truncated      |
| Prompt   | `src/prompt.ts`                 | PR title, description and diffs inside random-nonce `UNTRUSTED` markers; injection rules in the system prompt           |
| Provider | `src/providers/`                | `complete({system, user, schema})`. Anthropic SDK, OpenAI and Ollama over `fetch`. Typed refusal/truncation errors      |
| Validate | `src/findings.ts`               | one shared JSON schema, then a strict re-check. Findings for files not in that request are dropped as invented          |
| Map      | `src/review/map.ts`             | severity threshold, de-duplication, anchor check, inline cap of 25. Everything else goes to the summary                 |
| Tests    | `src/suggest/`                  | opt-in: framework detection, target selection, suggestion schema, rendering (ADR-0004)                                  |
| Post     | `src/review/payload.ts`, engine | one `COMMENT` review pinned to the head SHA. On `422` (diff moved under us), re-posts with every finding in the summary |

Failure handling: if one request fails (refusal, truncation, bad JSON, HTTP error), the review is still posted and
marked **partially reviewed**. If every request fails, the step fails and nothing is posted. If there are no
findings, nothing is posted. The `status` output and the job log say so, to avoid "LGTM" noise on every push.

## Usage

```yaml
# .github/workflows/ai-review.yml
name: AI review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

# A new push makes the running review obsolete.
concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    steps:
      - uses: adilKhan72/ai-code-review-action@v1
        with:
          provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          max-files: 30
          max-diff-bytes: 200000
          exclude: |
            **/*.lock
            dist/**
```

### Pinning a version

- `@v1` follows the latest `1.x.y` release: fixes and backwards-compatible features, no breaking changes.
- `@v1.0.0` is an immutable tag in practice, but a tag can technically be moved by the repository owner.
- **A full commit SHA** is the only reference that cannot change under you. Security-conscious teams (and
  GitHub's [hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions))
  pin third-party actions this way. Keep the version in a comment so Dependabot or Renovate can update it:

  ```yaml
  - uses: adilKhan72/ai-code-review-action@3f7ca4152fdb6028bc0aae6ad88485739097ee93 # v1.0.0
  ```

  The SHA for each release is in its [release notes](https://github.com/adilKhan72/ai-code-review-action/releases).
  You can also get it with `git ls-remote https://github.com/adilKhan72/ai-code-review-action refs/tags/v1.0.0`.

To enable test suggestions, add `suggest-tests: true` under `with:` (see
[Test suggestions](#test-suggestions-opt-in)).

> Pull requests from forks do not receive repository secrets with `pull_request`. Do not switch to
> `pull_request_target` to work around this unless you understand the risk. This action never checks out PR code,
> but other steps in your job might.

## Configuration

`action.yml` is the source of truth.

| Input                  | Default                         | Purpose                                                                          |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `provider`             | `anthropic`                     | `anthropic`, `openai` or `ollama`                                                |
| `model`                | `claude-opus-5-5` for Anthropic | Model id. **Required** for OpenAI and Ollama                                     |
| `api-key`              | none                            | Provider API key (not needed for Ollama)                                         |
| `base-url`             | vendor default                  | e.g. a self-hosted Ollama URL or an OpenAI-compatible gateway                    |
| `effort`               | `medium`                        | Anthropic effort (`low` … `max`), always sent explicitly                         |
| `github-token`         | `${{ github.token }}`           | Token used to read the PR and post the review                                    |
| `include`              | `**`                            | Newline-separated globs                                                          |
| `exclude`              | none                            | Added to built-in excludes (lockfiles, `dist/`, `vendor/`, minified, maps, SVGs) |
| `no-default-excludes`  | `false`                         | Drop the built-in excludes                                                       |
| `max-files`            | `30`                            | Files above this count are skipped and listed in the summary                     |
| `max-file-bytes`       | `50000`                         | Skip any single file whose patch is larger                                       |
| `max-diff-bytes`       | `200000`                        | Total patch bytes sent to the model across all requests                          |
| `max-output-tokens`    | `16000`                         | Per-request output cap                                                           |
| `min-severity`         | `low`                           | Drop findings below `low` / `medium` / `high` / `critical`                       |
| `skip-draft`           | `true`                          | Do nothing on draft PRs                                                          |
| `dry-run`              | `false`                         | Log the review payload instead of posting it                                     |
| `config-path`          | `.github/ai-review.yml`         | Repository config file, read from the base commit                                |
| `reviewer-login`       | `github-actions[bot]`           | Whose earlier comments count for de-duplication. Change it when using a PAT/App  |
| `suggest-tests`        | `false`                         | Also suggest tests for changed source files without test changes (one request)   |
| `max-test-suggestions` | `5`                             | Cap on test suggestions per run (1–10)                                           |

Outputs: `status` (`reviewed`, `clean`, `dry-run`, `skipped`), `inline-comments`, `summary-findings`,
`test-suggestions`, `review-url`.

### Provider details

- **Anthropic:** official `@anthropic-ai/sdk`, beta Messages endpoint, adaptive thinking, structured output via
  `output_config.format` (JSON schema), explicit `effort`, and server-side refusal fallback (`fallbacks: "default"`,
  beta `server-side-fallback-2026-07-01`). `stop_reason` is checked for `refusal` and `max_tokens` before content
  is read.
- **OpenAI:** Chat Completions with `response_format: json_schema, strict: true`. `refusal` and
  `finish_reason: length` are mapped to typed errors.
- **Ollama:** `/api/chat` with `format: <schema>`, `stream: false`, temperature 0.

### Repository config: `.github/ai-review.yml`

Optional. House rules and overrides that live with the code:

```yaml
rules: # up to 20, each up to 500 characters; added to every prompt
  - Money is integer cents. Flag floats used for currency.
  - Every new API endpoint needs an authorization check.
min-severity: medium # overrides the input
include: ['src/**', 'app/**'] # overrides the input
exclude: ['**/*.generated.ts'] # added to the input's excludes
max-files: 20 # overrides the input
```

- The file is read from the PR's **base commit**, not the head. A pull request cannot loosen the rules it is reviewed
  under, or inject its own "rules" into the prompt.
- Unknown keys produce a warning. Wrong types fail the step with a message naming the key.
- This repository's own [`.github/ai-review.yml`](.github/ai-review.yml) is a working example.

### Re-runs and new pushes

Every finding the action posts carries a hidden fingerprint: a hash of the path, the normalised title and the
**text** of the flagged line. Before posting, the action collects fingerprints from earlier comments and review
summaries written by `reviewer-login` (default `github-actions[bot]`), and drops findings that were already
reported. If the flagged line itself changes, the finding counts as new. If nothing new remains, nothing is posted.

### Test suggestions (opt-in)

With `suggest-tests: true`, the action looks for changed source files that have **no matching test change** in the
same PR and asks the model, in one extra request, for a few focused tests for them. They appear in the review
summary as collapsed blocks. Nothing is committed or pushed.

- **Frameworks are detected, not guessed.** From the base commit's root: vitest or jest (config file or
  `package.json`), pytest (`pytest.ini`, `conftest.py`, `pyproject.toml`, `setup.cfg`, `tox.ini`), PHPUnit
  (`phpunit.xml[.dist]`, `composer.json`) and Playwright (`playwright.config.*`, `@playwright/test`). The schema
  only allows the detected frameworks, and each suggestion must fit its file's language.
- **Playwright E2E specs** are suggested only for UI files (`.tsx`, `.jsx`, `.vue`, `.svelte`, or files under
  `pages/`, `app/`, `routes/`, `views/`, `components/`, `layouts/`) and only when Playwright is configured.
- **"Matching test change"** means a changed test file with the same stem: `src/map.ts` is covered by
  `test/map.test.ts`, `src/__tests__/map.spec.ts`, `tests/test_map.py` or `tests/MapTest.php`.
- **Caps:** `max-test-suggestions` (default 5, max 10), 6,000 characters of code per suggestion (longer ones are
  dropped), 10 files and 40 KB of patch per request, and the request counts against `max-diff-bytes`.
- **No repeats:** a file whose patch has not changed since its suggestions were posted is not sent again, and a
  suggestion with an already-posted title is dropped.
- Suggestions are drafted from the diff alone and **never run**. Check imports and fixtures before using them.

See [ADR-0004](docs/adr/0004-test-suggestions-in-the-summary.md) for the reasoning.

## Roadmap

| Milestone | Scope                                                                                                                                                                  | Status  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0         | README, ADRs, licence                                                                                                                                                  | Done    |
| 1         | TypeScript action skeleton: `action.yml`, inputs, vitest, eslint, esbuild bundle in `dist/`, CI that verifies `dist/` is current                                       | Done    |
| 2         | Review engine: fetch diff, filter, chunk, provider interface (Anthropic, OpenAI, Ollama), strict JSON findings, diff-line mapping, single review, cost guardrails      | Done    |
| 3         | `.github/ai-review.yml` config (rules, threshold, ignore paths), no duplicate comments on re-runs                                                                      | Done    |
| 4         | Dogfood with a live model on this repo and on [loan-underwriting-ai](https://github.com/adilKhan72/loan-underwriting-ai). Publish real review examples and cost per PR | Planned |
| 5         | Opt-in test suggestions: unit tests in the detected framework (vitest/jest/pytest/PHPUnit) and Playwright specs for changed UI files, in the review summary            | Done    |
| 6         | `v1.0.0` release, moving `v1` tag, changelog, release checklist. Marketplace listing is a manual step for the owner                                                    | Done    |

## Development

```bash
npm ci
npm run all      # prettier check, eslint, tsc, vitest, esbuild bundle
```

The action runs from the committed bundle `dist/index.cjs` on the `node24` runtime. CI rebuilds it and fails if
the committed copy is stale. A `self-test` job then runs the bundle as a real action (`uses: ./`) against the PR
itself, with real GitHub API calls and a mock model server (`scripts/mock-ollama.mjs`), in dry-run mode.

**Not yet run against a live model.** No provider key is available to this project yet, so every provider test
uses a mocked SDK client or `fetch` and asserts the exact request shape. Live dogfooding is Milestone 4.

Releases follow [docs/release-checklist.md](docs/release-checklist.md). Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

## Architecture decisions

- [ADR-0001: Comment only on diff lines](docs/adr/0001-comment-only-on-diff-lines.md)
- [ADR-0002: Pluggable providers with native structured output](docs/adr/0002-pluggable-providers-with-native-structured-output.md)
- [ADR-0003: The diff is untrusted input](docs/adr/0003-diff-is-untrusted-input.md)
- [ADR-0004: Test suggestions are opt-in and only shown in the summary](docs/adr/0004-test-suggestions-in-the-summary.md)

## Licence

[MIT](LICENSE) © 2026 Adil Khan
