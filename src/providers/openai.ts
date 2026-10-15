import { InvalidOutputError, parseJsonText } from '../findings.js';
import {
  ProviderError,
  postJson,
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type Provider,
} from './types.js';

export interface OpenAIOptions {
  model: string;
  apiKey: string;
  baseUrl?: string | undefined;
  fetch?: FetchLike;
}

interface ChatCompletion {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI Chat Completions with strict JSON-schema output. Also works with compatible gateways via `base-url`. */
export class OpenAIProvider implements Provider {
  readonly name = 'openai';

  constructor(private readonly options: OpenAIOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const base = (this.options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const body = (await postJson(
      this.options.fetch ?? fetch,
      `${base}/chat/completions`,
      { authorization: `Bearer ${this.options.apiKey}` },
      {
        model: this.options.model,
        max_completion_tokens: request.maxOutputTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'review_findings', strict: true, schema: request.schema },
        },
      },
    )) as ChatCompletion;

    const choice = body.choices?.[0];
    if (choice?.message?.refusal) {
      throw new ProviderError(
        'refusal',
        `The model declined to review this chunk: ${choice.message.refusal}`,
      );
    }
    if (choice?.finish_reason === 'length') {
      throw new ProviderError('truncated', 'The answer hit max-output-tokens before it was complete.');
    }
    const content = choice?.message?.content;
    if (!content) throw new ProviderError('invalid_output', 'The response contained no message content.');

    let json: unknown;
    try {
      json = parseJsonText(content);
    } catch (err) {
      if (err instanceof InvalidOutputError) throw new ProviderError('invalid_output', err.message);
      throw err;
    }
    return {
      json,
      model: body.model ?? this.options.model,
      usage: body.usage
        ? { inputTokens: body.usage.prompt_tokens ?? 0, outputTokens: body.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }
}
