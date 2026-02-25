import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export interface Provider {
  name: string;
  routes: string[];
  register(app: FastifyInstance, ctx: AppContext): void;
}
