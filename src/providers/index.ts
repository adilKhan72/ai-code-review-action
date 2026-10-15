import type { Config } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import type { Provider } from './types.js';

export function createProvider(config: Config): Provider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider({
        model: config.model,
        effort: config.effort,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    case 'openai':
      // readConfig guarantees a key for hosted providers.
      return new OpenAIProvider({
        model: config.model,
        apiKey: config.apiKey ?? '',
        baseUrl: config.baseUrl,
      });
    case 'ollama':
      return new OllamaProvider({ model: config.model, baseUrl: config.baseUrl });
  }
}
