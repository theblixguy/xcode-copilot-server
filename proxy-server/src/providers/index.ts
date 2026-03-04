import { openaiProvider } from "./openai/provider.js";
import { claudeProvider } from "./claude/provider.js";
import { codexProvider } from "./codex/provider.js";
import type { Provider } from "./types.js";
import type { AppContext } from "../context.js";
import type { ServerConfig } from "../config-schema.js";
import { registerToolBridge } from "../tool-bridge/index.js";
import { PROVIDER_NAMES } from "./names.js";
import type { ProxyName } from "./names.js";

export type { ProxyName, ProxyMode } from "./names.js";

export const providers: Record<ProxyName, Provider> = {
  openai: openaiProvider,
  claude: claudeProvider,
  codex: codexProvider,
};

export function createAutoProvider(
  configs: Record<ProxyName, ServerConfig>,
): Provider {
  return {
    name: "Auto",
    routes: Object.values(providers).flatMap((p) => p.routes),
    register(app, baseCtx) {
      // One shared manager + MCP route set so we don't hit
      // Fastify's duplicate-route error across scoped plugins
      const sharedManager = registerToolBridge(app, baseCtx.logger);

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
