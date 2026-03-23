import { randomBytes, createHash } from "crypto";
import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Password hashing (argon2 + legacy SHA-256 fallback)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("$argon2")) {
    return argon2.verify(stored, password);
  }
  // Legacy SHA-256 format: salt:hash
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = createHash("sha256").update(salt + password).digest("hex");
  return check === hash;
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ValidatedSession {
  session: {
    id: string;
    token: string;
    organizationId: string | null;
    superAdminId: string | null;
    userId: string | null;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string;
    active: boolean;
  } | null;
  superAdmin: {
    id: string;
    email: string;
    name: string;
    active: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Session CRUD (Postgres-backed)
// ---------------------------------------------------------------------------

/** Create a session for a regular org user. */
export async function createSession(
  db: PrismaClient,
  opts: { userId: string; organizationId: string; userAgent?: string; ipAddress?: string },
): Promise<string> {
  const token = generateToken();
  await db.session.create({
    data: {
      token,
      userId: opts.userId,
      organizationId: opts.organizationId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      userAgent: opts.userAgent ?? "",
      ipAddress: opts.ipAddress ?? "",
    },
  });
  return token;
}

/** Create a session for a super admin — optionally impersonating an org. */
export async function createSuperAdminSession(
  db: PrismaClient,
  opts: { superAdminId: string; organizationId?: string; userAgent?: string; ipAddress?: string },
): Promise<string> {
  const token = generateToken();
  await db.session.create({
    data: {
      token,
      superAdminId: opts.superAdminId,
      organizationId: opts.organizationId ?? null,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      userAgent: opts.userAgent ?? "",
      ipAddress: opts.ipAddress ?? "",
    },
  });
  return token;
}

/** Validate a token and return the session + associated user or super admin. */
export async function validateSession(
  db: PrismaClient,
  token: string,
): Promise<ValidatedSession | null> {
  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: true,
      superAdmin: true,
    },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    // Expired — clean up
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // For user sessions, verify user is still active
  if (session.user && !session.user.active) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // For super admin sessions, verify admin is still active
  if (session.superAdmin && !session.superAdmin.active) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    session: {
      id: session.id,
      token: session.token,
      organizationId: session.organizationId,
      superAdminId: session.superAdminId,
      userId: session.userId,
      expiresAt: session.expiresAt,
    },
    user: session.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role,
          organizationId: session.user.organizationId,
          active: session.user.active,
        }
      : null,
    superAdmin: session.superAdmin
      ? {
          id: session.superAdmin.id,
          email: session.superAdmin.email,
          name: session.superAdmin.name,
          active: session.superAdmin.active,
        }
      : null,
  };
}

/** Revoke a single session by token. */
export async function revokeSession(db: PrismaClient, token: string): Promise<void> {
  await db.session.deleteMany({ where: { token } });
}

/** Revoke all sessions for a user. */
export async function revokeAllUserSessions(db: PrismaClient, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}

/** Revoke all sessions for a super admin. */
export async function revokeAllSuperAdminSessions(db: PrismaClient, superAdminId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { superAdminId } });
  return result.count;
}

/** Delete all expired sessions. Run on startup and periodically. */
export async function cleanExpiredSessions(db: PrismaClient): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
