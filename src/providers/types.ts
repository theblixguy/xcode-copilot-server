import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export interface Provider {
  name: string;
  // Shown in the startup log so you can see which routes are active.
  routes: string[];
  register(app: FastifyInstance, ctx: AppContext): void;
}
