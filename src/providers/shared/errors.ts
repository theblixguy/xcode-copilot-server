import type { FastifyReply } from "fastify";

type ErrorType = "invalid_request_error" | "api_error";

export function sendOpenAIError(
  reply: FastifyReply,
  status: number,
  type: ErrorType,
  message: string,
): void {
  reply.status(status).send({ error: { message, type } });
}

export function sendAnthropicError(
  reply: FastifyReply,
  status: number,
  type: ErrorType,
  message: string,
): void {
  reply.status(status).send({
    type: "error",
    error: { type, message },
  });
}
