import Anthropic from '@anthropic-ai/sdk';
import type { Effort } from '../config.js';
import { InvalidOutputError, parseJsonText } from '../findings.js';
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider } from './types.js';

/** Beta that enables `fallbacks: "default"`: a refused request is retried server-side on a suitable model. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The SDK surface this adapter uses. Narrow, so tests can supply a fake without a network or a key. */
export interface AnthropicLike {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } };
}

export interface AnthropicOptions {
  model: string;
  effort: Effort;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  client?: AnthropicLike;
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private readonly client: AnthropicLike;

  constructor(private readonly options: AnthropicOptions) {
    this.client =
      options.client ??
      new Anthropic({
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.options.model,
        max_tokens: request.maxOutputTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: {
          // Set explicitly: Opus 5.5 defaults to medium, other models to high.
          effort: this.options.effort,
          format: { type: 'json_schema', schema: request.schema },
        },
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError('http', `Anthropic API error ${String(err.status)}: ${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }

    // stop_reason must be checked before content is read. A refusal or truncation can still carry partial
    // text that looks like JSON.
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category ?? 'unspecified';
      throw new ProviderError('refusal', `The model declined to review this chunk (category: ${category}).`);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ProviderError('truncated', 'The answer hit max-output-tokens before it was complete.');
    }

    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (!text) throw new ProviderError('invalid_output', 'The response contained no text block.');

    let json: unknown;
    try {
      json = parseJsonText(text);
    } catch (err) {
      if (err instanceof InvalidOutputError) throw new ProviderError('invalid_output', err.message);
      throw err;
    }
    return {
      json,
      model: message.model,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
