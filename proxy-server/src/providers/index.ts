import { openaiProvider } from "./openai/provider.js";
import { claudeProvider } from "./claude/provider.js";
import { codexProvider } from "./codex/provider.js";
import type { Provider } from "./types.js";
import type { AppContext } from "../context.js";
import type { ServerConfig } from "../config-schema.js";
import { registerToolBridge } from "../tool-bridge/index.js";
import { PROVIDER_NAMES } from "copilot-sdk-proxy";
import type { ProviderName } from "copilot-sdk-proxy";

export type { ProviderName, ProviderMode } from "copilot-sdk-proxy";

export const providers: Record<ProviderName, Provider> = {
  openai: openaiProvider,
  claude: claudeProvider,
  codex: codexProvider,
};

export function createAutoProvider(
  configs: Record<ProviderName, ServerConfig>,
): Provider {
  return {
    name: "Auto",
    routes: Object.values(providers).flatMap((p) => p.routes),
    register(app, baseCtx) {
      // One shared manager + MCP route set so we don't hit
      // Fastify's duplicate-route error across scoped plugins
      const maxTimeout = Math.max(
        ...PROVIDER_NAMES.map((n) => configs[n].toolBridgeTimeoutMs),
      );
      const sharedManager = registerToolBridge(app, baseCtx.logger, maxTimeout);

      for (const name of PROVIDER_NAMES) {
        const provider = providers[name];
        const ctx: AppContext = {
          ...baseCtx,
          config: configs[name],
          toolBridgeManager: sharedManager,
        };
        app.register((scoped, _opts, done) => {
          provider.register(scoped, ctx);
          done();
        });
      }
    },
  };
}
