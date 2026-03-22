import { randomBytes, createHash } from "crypto";

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  userAgent?: string;
  ipAddress?: string;
}

// In-memory session store
const sessions = new Map<string, AuthSession>();

// Simple password hashing using SHA-256 with salt (no native module dependencies)
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = createHash("sha256").update(salt + password).digest("hex");
  return check === hash;
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function createSession(
  userId: string,
  opts?: { userAgent?: string; ipAddress?: string },
): AuthSession {
  const session: AuthSession = {
    id: `sess-${Date.now()}-${randomBytes(4).toString("hex")}`,
    userId,
    token: generateToken(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    createdAt: new Date().toISOString(),
    userAgent: opts?.userAgent,
    ipAddress: opts?.ipAddress,
  };
  sessions.set(session.token, session);
  return session;
}

export function validateToken(token: string): AuthSession | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function revokeSession(token: string): boolean {
  return sessions.delete(token);
}

export function revokeAllUserSessions(userId: string): number {
  let count = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId) {
      sessions.delete(token);
      count++;
    }
  }
  return count;
}

export function listUserSessions(userId: string): AuthSession[] {
  return Array.from(sessions.values()).filter(
    (s) => s.userId === userId && new Date(s.expiresAt) > new Date(),
  );
}
