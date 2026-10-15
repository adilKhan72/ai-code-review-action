import type { TokenUsage } from '../types.js';

export interface CompletionRequest {
  system: string;
  user: string;
  /** JSON schema the answer must follow. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface CompletionResult {
  /** The parsed JSON answer. It has not been validated against the schema yet. */
  json: unknown;
  usage: TokenUsage | undefined;
  /** Model that actually answered. It can differ from the requested one after a server-side fallback. */
  model: string;
}

/** A vendor adapter. Everything vendor-specific stays behind this interface. */
export interface Provider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export type ProviderErrorKind = 'refusal' | 'truncated' | 'invalid_output' | 'http';

export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** POSTs JSON and returns the parsed body. Errors carry the status and a short excerpt of the body, never headers. */
export async function postJson(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError('http', `Request to ${new URL(url).host} failed: ${String(err)}`, { cause: err });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(
      'http',
      `HTTP ${response.status} from ${new URL(url).host}: ${text.slice(0, 300)}`,
    );
  }
  return response.json();
}
