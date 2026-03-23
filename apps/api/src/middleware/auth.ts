import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { prisma } from "@bidwright/db";
import { createApiStore, type PrismaApiStore } from "../prisma-store.js";
import { validateSession } from "../services/auth-service.js";

// ---------------------------------------------------------------------------
// Type augmentation — every request gets user + org-scoped store
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    user: {
      id: string;
      role: string;
      email: string;
      name: string;
      organizationId: string | null;
      isSuperAdmin: boolean;
      impersonating: boolean;
    } | null;
    store: PrismaApiStore | null;
  }
}

// ---------------------------------------------------------------------------
// Public route prefixes (no auth required)
// ---------------------------------------------------------------------------

const PUBLIC_PREFIXES = ["/api/auth/", "/auth/", "/health"];

// Setup routes that must work without authentication
const PUBLIC_EXACT_ROUTES = [
  "/api/setup/status",
  "/api/setup/init",
  "/api/setup/seed-essentials",
];

function isPublicRoute(url: string): boolean {
  // Strip query string for matching
  const path = url.split("?")[0];
  if (PUBLIC_EXACT_ROUTES.includes(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Plugin (register with fastify.register(authPlugin))
// ---------------------------------------------------------------------------

async function authPluginImpl(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest("user", null);
  fastify.decorateRequest("store", null);

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip authentication for public routes
    if (isPublicRoute(request.url)) {
      return;
    }

    const authHeader = request.headers.authorization;
    // Also support ?token= query param for img/embed URLs that can't send headers
    const queryToken = (request.query as Record<string, string>)?.token;
    if (!authHeader?.startsWith("Bearer ") && !queryToken) {
      return reply.code(401).send({ error: "Missing or invalid Authorization header" });
    }

    const token = queryToken || authHeader!.slice(7);
    const validated = await validateSession(prisma, token);

    if (!validated) {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }

    const { session, user, superAdmin } = validated;

    if (user) {
      // Normal user session (or super admin impersonating — has userId set to null but org set)
      request.user = {
        id: user.id,
        role: user.role,
        email: user.email,
        name: user.name,
        organizationId: user.organizationId,
        isSuperAdmin: false,
        impersonating: false,
      };
      request.store = createApiStore(user.organizationId);
    } else if (superAdmin && session.organizationId) {
      // Super admin impersonating an org
      request.user = {
        id: superAdmin.id,
        role: "admin",
        email: superAdmin.email,
        name: superAdmin.name,
        organizationId: session.organizationId,
        isSuperAdmin: true,
        impersonating: true,
      };
      request.store = createApiStore(session.organizationId);
    } else if (superAdmin) {
      // Super admin without org context (admin dashboard only)
      request.user = {
        id: superAdmin.id,
        role: "admin",
        email: superAdmin.email,
        name: superAdmin.name,
        organizationId: null,
        isSuperAdmin: true,
        impersonating: false,
      };
      // No store — only /api/admin/* routes work
      request.store = null;
    } else {
      return reply.code(401).send({ error: "Invalid session" });
    }
  });
}

export const authPlugin = fp(authPluginImpl, { name: "auth-plugin" });
export default authPlugin;
