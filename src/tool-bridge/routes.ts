import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ConversationManager } from "../conversation-manager.js";
import type { Logger } from "../logger.js";
import { BRIDGE_SERVER_NAME } from "./constants.js";

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function jsonRpcResult(id: number | string, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonRpcError(id: number | string, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

// Pinned to the version the Copilot SDK's MCP client actually speaks
const PROTOCOL_VERSION = "2024-11-05";

// Xcode tools arrive with names like "mcp__xcode-tools__XcodeRead" but
// we need to strip that prefix, otherwise the CLI would expose them to
// the model as "xcode-bridge-mcp__xcode-tools__XcodeRead" which is ugly
// and wastes tokens.
const MCP_TOOL_PREFIX = /^mcp__[^_]+__/;
function stripMCPToolPrefix(name: string): string {
  return name.replace(MCP_TOOL_PREFIX, "");
}

export function registerRoutes(
  app: FastifyInstance,
  manager: ConversationManager,
  logger: Logger,
): void {
  // The SDK opens a GET SSE stream after initialize expecting server-initiated
  // messages. We don't push anything, so we just keep it open.
  app.get(
    "/mcp/:convId",
    (
      request: FastifyRequest<{ Params: { convId: string } }>,
      reply: FastifyReply,
    ) => {
      const { convId } = request.params;
      logger.debug(`MCP ${convId}: SSE stream opened`);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      request.raw.on("close", () => {
        logger.debug(`MCP ${convId}: SSE stream closed`);
      });
    },
  );

  app.post(
    "/mcp/:convId",
    async (
      request: FastifyRequest<{ Params: { convId: string } }>,
      reply: FastifyReply,
    ) => {
      const { convId } = request.params;
      const parsed = JsonRpcRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.send(jsonRpcError(0, -32700, "Parse error"));
      }
      const msg = parsed.data;

      logger.debug(`MCP ${convId}: method="${msg.method}", id=${String(msg.id)}`);

      // JSON-RPC notifications have no id, so there's nothing to respond to
      if (msg.id === undefined) {
        return reply.status(202).send();
      }

      const { id, method, params } = msg;

      switch (method) {
        case "initialize":
          return reply.send(
            jsonRpcResult(id, {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: BRIDGE_SERVER_NAME, version: "1.0.0" },
            }),
          );

        case "tools/list": {
          const state = manager.getState(convId);
          if (!state) {
            logger.warn(`MCP ${convId} tools/list: conversation not found`);
            return reply.send(jsonRpcError(id, -32603, "Conversation not found"));
          }
          const tools = state.getCachedTools().map((t) => ({
            name: stripMCPToolPrefix(t.name),
            description: t.description,
            inputSchema: t.input_schema,
          }));
          logger.debug(`MCP ${convId} tools/list: ${String(tools.length)} tools`);
          return reply.send(jsonRpcResult(id, { tools }));
        }

        case "tools/call": {
          const state = manager.getState(convId);
          if (!state) {
            logger.warn(`MCP ${convId} tools/call: conversation not found`);
            return reply.send(jsonRpcError(id, -32603, "Conversation not found"));
          }

          const name = params?.["name"] as string | undefined;
          const args = (params?.["arguments"] ?? {}) as Record<string, unknown>;

          if (!name) {
            return reply.send(jsonRpcError(id, -32602, "Missing tool name"));
          }

          const resolved = state.resolveToolName(name);
          if (resolved !== name) {
            logger.info(`MCP ${convId} tools/call: name="${name}" resolved to "${resolved}", args=${JSON.stringify(args)}`);
          } else {
            logger.info(`MCP ${convId} tools/call: name="${name}", args=${JSON.stringify(args)}`);
          }

          try {
            const result = await new Promise<string>((resolve, reject) => {
              state.registerMCPRequest(resolved, resolve, reject);
            });

            logger.info(`MCP ${convId} tools/call resolved: name="${name}"`);
            return await reply.send(
              jsonRpcResult(id, {
                content: [{ type: "text", text: result }],
              }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`MCP ${convId} tools/call error: ${message}`);
            return reply.send(jsonRpcError(id, -32603, message));
          }
        }

        default:
          return reply.send(jsonRpcError(id, -32601, `Method not found: ${method}`));
      }
    },
  );
}
