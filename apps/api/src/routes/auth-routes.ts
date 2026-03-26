import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma, seedAllForOrganization, seedEntityCategories } from "@bidwright/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  createSuperAdminSession,
  revokeSession,
  validateSession,
} from "../services/auth-service.js";
import { clearSessionCookie, getSessionCookieToken, setSessionCookie } from "../services/session-cookie.js";

// ---------------------------------------------------------------------------
// Helper: strip passwordHash from user records
// ---------------------------------------------------------------------------

function safeUser(user: any) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function orgSettingsPayload(orgName: string) {
  return { companyName: orgName };
}

// ---------------------------------------------------------------------------
// Auth routes — public + authenticated
// ---------------------------------------------------------------------------

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/auth/login ───────────────────────────────────────────────
  fastify.post("/api/auth/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as { email: string; password?: string };
    if (!email) return reply.code(400).send({ error: "Email is required" });
    if (!password) return reply.code(400).send({ error: "Password is required" });

    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email across all orgs
    const users = await prisma.user.findMany({
      where: { email: normalizedEmail, active: true },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    // Also check if this email belongs to a super admin
    const superAdmin = await prisma.superAdmin.findUnique({
      where: { email: normalizedEmail },
    });

    // If no org users found, try super admin login
    if (users.length === 0) {
      if (!superAdmin || !superAdmin.active) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const valid = await verifyPassword(password, superAdmin.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      // Super admin with no org user — auto-impersonate the first org if one exists
      const firstOrg = await prisma.organization.findFirst({
        select: { id: true, name: true, slug: true },
        orderBy: { createdAt: "asc" },
      });

      const token = await createSuperAdminSession(prisma, {
        superAdminId: superAdmin.id,
        organizationId: firstOrg?.id,
        userAgent: request.headers["user-agent"] ?? "",
      });
      setSessionCookie(reply, token);

      return {
        token,
        user: { id: superAdmin.id, email: superAdmin.email, name: superAdmin.name, role: "admin", active: true },
        organization: firstOrg ?? null,
        isSuperAdmin: true,
      };
    }

    // Org user found — verify password through loginUser
    let targetUser: any;
    if (users.length > 1) {
      const { orgSlug } = request.body as { orgSlug?: string };
      if (!orgSlug) {
        return reply.code(400).send({
          error: "Email exists in multiple organizations. Please specify orgSlug.",
          organizations: users.map((u) => ({
            slug: u.organization.slug,
            name: u.organization.name,
          })),
        });
      }
      targetUser = users.find((u) => u.organization.slug === orgSlug);
      if (!targetUser) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }
    } else {
      targetUser = users[0];
    }

    const result = await loginUser(targetUser, password, request, reply);

    // If this user is also a super admin, annotate the response
    if (superAdmin && superAdmin.active && result && typeof result === "object" && "token" in result) {
      // Upgrade the session: create a super admin session with org context instead
      // so the user gets isSuperAdmin=true from /me
      await revokeSession(prisma, (result as any).token);
      const superToken = await createSuperAdminSession(prisma, {
        superAdminId: superAdmin.id,
        organizationId: targetUser.organizationId,
        userAgent: request.headers["user-agent"] ?? "",
      });
      setSessionCookie(reply, superToken);
      return {
        ...(result as any),
        token: superToken,
        isSuperAdmin: true,
      };
    }

    return result;
  });

  // ── POST /api/auth/signup ──────────────────────────────────────────────
  fastify.post("/api/auth/signup", async (request: FastifyRequest, reply: FastifyReply) => {
    const { orgName, orgSlug, email, name, password } = request.body as {
      orgName: string;
      orgSlug: string;
      email: string;
      name: string;
      password: string;
    };

    if (!orgName || !orgSlug || !email || !name || !password) {
      return reply.code(400).send({ error: "All fields required: orgName, orgSlug, email, name, password" });
    }

    const slug = orgSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    // Check slug availability
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      return reply.code(409).send({ error: "Organization slug already taken" });
    }

    // Create org + settings + user in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      const org = await tx.organization.create({
        data: { name: orgName, slug },
      });

      await tx.organizationSettings.create({
        data: {
          organizationId: org.id,
          general: orgSettingsPayload(orgName),
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          email: email.toLowerCase().trim(),
          name,
          role: "admin",
          active: true,
          passwordHash: await hashPassword(password),
        },
      });

      return { org, user };
    });

    const token = await createSession(prisma, {
      userId: result.user.id,
      organizationId: result.org.id,
      userAgent: request.headers["user-agent"] ?? "",
    });
    setSessionCookie(reply, token);

    await prisma.user.update({
      where: { id: result.user.id },
      data: { lastLoginAt: new Date() },
    });

    reply.code(201);
    return {
      token,
      user: safeUser(result.user),
      organization: { id: result.org.id, name: result.org.name, slug: result.org.slug },
    };
  });

  // ── POST /api/auth/super-login ─────────────────────────────────────────
  fastify.post("/api/auth/super-login", async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as { email: string; password: string };
    if (!email || !password) {
      return reply.code(400).send({ error: "Email and password are required" });
    }

    const admin = await prisma.superAdmin.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!admin || !admin.active) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await verifyPassword(password, admin.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = await createSuperAdminSession(prisma, {
      superAdminId: admin.id,
      userAgent: request.headers["user-agent"] ?? "",
    });
    setSessionCookie(reply, token);

    return {
      token,
      superAdmin: { id: admin.id, email: admin.email, name: admin.name },
    };
  });

  // ── POST /api/auth/logout ──────────────────────────────────────────────
  fastify.post("/api/auth/logout", async (request: FastifyRequest, reply: FastifyReply) => {
    const headerToken = (request.headers.authorization ?? "").replace("Bearer ", "");
    const cookieToken = getSessionCookieToken(request);
    const { token: bodyToken } = (request.body as { token?: string }) ?? {};
    const resolvedToken = bodyToken || headerToken || cookieToken;
    clearSessionCookie(reply);
    if (!resolvedToken) return { ok: true };
    await revokeSession(prisma, resolvedToken);
    return { ok: true };
  });

  // ── GET /api/auth/me ───────────────────────────────────────────────────
  fastify.get("/api/auth/me", async (request: FastifyRequest, reply: FastifyReply) => {
    const token =
      getSessionCookieToken(request) ||
      (request.headers.authorization ?? "").replace("Bearer ", "");
    if (!token) return reply.code(401).send({ error: "Not authenticated" });

    const validated = await validateSession(prisma, token);
    if (!validated) return reply.code(401).send({ error: "Invalid or expired token" });

    const { session, user, superAdmin } = validated;

    if (user) {
      const org = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true, name: true, slug: true },
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
          organizationId: user.organizationId,
        },
        organization: org,
        isSuperAdmin: false,
        impersonating: false,
      };
    }

    if (superAdmin) {
      let org = null;
      if (session.organizationId) {
        org = await prisma.organization.findUnique({
          where: { id: session.organizationId },
          select: { id: true, name: true, slug: true },
        });
      }
      return {
        user: {
          id: superAdmin.id,
          email: superAdmin.email,
          name: superAdmin.name,
          role: "admin",
          active: superAdmin.active,
        },
        organization: org,
        isSuperAdmin: true,
        impersonating: !!session.organizationId,
      };
    }

    return reply.code(401).send({ error: "Invalid session" });
  });

  // ── POST /api/auth/setup ──────────────────────────────────────────────
  // First-run endpoint: only works when no super admin exists yet
  fastify.post("/api/setup/init", async (request: FastifyRequest, reply: FastifyReply) => {
    const adminCount = await prisma.superAdmin.count();
    if (adminCount > 0) {
      return reply.code(403).send({ error: "System already initialized" });
    }

    const { email, name, password, orgName, orgSlug } = request.body as {
      email: string;
      name: string;
      password: string;
      orgName?: string;
      orgSlug?: string;
    };

    if (!email || !name || !password) {
      return reply.code(400).send({ error: "email, name, and password are required" });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // Create super admin
      const admin = await tx.superAdmin.create({
        data: {
          email: email.toLowerCase().trim(),
          name,
          passwordHash: await hashPassword(password),
          active: true,
        },
      });

      // Optionally create first org
      let org = null;
      let orgUser = null;
      if (orgName) {
        const slug = (orgSlug || orgName).toLowerCase().replace(/[^a-z0-9-]/g, "-");
        org = await tx.organization.create({ data: { name: orgName, slug } });
        await tx.organizationSettings.create({
          data: {
            organizationId: org.id,
            general: orgSettingsPayload(orgName),
          },
        });
        // Create an admin user in the org with the same credentials
        orgUser = await tx.user.create({
          data: {
            organizationId: org.id,
            email: email.toLowerCase().trim(),
            name,
            role: "admin",
            active: true,
            passwordHash: await hashPassword(password),
          },
        });
      }

      return { admin, org, orgUser };
    });

    // Create a super admin session — with org context if an org was created
    const token = await createSuperAdminSession(prisma, {
      superAdminId: result.admin.id,
      organizationId: result.org?.id,
      userAgent: request.headers["user-agent"] ?? "",
    });
    setSessionCookie(reply, token);

    reply.code(201);
    return {
      token,
      superAdmin: { id: result.admin.id, email: result.admin.email, name: result.admin.name },
      organization: result.org ? { id: result.org.id, name: result.org.name, slug: result.org.slug } : null,
    };
  });

  // ── PATCH /api/auth/profile ─────────────────────────────────────────
  // Update current user's profile (name, password)
  fastify.patch("/api/auth/profile", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ error: "Not authenticated" });

    const { name, currentPassword, newPassword } = request.body as {
      name?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    // Super admin profile update
    if (request.user.isSuperAdmin && !request.user.impersonating) {
      const admin = await prisma.superAdmin.findUnique({ where: { id: request.user.id } });
      if (!admin) return reply.code(404).send({ error: "Admin not found" });

      const data: any = {};
      if (name) data.name = name;
      if (newPassword) {
        if (!currentPassword) return reply.code(400).send({ error: "Current password is required" });
        const valid = await verifyPassword(currentPassword, admin.passwordHash);
        if (!valid) return reply.code(403).send({ error: "Current password is incorrect" });
        data.passwordHash = await hashPassword(newPassword);
      }

      const updated = await prisma.superAdmin.update({ where: { id: admin.id }, data });
      return { id: updated.id, email: updated.email, name: updated.name };
    }

    // Regular user profile update
    const user = await prisma.user.findFirst({
      where: { id: request.user.id, organizationId: request.user.organizationId! },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });

    const data: any = {};
    if (name) data.name = name;
    if (newPassword) {
      if (!currentPassword) return reply.code(400).send({ error: "Current password is required" });
      if (user.passwordHash) {
        const valid = await verifyPassword(currentPassword, user.passwordHash);
        if (!valid) return reply.code(403).send({ error: "Current password is incorrect" });
      }
      data.passwordHash = await hashPassword(newPassword);
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data });
    return { id: updated.id, email: updated.email, name: updated.name, role: updated.role };
  });

  // ── GET /api/auth/organizations ───────────────────────────────────────
  // List organizations the current user's email belongs to (for org switching)
  fastify.get("/api/auth/organizations", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ error: "Not authenticated" });

    const users = await prisma.user.findMany({
      where: { email: request.user.email, active: true },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    return users.map((u) => ({
      organizationId: u.organizationId,
      name: u.organization.name,
      slug: u.organization.slug,
      role: u.role,
      current: u.organizationId === request.user!.organizationId,
    }));
  });

  // ── POST /api/auth/switch-org ─────────────────────────────────────────
  // Switch to a different organization (creates new session)
  fastify.post("/api/auth/switch-org", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ error: "Not authenticated" });

    const { organizationId } = request.body as { organizationId: string };
    if (!organizationId) return reply.code(400).send({ error: "organizationId is required" });

    // Find the user record in the target org
    const targetUser = await prisma.user.findFirst({
      where: { email: request.user.email, organizationId, active: true },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    if (!targetUser) {
      return reply.code(403).send({ error: "You don't have access to this organization" });
    }

    // Revoke current session
    const currentToken =
      getSessionCookieToken(request) ||
      (request.headers.authorization ?? "").replace("Bearer ", "");
    if (currentToken) {
      await revokeSession(prisma, currentToken);
    }

    // Create new session for target org
    const token = await createSession(prisma, {
      userId: targetUser.id,
      organizationId: targetUser.organizationId,
      userAgent: request.headers["user-agent"] ?? "",
    });
    setSessionCookie(reply, token);

    return {
      token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: targetUser.role,
        organizationId: targetUser.organizationId,
      },
      organization: targetUser.organization,
    };
  });

  // ── GET /api/setup/status ─────────────────────────────────────────────
  // Check if system has been initialized
  fastify.get("/api/setup/status", async () => {
    const adminCount = await prisma.superAdmin.count();
    const orgCount = await prisma.organization.count();
    return {
      initialized: adminCount > 0,
      hasOrganizations: orgCount > 0,
      superAdminCount: adminCount,
      organizationCount: orgCount,
    };
  });

  // ── POST /api/setup/seed ──────────────────────────────────────────────
  // Seed sample data into an organization. Requires super admin.
  fastify.post("/api/setup/seed", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user?.isSuperAdmin) {
      return reply.code(403).send({ error: "Super admin access required" });
    }

    const { organizationId } = request.body as { organizationId: string };
    if (!organizationId) return reply.code(400).send({ error: "organizationId is required" });

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    try {
      await seedAllForOrganization(prisma, organizationId);
      return { ok: true, message: `Sample data seeded into ${org.name}` };
    } catch (error) {
      request.log.error(error, "Seed failed");
      return reply.code(500).send({
        error: "Seed failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ── POST /api/setup/seed-essentials ───────────────────────────────────
  // Seed just entity categories (needed for the app to work). Public during setup.
  fastify.post("/api/setup/seed-essentials", async (request: FastifyRequest, reply: FastifyReply) => {
    const { organizationId } = request.body as { organizationId: string };
    if (!organizationId) return reply.code(400).send({ error: "organizationId is required" });

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return reply.code(404).send({ error: "Organization not found" });

    try {
      await seedEntityCategories(prisma, organizationId);
      return { ok: true };
    } catch (error) {
      request.log.error(error, "Seed essentials failed");
      return reply.code(500).send({ error: "Failed to seed essentials" });
    }
  });
}

// ---------------------------------------------------------------------------
// Helper: perform login for a resolved user
// ---------------------------------------------------------------------------

async function loginUser(
  user: any,
  password: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!user.passwordHash) {
    return reply.code(401).send({ error: "Password not set. Contact your admin." });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return reply.code(401).send({ error: "Invalid credentials" });
  }

  const token = await createSession(prisma, {
    userId: user.id,
    organizationId: user.organizationId,
    userAgent: request.headers["user-agent"] ?? "",
  });
  setSessionCookie(reply, token);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    token,
    user: safeUser(user),
    organization: user.organization ?? {
      id: user.organizationId,
      name: "",
      slug: "",
    },
  };
}
