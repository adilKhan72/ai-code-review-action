import { InvalidOutputError, parseJsonText } from '../findings.js';
import {
  ProviderError,
  postJson,
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type Provider,
} from './types.js';

export interface OllamaOptions {
  model: string;
  baseUrl?: string | undefined;
  fetch?: FetchLike;
}

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Self-hosted models via Ollama's `/api/chat`, with the schema passed as `format` for constrained decoding. */
export class OllamaProvider implements Provider {
  readonly name = 'ollama';

  constructor(private readonly options: OllamaOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const base = (this.options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    const body = (await postJson(
      this.options.fetch ?? fetch,
      `${base}/api/chat`,
      {},
      {
        model: this.options.model,
        stream: false,
        format: request.schema,
        // Temperature 0: a reviewer should give the same answer for the same diff.
        options: { temperature: 0, num_predict: request.maxOutputTokens },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      },
    )) as OllamaChatResponse;

    if (body.done_reason === 'length') {
      throw new ProviderError('truncated', 'The answer hit max-output-tokens before it was complete.');
    }
    const content = body.message?.content;
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
      usage:
        body.prompt_eval_count !== undefined || body.eval_count !== undefined
          ? { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 }
          : undefined,
    };
  }
}
