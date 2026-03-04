// Fastify supports listen({ fd }) at runtime but the types don't include it yet.
import "fastify";

declare module "fastify" {
  interface FastifyListenOptions {
    fd?: number;
  }
}
