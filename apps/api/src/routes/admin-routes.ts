import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@bidwright/db";
import {
  hashPassword,
  createSuperAdminSession,
  revokeSession,
} from "../services/auth-service.js";
import { datasetLibrary, catalogLibrary } from "../prisma-store.js";
import { getSessionCookieToken, setSessionCookie } from "../services/session-cookie.js";

// ---------------------------------------------------------------------------
// Guard: require super admin
// ---------------------------------------------------------------------------

function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.user?.isSuperAdmin) {
    reply.code(403).send({ error: "Super admin access required" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Admin routes — super admin only
// ---------------------------------------------------------------------------

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/admin/organizations ──────────────────────────────────────
  fastify.get("/api/admin/organizations", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    try {
      const orgs = await prisma.organization.findMany({
        include: {
          _count: { select: { users: true, projects: true, knowledgeBooks: true } },
          settings: {
            select: { maxUsers: true, maxProjects: true, maxStorage: true, maxKnowledgeBooks: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return orgs.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
        userCount: org._count.users,
        projectCount: org._count.projects,
        knowledgeBookCount: org._count.knowledgeBooks,
        limits: org.settings
          ? {
              maxUsers: org.settings.maxUsers,
              maxProjects: org.settings.maxProjects,
              maxStorage: org.settings.maxStorage,
              maxKnowledgeBooks: org.settings.maxKnowledgeBooks,
            }
          : { maxUsers: 0, maxProjects: 0, maxStorage: 0, maxKnowledgeBooks: 0 },
      }));
    } catch (error) {
      request.log.error(error, "Failed to list organizations");
      return reply.code(500).send({ error: "Failed to list organizations" });
    }
  });

  // ── POST /api/admin/organizations ─────────────────────────────────────
  fastify.post("/api/admin/organizations", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { name, slug: rawSlug, adminEmail, adminName, adminPassword } = request.body as {
      name: string;
      slug?: string;
      adminEmail?: string;
      adminName?: string;
      adminPassword?: string;
    };

    if (!name) return reply.code(400).send({ error: "name is required" });

    const slug = (rawSlug || name).toLowerCase().replace(/[^a-z0-9-]/g, "-");

    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) return reply.code(409).send({ error: "Organization slug already taken" });

    const result = await prisma.$transaction(async (tx: any) => {
      const org = await tx.organization.create({ data: { name, slug } });
      await tx.organizationSettings.create({
        data: {
          organizationId: org.id,
          general: { companyName: name },
        },
      });

      let user = null;
      if (adminEmail && adminName) {
        user = await tx.user.create({
          data: {
            organizationId: org.id,
            email: adminEmail.toLowerCase().trim(),
            name: adminName,
            role: "admin",
            active: true,
            passwordHash: adminPassword ? await hashPassword(adminPassword) : "",
          },
        });
      }

      return { org, user };
    });

    reply.code(201);
    return {
      organization: {
        id: result.org.id,
        name: result.org.name,
        slug: result.org.slug,
        createdAt: result.org.createdAt.toISOString(),
      },
      adminUser: result.user
        ? { id: result.user.id, email: result.user.email, name: result.user.name }
        : null,
    };
  });

  // ── PATCH /api/admin/organizations/:orgId ─────────────────────────────
  fastify.patch("/api/admin/organizations/:orgId", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { orgId } = request.params as { orgId: string };
    const { name, slug } = request.body as { name?: string; slug?: string };

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    const data: any = {};
    if (name) data.name = name;
    if (slug) {
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const existing = await prisma.organization.findFirst({ where: { slug: cleanSlug, id: { not: orgId } } });
      if (existing) return reply.code(409).send({ error: "Slug already taken" });
      data.slug = cleanSlug;
    }

    const updated = await prisma.organization.update({ where: { id: orgId }, data });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  // ── DELETE /api/admin/organizations/:orgId ─────────────────────────────
  fastify.delete("/api/admin/organizations/:orgId", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { orgId } = request.params as { orgId: string };
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    await prisma.organization.delete({ where: { id: orgId } });
    return { ok: true, deleted: { id: org.id, name: org.name, slug: org.slug } };
  });

  // ── GET /api/admin/organizations/:orgId/users ─────────────────────────
  fastify.get("/api/admin/organizations/:orgId/users", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { orgId } = request.params as { orgId: string };
    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      organizationId: u.organizationId,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
  });

  // ── PATCH /api/admin/organizations/:orgId/limits ────────────────────
  fastify.patch("/api/admin/organizations/:orgId/limits", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { orgId } = request.params as { orgId: string };
    const { maxUsers, maxProjects, maxStorage, maxKnowledgeBooks } = request.body as {
      maxUsers?: number;
      maxProjects?: number;
      maxStorage?: number;
      maxKnowledgeBooks?: number;
    };

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    const data: Record<string, number> = {};
    if (maxUsers !== undefined) data.maxUsers = maxUsers;
    if (maxProjects !== undefined) data.maxProjects = maxProjects;
    if (maxStorage !== undefined) data.maxStorage = maxStorage;
    if (maxKnowledgeBooks !== undefined) data.maxKnowledgeBooks = maxKnowledgeBooks;

    const settings = await prisma.organizationSettings.upsert({
      where: { organizationId: orgId },
      update: data,
      create: {
        organizationId: orgId,
        ...data,
      },
    });

    return {
      maxUsers: settings.maxUsers,
      maxProjects: settings.maxProjects,
      maxStorage: settings.maxStorage,
      maxKnowledgeBooks: settings.maxKnowledgeBooks,
    };
  });

  // ── POST /api/admin/organizations/:orgId/users ──────────────────────
  // Add a user to an organization
  fastify.post("/api/admin/organizations/:orgId/users", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { orgId } = request.params as { orgId: string };
    const { email, name, role, password } = request.body as {
      email: string;
      name: string;
      role?: string;
      password?: string;
    };

    if (!email || !name) return reply.code(400).send({ error: "email and name are required" });

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    // Check limits
    const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: orgId } });
    if (settings?.maxUsers && settings.maxUsers > 0) {
      const currentCount = await prisma.user.count({ where: { organizationId: orgId } });
      if (currentCount >= settings.maxUsers) {
        return reply.code(400).send({ error: `Organization has reached its user limit (${settings.maxUsers})` });
      }
    }

    // Check if user already exists in this org
    const existing = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId: orgId, email: email.toLowerCase().trim() } },
    });
    if (existing) return reply.code(409).send({ error: "User already exists in this organization" });

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: email.toLowerCase().trim(),
        name,
        role: role ?? "estimator",
        active: true,
        passwordHash: password ? await hashPassword(password) : "",
      },
    });

    reply.code(201);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      organizationId: user.organizationId,
      createdAt: user.createdAt.toISOString(),
    };
  });

  // ── PATCH /api/admin/users/:userId ──────────────────────────────────
  // Update any user (role, active, name, email)
  fastify.patch("/api/admin/users/:userId", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { userId } = request.params as { userId: string };
    const patch = request.body as {
      name?: string;
      email?: string;
      role?: string;
      active?: boolean;
      password?: string;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "User not found" });

    const data: Record<string, any> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.email !== undefined) data.email = patch.email.toLowerCase().trim();
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.password) data.passwordHash = await hashPassword(patch.password);

    const updated = await prisma.user.update({ where: { id: userId }, data });
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      active: updated.active,
      organizationId: updated.organizationId,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    };
  });

  // ── DELETE /api/admin/users/:userId ─────────────────────────────────
  fastify.delete("/api/admin/users/:userId", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { userId } = request.params as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "User not found" });

    await prisma.user.delete({ where: { id: userId } });
    return { ok: true, deleted: { id: user.id, email: user.email, name: user.name } };
  });

  // ── POST /api/admin/users/:userId/move ──────────────────────────────
  // Move a user to a different organization
  fastify.post("/api/admin/users/:userId/move", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { userId } = request.params as { userId: string };
    const { organizationId } = request.body as { organizationId: string };

    if (!organizationId) return reply.code(400).send({ error: "organizationId is required" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "User not found" });

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return reply.code(404).send({ error: "Target organization not found" });

    // Check if email already exists in target org
    const existing = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId, email: user.email } },
    });
    if (existing) return reply.code(409).send({ error: "User with this email already exists in the target organization" });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { organizationId },
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      active: updated.active,
      organizationId: updated.organizationId,
    };
  });

  // ── GET /api/admin/my-memberships ───────────────────────────────────
  // Return org IDs where the super admin's email exists as a User
  fastify.get("/api/admin/my-memberships", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const adminEmail = request.user!.email;
    const memberships = await prisma.user.findMany({
      where: { email: adminEmail },
      select: { organizationId: true },
    });

    return { organizationIds: memberships.map((m) => m.organizationId) };
  });

  // ── POST /api/admin/impersonate ────────────────────────────────────────
  fastify.post("/api/admin/impersonate", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const { organizationId } = request.body as { organizationId: string };
    if (!organizationId) return reply.code(400).send({ error: "organizationId is required" });

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    const token = await createSuperAdminSession(prisma, {
      superAdminId: request.user!.id,
      organizationId: org.id,
      userAgent: request.headers["user-agent"] ?? "",
    });
    setSessionCookie(reply, token);

    return {
      token,
      organization: { id: org.id, name: org.name, slug: org.slug },
    };
  });

  // ── POST /api/admin/stop-impersonation ─────────────────────────────────
  fastify.post("/api/admin/stop-impersonation", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;

    const currentToken =
      getSessionCookieToken(request) ||
      (request.headers.authorization ?? "").replace("Bearer ", "");
    if (currentToken) {
      await revokeSession(prisma, currentToken);
    }

    const token = await createSuperAdminSession(prisma, {
      superAdminId: request.user!.id,
      userAgent: request.headers["user-agent"] ?? "",
    });
    setSessionCookie(reply, token);

    return { ok: true };
  });

  // ── Dataset Library (Templates) ──────────────────────────────────────

  // GET /api/admin/datasets — list all template datasets
  fastify.get("/api/admin/datasets", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    try {
      return await datasetLibrary.listTemplates();
    } catch (error) {
      request.log.error(error, "Failed to list dataset templates");
      return reply.code(500).send({ error: "Failed to list dataset templates" });
    }
  });

  // POST /api/admin/datasets — create a template dataset
  fastify.post("/api/admin/datasets", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { name, description, category, columns, source, sourceDescription } = request.body as any;
    if (!name || !category || !columns?.length) {
      return reply.code(400).send({ error: "name, category, and columns are required" });
    }
    try {
      const template = await datasetLibrary.createTemplate({
        name,
        description: description ?? "",
        category,
        columns,
        source,
        sourceDescription,
      });
      reply.code(201);
      return template;
    } catch (error) {
      request.log.error(error, "Failed to create dataset template");
      return reply.code(500).send({ error: "Failed to create dataset template" });
    }
  });

  // GET /api/admin/datasets/:id — get template with paginated rows
  fastify.get("/api/admin/datasets/:id", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const { limit, offset, filter } = request.query as { limit?: string; offset?: string; filter?: string };

    try {
      const template = await datasetLibrary.getTemplate(id);
      if (!template) return reply.code(404).send({ error: "Template not found" });
      const { rows, total } = await datasetLibrary.getTemplateRows(
        id,
        Number(limit) || 100,
        Number(offset) || 0,
        filter,
      );
      return { ...template, rows, total };
    } catch (error) {
      request.log.error(error, "Failed to get dataset template");
      return reply.code(500).send({ error: "Failed to get dataset template" });
    }
  });

  // PATCH /api/admin/datasets/:id — update template metadata
  fastify.patch("/api/admin/datasets/:id", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const patch = request.body as any;

    try {
      return await datasetLibrary.updateTemplate(id, patch);
    } catch (error: any) {
      if (error.message?.includes("not found")) return reply.code(404).send({ error: error.message });
      request.log.error(error, "Failed to update dataset template");
      return reply.code(500).send({ error: "Failed to update dataset template" });
    }
  });

  // DELETE /api/admin/datasets/:id — delete template + rows
  fastify.delete("/api/admin/datasets/:id", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { id } = request.params as { id: string };

    try {
      await datasetLibrary.deleteTemplate(id);
      return { ok: true };
    } catch (error: any) {
      if (error.message?.includes("not found")) return reply.code(404).send({ error: error.message });
      request.log.error(error, "Failed to delete dataset template");
      return reply.code(500).send({ error: "Failed to delete dataset template" });
    }
  });

  // ── Admin Catalog Template Management ─────────────────────────────────

  fastify.get("/api/admin/catalogs", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    try {
      return await catalogLibrary.listTemplates();
    } catch (error: any) {
      request.log.error(error, "Failed to list catalog templates");
      return reply.code(500).send({ error: "Failed to list catalog templates" });
    }
  });

  fastify.post("/api/admin/catalogs", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const body = request.body as { name: string; description?: string; kind?: string; source?: string; sourceDescription?: string };
    if (!body.name) return reply.code(400).send({ error: "name is required" });
    try {
      const catalog = await catalogLibrary.createTemplate({
        name: body.name,
        description: body.description ?? "",
        kind: body.kind ?? "materials",
        source: body.source,
        sourceDescription: body.sourceDescription,
      });
      reply.code(201);
      return catalog;
    } catch (error: any) {
      request.log.error(error, "Failed to create catalog template");
      return reply.code(500).send({ error: "Failed to create catalog template" });
    }
  });

  fastify.get("/api/admin/catalogs/:id", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; offset?: string; filter?: string };
    const limit = parseInt(query.limit || "100", 10);
    const offset = parseInt(query.offset || "0", 10);
    try {
      const template = await catalogLibrary.getTemplate(id);
      if (!template) return reply.code(404).send({ error: "Catalog template not found" });
      const { items, total } = await catalogLibrary.getTemplateItems(id, limit, offset, query.filter);
      return { ...template, items, total };
    } catch (error: any) {
      request.log.error(error, "Failed to get catalog template");
      return reply.code(500).send({ error: "Failed to get catalog template" });
    }
  });

  fastify.patch("/api/admin/catalogs/:id", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; kind?: string; sourceDescription?: string };
    try {
      return await catalogLibrary.updateTemplate(id, body as any);
    } catch (error: any) {
      if (error.message?.includes("not found")) return reply.code(404).send({ error: error.message });
      request.log.error(error, "Failed to update catalog template");
      return reply.code(500).send({ error: "Failed to update catalog template" });
    }
  });

  fastify.delete("/api/admin/catalogs/:id", async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    try {
      await catalogLibrary.deleteTemplate(id);
      return { ok: true };
    } catch (error: any) {
      if (error.message?.includes("not found")) return reply.code(404).send({ error: error.message });
      request.log.error(error, "Failed to delete catalog template");
      return reply.code(500).send({ error: "Failed to delete catalog template" });
    }
  });
}
