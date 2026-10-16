# Changelog

All notable changes to this action are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/):
the inputs, outputs and review format in `action.yml` and the README are the public API.

Consumers can pin `@v1` (moves to every 1.x release) or a full commit SHA (never moves). See the README.

## [Unreleased]

## [1.0.0] - 2026-10-15

First stable release.

### Added

- **Review engine.** Fetches PR files and patches through the REST API (no checkout). It then applies
  include/exclude globs and size guardrails, groups whole files into requests of about 60 KB, and posts one
  `COMMENT` review pinned to the head SHA.
- **Diff-anchored findings** ([ADR-0001](docs/adr/0001-comment-only-on-diff-lines.md)). An inline comment is only
  posted on a line that GitHub accepts. Other findings go to the summary. If the anchors are rejected (`422`), the
  action posts the review again with everything in the summary.
- **Providers** ([ADR-0002](docs/adr/0002-pluggable-providers-with-native-structured-output.md)): Anthropic (default,
  `claude-opus-5-5`, structured output, explicit effort, server-side refusal fallback), OpenAI (strict
  `json_schema`) and Ollama (`format` schema, temperature 0). Refusal and truncation map to typed errors. Every
  answer is validated a second time against one shared schema.
- **Untrusted-input handling** ([ADR-0003](docs/adr/0003-diff-is-untrusted-input.md)). PR text and diffs sit
  between random-nonce markers. The action never approves or requests changes.
- **Repository config** `.github/ai-review.yml` (rules, min-severity, include, exclude, max-files), read from the
  PR's base commit.
- **De-duplication across runs.** Hidden fingerprints (path + normalised title + flagged line text). Only comments
  by `reviewer-login` are trusted. When there is nothing new, nothing is posted.
- **Opt-in test suggestions** ([ADR-0004](docs/adr/0004-test-suggestions-in-the-summary.md)). `suggest-tests: true`
  asks for unit tests in the detected framework (vitest, jest, pytest, PHPUnit). It also asks for Playwright specs
  for changed UI files when Playwright is configured. Suggestions are shown in the summary and never committed.
- Inputs: `provider`, `model`, `api-key`, `base-url`, `effort`, `github-token`, `include`, `exclude`,
  `no-default-excludes`, `max-files`, `max-diff-bytes`, `max-file-bytes`, `max-output-tokens`, `min-severity`,
  `skip-draft`, `dry-run`, `config-path`, `reviewer-login`, `suggest-tests`, `max-test-suggestions`.
- Outputs: `status`, `inline-comments`, `summary-findings`, `test-suggestions`, `review-url`.

### Known limitations

- Every provider test uses a mock. As of this release the action has **not been run against a live model**.
  Review quality and cost per PR are unmeasured until Milestone 4 (live dogfooding).
- Pull requests from forks do not receive secrets under `pull_request`.

[Unreleased]: https://github.com/adilKhan72/ai-code-review-action/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/adilKhan72/ai-code-review-action/releases/tag/v1.0.0
