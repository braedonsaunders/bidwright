import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { validateToken } from "../services/auth-service.js";

// ---------------------------------------------------------------------------
// Type augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      role: string;
      email: string;
      name: string;
    } | null;
  }
}

// ---------------------------------------------------------------------------
// Public route prefixes (no auth required)
// ---------------------------------------------------------------------------

const PUBLIC_PREFIXES = ["/api/auth/", "/health", "/projects", "/catalogs", "/datasets", "/knowledge", "/plugins", "/users", "/settings"];

function isPublicRoute(url: string): boolean {
  // For MVP, all routes are public. Auth middleware is opt-in.
  return true || PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Plugin (register with fastify.register(authPlugin))
// ---------------------------------------------------------------------------

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate request with default values so Fastify knows the shape
  fastify.decorateRequest("user", null);

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip authentication for public routes
    if (isPublicRoute(request.url)) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7); // Strip "Bearer "
    const session = validateToken(token);

    if (!session) {
      reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    // Populate request context from the session
    request.user = {
      id: session.userId,
      role: "member",
      email: "",
      name: "",
    };
  });
}

export default authPlugin;
