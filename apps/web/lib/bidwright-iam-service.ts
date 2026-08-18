import type {
  IamAdminService,
  MemberRecord,
  PermissionGroup,
  RoleRecord,
  RoleScope,
} from "@braedonsaunders/appkit-iam";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  type AuthUser,
} from "@/lib/api";

const ROLE_DEFINITIONS = [
  {
    id: "admin",
    key: "admin",
    name: "Admin",
    description: "Full organization administration and estimating access.",
    permissions: ["*"],
  },
  {
    id: "estimator",
    key: "estimator",
    name: "Estimator",
    description: "Create and manage projects, quotes, takeoffs, and estimates.",
    permissions: ["projects.manage", "quotes.manage", "takeoff.manage", "settings.read"],
  },
  {
    id: "viewer",
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to organization estimating records.",
    permissions: ["projects.read", "quotes.read", "takeoff.read"],
  },
] as const;

export const bidwrightPermissionGroups: PermissionGroup[] = [
  {
    key: "projects",
    label: "Projects",
    permissions: [
      { key: "projects.read", label: "View projects" },
      { key: "projects.manage", label: "Manage projects" },
    ],
  },
  {
    key: "quotes",
    label: "Quotes & estimates",
    permissions: [
      { key: "quotes.read", label: "View quotes" },
      { key: "quotes.manage", label: "Manage quotes" },
      { key: "takeoff.read", label: "View takeoffs" },
      { key: "takeoff.manage", label: "Manage takeoffs" },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    permissions: [
      { key: "settings.read", label: "View settings" },
      { key: "settings.manage", label: "Manage settings" },
      { key: "users.manage", label: "Manage users" },
    ],
  },
];

type RoleId = AuthUser["role"];

function roleId(value: string | undefined): RoleId {
  return value === "admin" || value === "viewer" ? value : "estimator";
}

function asDate(value: string | undefined): Date {
  return value ? new Date(value) : new Date(0);
}

function toRole(definition: (typeof ROLE_DEFINITIONS)[number], users: AuthUser[]): RoleRecord {
  return {
    ...definition,
    isBuiltIn: true,
    permissions: [...definition.permissions],
    memberCount: users.filter((user) => user.role === definition.id).length,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    capabilities: {
      updateKey: false,
      updateDetails: false,
      updatePermissions: false,
      duplicate: false,
      delete: false,
      reason: "Bidwright roles are built in while granular IAM storage is being introduced.",
    },
  };
}

function toMember(user: AuthUser, currentUserId?: string): MemberRecord {
  const assignedRole = ROLE_DEFINITIONS.find((role) => role.id === user.role) ?? ROLE_DEFINITIONS[1];
  const current = user.id === currentUserId;
  return {
    id: user.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    image: null,
    status: user.active ? "active" : "suspended",
    isSuperAdmin: false,
    isCurrentUser: current,
    localeOverride: null,
    joinedAt: asDate(user.createdAt),
    invitedAt: null,
    createdAt: asDate(user.createdAt),
    assignments: [
      {
        id: `${user.id}:${assignedRole.id}`,
        roleId: assignedRole.id,
        roleKey: assignedRole.key,
        roleName: assignedRole.name,
        scope: { type: "tenant" },
      },
    ],
    overrides: [],
    capabilities: {
      updateProfile: true,
      changeStatus: !current,
      remove: !current,
      manageRoles: true,
      manageOverrides: false,
      resendInvite: false,
      reason: "Per-user permission overrides require the future granular IAM schema.",
    },
  };
}

function pageRows<T>(rows: T[], page = 1, perPage = 25) {
  const safePage = Math.max(1, page);
  const safePerPage = Math.max(1, perPage);
  return rows.slice((safePage - 1) * safePerPage, safePage * safePerPage);
}

function unsupported(message: string): never {
  throw new Error(message);
}

/**
 * Adapts AppKit IAM administration to Bidwright's existing organization user
 * endpoints. It intentionally exposes the three legacy roles as protected,
 * tenant-wide roles until granular IAM tables are introduced.
 */
export function createBidwrightIamService(currentUserId?: string): IamAdminService {
  return {
    async listRoles(query = {}) {
      const users = await listUsers();
      let rows = ROLE_DEFINITIONS.map((definition) => toRole(definition, users));
      if (query.q) {
        const needle = query.q.toLowerCase();
        rows = rows.filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(needle));
      }
      const total = rows.length;
      return {
        rows: pageRows(rows, query.page, query.perPage),
        total,
        page: query.page ?? 1,
        perPage: query.perPage ?? 25,
        facets: { typeCounts: { built_in: total, custom: 0 } },
      };
    },
    async getRole(id) {
      const users = await listUsers();
      const definition = ROLE_DEFINITIONS.find((role) => role.id === id);
      return definition ? toRole(definition, users) : null;
    },
    async createRole() {
      return unsupported("Custom roles require Bidwright's granular IAM schema.");
    },
    async updateRole() {
      return unsupported("Built-in Bidwright roles cannot be edited.");
    },
    async duplicateRole() {
      return unsupported("Custom roles require Bidwright's granular IAM schema.");
    },
    async deleteRole() {
      return unsupported("Built-in Bidwright roles cannot be deleted.");
    },
    async bulkUpdateRoleAssignments(input) {
      const changedIds: string[] = [];
      for (const membershipId of input.membershipIds) {
        await updateUser(membershipId, { role: roleId(input.roleId) });
        changedIds.push(membershipId);
      }
      return { operation: input.operation, roleId: input.roleId, changedIds, skippedIds: [] };
    },

    async listMembers(query = {}) {
      let rows = (await listUsers()).map((user) => toMember(user, currentUserId));
      if (query.q) {
        const needle = query.q.toLowerCase();
        rows = rows.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(needle));
      }
      if (query.status) rows = rows.filter((member) => member.status === query.status);
      if (query.roleId) rows = rows.filter((member) => member.assignments.some((assignment) => assignment.roleId === query.roleId));
      const statusCounts = {
        active: rows.filter((member) => member.status === "active").length,
        invited: rows.filter((member) => member.status === "invited").length,
        suspended: rows.filter((member) => member.status === "suspended").length,
      };
      const total = rows.length;
      return {
        rows: pageRows(rows, query.page, query.perPage),
        total,
        page: query.page ?? 1,
        perPage: query.perPage ?? 25,
        facets: { statusCounts },
      };
    },
    async getMember(id) {
      const user = (await listUsers()).find((candidate) => candidate.id === id);
      return user ? toMember(user, currentUserId) : null;
    },
    async inviteMember(input) {
      const selectedRole = input.assignments[0]?.roleId;
      return toMember(
        await createUser({
          email: input.email,
          name: input.name,
          role: roleId(selectedRole),
        }),
        currentUserId,
      );
    },
    async resendInvite() {
      return unsupported("Bidwright currently creates active users instead of invitation records.");
    },
    async updateMember(id, input) {
      return toMember(
        await updateUser(id, {
          name: input.name,
          active: input.status ? input.status === "active" : undefined,
        }),
        currentUserId,
      );
    },
    async removeMember(id) {
      await deleteUser(id);
    },
    async assignRole(membershipId, nextRoleId, scope) {
      await updateUser(membershipId, { role: roleId(nextRoleId) });
      const definition = ROLE_DEFINITIONS.find((role) => role.id === roleId(nextRoleId)) ?? ROLE_DEFINITIONS[1];
      return {
        id: `${membershipId}:${definition.id}`,
        roleId: definition.id,
        roleKey: definition.key,
        roleName: definition.name,
        scope,
      };
    },
    async updateAssignmentScope(assignmentId, scope) {
      const [membershipId, assignedRoleId] = assignmentId.split(":");
      if (!membershipId) return unsupported("Invalid role assignment.");
      const definition = ROLE_DEFINITIONS.find((role) => role.id === assignedRoleId) ?? ROLE_DEFINITIONS[1];
      return {
        id: assignmentId,
        roleId: definition.id,
        roleKey: definition.key,
        roleName: definition.name,
        scope,
      };
    },
    async removeAssignment(assignmentId) {
      const [membershipId] = assignmentId.split(":");
      if (!membershipId) return unsupported("Invalid role assignment.");
      await updateUser(membershipId, { role: "viewer" });
    },
    async setPermissionOverride() {
      return unsupported("Permission overrides require Bidwright's granular IAM schema.");
    },
    async removePermissionOverride() {
      return unsupported("Permission overrides require Bidwright's granular IAM schema.");
    },
    async listAuditEvents(query = {}) {
      return {
        rows: [],
        total: 0,
        page: query.page ?? 1,
        perPage: query.perPage ?? 25,
        facets: { actions: [], recordTypes: [] },
      };
    },
    async getAuditEvent() {
      return null;
    },
  };
}
