import type { Provider } from "../types.js";
import { createModelsHandler, createCompletionsHandler } from "copilot-sdk-proxy";
import { resolveToolBridgeManager } from "../../tool-bridge/index.js";
import { filterExcludedFiles } from "../shared/prompt-utils.js";
import { addUserAgentGuard } from "../shared/user-agent-guard.js";
import { UA_PREFIXES } from "../names.js";

export const openaiProvider = {
  name: "OpenAI",
  routes: ["GET /v1/models", "POST /v1/chat/completions"],

  register(app, ctx) {
    addUserAgentGuard(app, UA_PREFIXES.openai, ctx.logger);

    const manager = resolveToolBridgeManager(app, ctx.toolBridgeManager, ctx.logger);
    app.get("/v1/models", createModelsHandler(ctx));
    app.post("/v1/chat/completions", createCompletionsHandler(ctx, manager, {
      transformPrompt: (prompt) => filterExcludedFiles(prompt, ctx.config.excludedFilePatterns),
    }));
  },
} satisfies Provider;
