import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { FINDINGS_SCHEMA } from '../src/findings.js';
import { AnthropicProvider, FALLBACK_BETA, type AnthropicLike } from '../src/providers/anthropic.js';
import { OllamaProvider } from '../src/providers/ollama.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { ProviderError, type CompletionRequest, type FetchLike } from '../src/providers/types.js';

const request: CompletionRequest = {
  system: 'SYS',
  user: 'USER',
  schema: FINDINGS_SCHEMA,
  maxOutputTokens: 4_000,
};
const answer = { findings: [{ path: 'a.ts', line: 1, severity: 'low', title: 't', body: 'b' }] };

function anthropicMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify(answer) },
    ],
    usage: { input_tokens: 1200, output_tokens: 300 },
    ...overrides,
  };
}

function fakeAnthropic(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { create } } } as unknown as AnthropicLike, create };
}

describe('AnthropicProvider', () => {
  it('sends structured output, explicit effort, adaptive thinking and the server-side refusal fallback', async () => {
    const { client, create } = fakeAnthropic(anthropicMessage());
    const provider = new AnthropicProvider({ model: 'claude-opus-5-5', effort: 'medium', client });
    await provider.complete(request);
    expect(create).toHaveBeenCalledWith({
      model: 'claude-opus-5-5',
      max_tokens: 4_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: FINDINGS_SCHEMA } },
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
    });
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
  });

  it('reads only text blocks, skipping thinking blocks, and reports usage and the serving model', async () => {
    const { client } = fakeAnthropic(anthropicMessage({ model: 'claude-opus-4-8' }));
    const result = await new AnthropicProvider({ model: 'claude-opus-5-5', effort: 'high', client }).complete(
      request,
    );
    expect(result).toEqual({
      json: answer,
      model: 'claude-opus-4-8',
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it('treats a refusal as an error before reading content', async () => {
    const { client } = fakeAnthropic(
      anthropicMessage({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: null },
        content: [{ type: 'text', text: '{"findings": []}' }],
      }),
    );
    const err = await new AnthropicProvider({ model: 'm', effort: 'low', client })
      .complete(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'refusal', message: expect.stringContaining('cyber') as unknown });
  });

  it('treats max_tokens as truncation even if the partial text parses', async () => {
    const { client } = fakeAnthropic(anthropicMessage({ stop_reason: 'max_tokens' }));
    await expect(
      new AnthropicProvider({ model: 'm', effort: 'low', client }).complete(request),
    ).rejects.toMatchObject({
      kind: 'truncated',
    });
  });

  it('reports non-JSON text as invalid output', async () => {
    const { client } = fakeAnthropic(
      anthropicMessage({ content: [{ type: 'text', text: 'Looks good to me!' }] }),
    );
    await expect(
      new AnthropicProvider({ model: 'm', effort: 'low', client }).complete(request),
    ).rejects.toMatchObject({
      kind: 'invalid_output',
    });
  });

  it('maps SDK API errors to http errors', async () => {
    const create = vi.fn().mockRejectedValue(new Anthropic.APIError(529, undefined, 'Overloaded', undefined));
    const client = { beta: { messages: { create } } } as unknown as AnthropicLike;
    await expect(
      new AnthropicProvider({ model: 'm', effort: 'low', client }).complete(request),
    ).rejects.toMatchObject({
      kind: 'http',
    });
  });
});

function fakeFetch(body: unknown, status = 200) {
  const fn = vi.fn<FetchLike>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  return fn;
}

function sentBody(fn: ReturnType<typeof fakeFetch>): unknown {
  const init = fn.mock.calls[0]?.[1];
  return init ? JSON.parse(init.body) : undefined;
}

describe('OpenAIProvider', () => {
  const ok = {
    model: 'gpt-x-2026',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer), refusal: null } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };

  it('posts chat completions with a strict json_schema response format', async () => {
    const fetch = fakeFetch(ok);
    const result = await new OpenAIProvider({ model: 'gpt-x', apiKey: 'sk-1', fetch }).complete(request);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(fetch.mock.calls[0]?.[1].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-1',
    });
    expect(sentBody(fetch)).toEqual({
      model: 'gpt-x',
      max_completion_tokens: 4_000,
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'review_findings', strict: true, schema: FINDINGS_SCHEMA },
      },
    });
    expect(result).toEqual({
      json: answer,
      model: 'gpt-x-2026',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('honours a custom base URL without doubling slashes', async () => {
    const fetch = fakeFetch(ok);
    await new OpenAIProvider({
      model: 'm',
      apiKey: 'k',
      baseUrl: 'https://gw.example.com/v1/',
      fetch,
    }).complete(request);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://gw.example.com/v1/chat/completions');
  });

  it('maps refusal and length to typed errors', async () => {
    const refusal = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }],
    });
    await expect(
      new OpenAIProvider({ model: 'm', apiKey: 'k', fetch: refusal }).complete(request),
    ).rejects.toMatchObject({
      kind: 'refusal',
    });
    const length = fakeFetch({ choices: [{ finish_reason: 'length', message: { content: '{"find' } }] });
    await expect(
      new OpenAIProvider({ model: 'm', apiKey: 'k', fetch: length }).complete(request),
    ).rejects.toMatchObject({
      kind: 'truncated',
    });
  });

  it('reports HTTP errors without leaking the API key', async () => {
    const fetch = fakeFetch({ error: { message: 'Incorrect API key' } }, 401);
    const err = await new OpenAIProvider({ model: 'm', apiKey: 'sk-secret', fetch })
      .complete(request)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'http', message: expect.stringContaining('HTTP 401') as unknown });
    expect((err as Error).message).not.toContain('sk-secret');
  });

  it('wraps network failures', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      new OpenAIProvider({ model: 'm', apiKey: 'k', fetch }).complete(request),
    ).rejects.toMatchObject({
      kind: 'http',
    });
  });
});

describe('OllamaProvider', () => {
  const ok = {
    model: 'qwen3-coder',
    message: { content: JSON.stringify(answer) },
    done_reason: 'stop',
    prompt_eval_count: 7,
    eval_count: 3,
  };

  it('posts /api/chat with the schema as format, no streaming, temperature 0', async () => {
    const fetch = fakeFetch(ok);
    const result = await new OllamaProvider({
      model: 'qwen3-coder',
      baseUrl: 'http://gpu:11434',
      fetch,
    }).complete(request);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://gpu:11434/api/chat');
    expect(sentBody(fetch)).toEqual({
      model: 'qwen3-coder',
      stream: false,
      format: FINDINGS_SCHEMA,
      options: { temperature: 0, num_predict: 4_000 },
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
    });
    expect(result).toEqual({
      json: answer,
      model: 'qwen3-coder',
      usage: { inputTokens: 7, outputTokens: 3 },
    });
  });

  it('defaults to localhost and flags truncation', async () => {
    const fetch = fakeFetch({ ...ok, done_reason: 'length' });
    await expect(new OllamaProvider({ model: 'm', fetch }).complete(request)).rejects.toMatchObject({
      kind: 'truncated',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/chat');
  });
});
