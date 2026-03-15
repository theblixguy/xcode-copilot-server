import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ToolStateProvider } from "../conversation-manager.js";
import type { Logger } from "copilot-sdk-proxy";
import { BRIDGE_SERVER_NAME } from "../bridge-constants.js";
import { isRecord } from "../utils/type-guards.js";
import {
  JSONRPC_PARSE_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INTERNAL_ERROR,
} from "./constants.js";

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function jsonRpcResult(id: number | string, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

// Pinned to the version the Copilot SDK's MCP client actually speaks
const PROTOCOL_VERSION = "2024-11-05";

// Strip Xcode's MCP prefix so the model sees clean tool names instead of
// double-prefixed ones like "xcode-bridge-mcp__xcode-tools__XcodeRead".
const MCP_TOOL_PREFIX = /^mcp__[^_]+__/;
function stripMCPToolPrefix(name: string): string {
  return name.replace(MCP_TOOL_PREFIX, "");
}

export function registerRoutes(
  app: FastifyInstance,
  stateProvider: ToolStateProvider,
  logger: Logger,
): void {
  // The SDK opens this SSE stream after initialize. We don't push anything, just keep it open.
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
        return reply.send(
          jsonRpcError(null, JSONRPC_PARSE_ERROR, "Parse error"),
        );
      }
      const msg = parsed.data;

      logger.debug(
        `MCP ${convId}: method="${msg.method}", id=${String(msg.id)}`,
      );

      if (msg.id === undefined) {
        logger.debug(
          `MCP ${convId}: notification method="${msg.method}", ignoring`,
        );
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
          const state = stateProvider.getState(convId);
          if (!state) {
            logger.warn(`MCP ${convId} tools/list: conversation not found`);
            return reply.send(
              jsonRpcError(
                id,
                JSONRPC_INTERNAL_ERROR,
                "Conversation not found",
              ),
            );
          }
          const tools = state.toolCache.getCachedTools().map((t) => ({
            name: stripMCPToolPrefix(t.name),
            description: t.description,
            inputSchema: t.input_schema,
          }));
          logger.debug(
            `MCP ${convId} tools/list: ${String(tools.length)} tools`,
          );
          return reply.send(jsonRpcResult(id, { tools }));
        }

        case "tools/call": {
          const state = stateProvider.getState(convId);
          if (!state) {
            logger.warn(`MCP ${convId} tools/call: conversation not found`);
            return reply.send(
              jsonRpcError(
                id,
                JSONRPC_INTERNAL_ERROR,
                "Conversation not found",
              ),
            );
          }

          const rawName = params?.["name"];
          const name = typeof rawName === "string" ? rawName : undefined;
          const rawArgs = params?.["arguments"];
          const args: Record<string, unknown> = isRecord(rawArgs)
            ? rawArgs
            : {};

          if (!name) {
            return reply.send(
              jsonRpcError(id, JSONRPC_INVALID_PARAMS, "Missing tool name"),
            );
          }

          const resolved = state.toolCache.resolveToolName(name);
          if (resolved !== name) {
            logger.info(
              `MCP ${convId} tools/call: name="${name}" resolved to "${resolved}", args=${JSON.stringify(args)}`,
            );
          } else {
            logger.info(
              `MCP ${convId} tools/call: name="${name}", args=${JSON.stringify(args)}`,
            );
          }

          try {
            const result = await new Promise<string>((resolve, reject) => {
              state.toolRouter.registerMCPRequest(resolved, resolve, reject);
            });

            logger.info(`MCP ${convId} tools/call resolved: name="${name}"`);
            return await reply.send(
              jsonRpcResult(id, {
                content: [{ type: "text", text: result }],
              }),
            );
          } catch (err) {
            logger.debug(`MCP ${convId} tools/call error details:`, err);
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`MCP ${convId} tools/call error: ${message}`);
            return reply.send(
              jsonRpcError(id, JSONRPC_INTERNAL_ERROR, message),
            );
          }
        }

        default:
          return reply.send(
            jsonRpcError(
              id,
              JSONRPC_METHOD_NOT_FOUND,
              `Method not found: ${method}`,
            ),
          );
      }
    },
  );
}
