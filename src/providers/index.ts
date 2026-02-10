import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import type { Provider } from "./types.js";

export type { Provider };

export const providers: Record<string, Provider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
};
