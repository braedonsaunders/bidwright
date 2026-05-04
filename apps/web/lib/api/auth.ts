import { apiRequest } from "./client";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "estimator" | "viewer";
  active: boolean;
  organizationId?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  organization: OrgInfo | null;
  isSuperAdmin?: boolean;
}

export interface MeResponse {
  user: AuthUser;
  organization: OrgInfo | null;
  isSuperAdmin: boolean;
  impersonating: boolean;
}

export interface SignupRequest {
  orgName: string;
  orgSlug: string;
  email: string;
  name: string;
  password: string;
}

export interface SignupResponse {
  token: string;
  user: AuthUser;
  organization: OrgInfo;
}

export interface SetupStatusResponse {
  initialized: boolean;
  hasOrganizations: boolean;
  superAdminCount: number;
  organizationCount: number;
}

export async function login(email: string, password: string, orgSlug?: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, orgSlug }),
  });
}

export async function signup(data: SignupRequest): Promise<SignupResponse> {
  return apiRequest<SignupResponse>("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function superLogin(email: string, password: string): Promise<{ token: string; superAdmin: { id: string; email: string; name: string } }> {
  return apiRequest("/api/auth/super-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function getCurrentUser(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/api/auth/me");
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  return apiRequest<SetupStatusResponse>("/api/setup/status");
}

export async function initSetup(data: {
  email: string;
  name: string;
  password: string;
  orgName?: string;
  orgSlug?: string;
}): Promise<{ token: string; superAdmin: { id: string; email: string; name: string }; organization: OrgInfo | null }> {
  return apiRequest("/api/setup/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function seedSampleData(organizationId: string): Promise<{ ok: boolean; message: string }> {
  return apiRequest("/api/setup/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export async function seedEssentials(organizationId: string): Promise<{ ok: boolean }> {
  return apiRequest("/api/setup/seed-essentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export interface OrgLimits {
  maxUsers: number;
  maxProjects: number;
  maxStorage: number;
  maxKnowledgeBooks: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  projectCount: number;
  knowledgeBookCount: number;
  limits: OrgLimits;
}

export async function adminListOrganizations(): Promise<AdminOrg[]> {
  return apiRequest<AdminOrg[]>("/api/admin/organizations");
}

export async function adminCreateOrganization(data: {
  name: string;
  slug?: string;
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
}): Promise<{ organization: OrgInfo; adminUser: { id: string; email: string; name: string } | null }> {
  return apiRequest("/api/admin/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function adminUpdateOrganization(orgId: string, patch: { name?: string; slug?: string }): Promise<OrgInfo & { updatedAt: string }> {
  return apiRequest(`/api/admin/organizations/${orgId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteOrganization(orgId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/organizations/${orgId}`, { method: "DELETE" });
}

export async function adminListOrgUsers(orgId: string): Promise<AuthUser[]> {
  return apiRequest<AuthUser[]>(`/api/admin/organizations/${orgId}/users`);
}

export async function adminImpersonate(organizationId: string): Promise<{ token: string; organization: OrgInfo }> {
  return apiRequest("/api/admin/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export async function adminStopImpersonation(): Promise<{ ok: boolean }> {
  return apiRequest("/api/admin/stop-impersonation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function adminUpdateOrgLimits(orgId: string, limits: Partial<OrgLimits>): Promise<OrgLimits> {
  return apiRequest(`/api/admin/organizations/${orgId}/limits`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits),
  });
}

export async function adminCreateOrgUser(orgId: string, data: {
  email: string;
  name: string;
  role?: string;
  password?: string;
}): Promise<AuthUser> {
  return apiRequest(`/api/admin/organizations/${orgId}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function adminUpdateUser(userId: string, patch: Partial<{
  name: string;
  email: string;
  role: string;
  active: boolean;
  password: string;
}>): Promise<AuthUser> {
  return apiRequest(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteUser(userId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/users/${userId}`, { method: "DELETE" });
}

export async function adminMoveUser(userId: string, organizationId: string): Promise<AuthUser> {
  return apiRequest(`/api/admin/users/${userId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export async function adminGetMyMemberships(): Promise<{ organizationIds: string[] }> {
  return apiRequest("/api/admin/my-memberships");
}

export async function listUsers(): Promise<AuthUser[]> {
  return apiRequest<AuthUser[]>("/users");
}

export async function createUser(input: { email: string; name: string; role: "admin" | "estimator" | "viewer"; password?: string }): Promise<AuthUser> {
  return apiRequest<AuthUser>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateUser(userId: string, patch: Partial<{ email: string; name: string; role: "admin" | "estimator" | "viewer"; active: boolean; password: string }>): Promise<AuthUser> {
  return apiRequest<AuthUser>(`/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteUser(userId: string): Promise<AuthUser> {
  return apiRequest<AuthUser>(`/users/${userId}`, {
    method: "DELETE",
  });
}

export async function updateProfile(data: { name?: string; currentPassword?: string; newPassword?: string }) {
  return apiRequest<{ id: string; email: string; name: string }>("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export interface UserOrganization {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
  current: boolean;
}

export async function listMyOrganizations(): Promise<UserOrganization[]> {
  return apiRequest<UserOrganization[]>("/api/auth/organizations");
}

export async function switchOrganization(organizationId: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/api/auth/switch-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}
