# ADR-0002: Pluggable providers with native structured output

- Status: Accepted
- Date: 2026-10-15

## Context

Teams have different constraints. Some need a frontier model, some already pay for OpenAI, and some cannot send
code to a third party at all. Asking a model to "reply in JSON" in free text breaks often enough to matter in CI.

## Decision

- One small interface: `Provider.complete({system, user, schema, maxOutputTokens}) → {json, usage, model}`.
  Adapters map vendor-specific refusal and truncation signals to one typed `ProviderError`. Validating the JSON
  into findings is shared code, not per-vendor. The rest of the pipeline never sees vendor types.
- Adapters:
  - **Anthropic** (default) through the official `@anthropic-ai/sdk`. Default model `claude-opus-5-5`, structured
    output through `output_config.format` (JSON schema), and effort set explicitly. It uses the server-side
    refusal fallback (`fallbacks: "default"`) and checks `stop_reason` for `refusal` / `max_tokens` before
    reading content.
  - **OpenAI** through `fetch` and `response_format: json_schema` with `strict: true`.
  - **Ollama** through `fetch` and `format: <schema>`, for fully self-hosted review.
- Every adapter receives the **same JSON schema**. Its output is parsed again by our own strict validator, because
  a schema-constrained answer can still be semantically invalid (unknown path, line 0).
- Tests mock the SDK client and `fetch` and assert the exact request shape. CI needs no network and no keys.

## Consequences

- Adding a provider means one file and one test file.
- The OpenAI and Ollama adapters avoid SDK dependencies, which keeps the bundled `dist/` small. The cost is that
  we maintain their small request/response types by hand.
- Providers differ in schema support (for example, OpenAI strict mode requires every property in `required`).
  The shared schema is written to the strictest common subset.
