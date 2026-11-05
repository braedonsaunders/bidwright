import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { settingsRoutes } from "./settings-routes.js";

type TestUser = { role: string; isSuperAdmin?: boolean };

async function buildApp(user: TestUser) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return { id: "user-2", email: "a@example.com", name: "A", role: "estimator", passwordHash: "hash" };
  };
  const app = Fastify();
  app.decorateRequest("user", null);
  app.decorateRequest("store", null);
  app.addHook("onRequest", async (request) => {
    request.user = {
      id: "user-1",
      role: user.role,
      email: "me@example.com",
      name: "Me",
      organizationId: "org-1",
      isSuperAdmin: user.isSuperAdmin ?? false,
      impersonating: false,
    };
    request.store = {
      listUsers: async () => [],
      createUser: record("createUser"),
      updateUser: record("updateUser"),
      deleteUser: record("deleteUser"),
    } as any;
  });
  await app.register(settingsRoutes);
  return { app, calls };
}

test("non-admins cannot create, change, or delete users", async () => {
  for (const role of ["estimator", "viewer"]) {
    const { app, calls } = await buildApp({ role });
    try {
      const promote = await app.inject({ method: "PATCH", url: "/users/user-1", payload: { role: "admin" } });
      assert.equal(promote.statusCode, 403, `${role} promoting themselves`);
      const reset = await app.inject({ method: "PATCH", url: "/users/user-2", payload: { password: "pw" } });
      assert.equal(reset.statusCode, 403, `${role} resetting a password`);
      const create = await app.inject({
        method: "POST",
        url: "/users",
        payload: { email: "x@example.com", name: "X", role: "admin" },
      });
      assert.equal(create.statusCode, 403, `${role} creating an admin`);
      const remove = await app.inject({ method: "DELETE", url: "/users/user-2" });
      assert.equal(remove.statusCode, 403, `${role} deleting a user`);
      assert.deepEqual(calls, [], "the store is never reached");

      const list = await app.inject({ method: "GET", url: "/users" });
      assert.equal(list.statusCode, 200, "listing colleagues stays available");
    } finally {
      await app.close();
    }
  }
});

test("admins and super admins can manage users, without leaking password hashes", async () => {
  for (const user of [{ role: "admin" }, { role: "estimator", isSuperAdmin: true }]) {
    const { app, calls } = await buildApp(user);
    try {
      const create = await app.inject({
        method: "POST",
        url: "/users",
        payload: { email: "x@example.com", name: "X", role: "viewer" },
      });
      assert.equal(create.statusCode, 201);
      assert.equal(create.json().passwordHash, undefined);
      const patch = await app.inject({
        method: "PATCH",
        url: "/users/user-2",
        payload: { role: "admin", active: false },
      });
      assert.equal(patch.statusCode, 200);
      const remove = await app.inject({ method: "DELETE", url: "/users/user-2" });
      assert.equal(remove.statusCode, 200);
      assert.deepEqual(calls.map((c) => c.method), ["createUser", "updateUser", "deleteUser"]);
      assert.deepEqual(calls[1].args, ["user-2", { role: "admin", active: false }]);
    } finally {
      await app.close();
    }
  }
});

test("user payloads are validated before reaching the store", async () => {
  const { app, calls } = await buildApp({ role: "admin" });
  try {
    const badRole = await app.inject({
      method: "POST",
      url: "/users",
      payload: { email: "x@example.com", name: "X", role: "owner" },
    });
    assert.equal(badRole.statusCode, 400);
    const unknownField = await app.inject({
      method: "PATCH",
      url: "/users/user-2",
      payload: { organizationId: "org-2" },
    });
    assert.equal(unknownField.statusCode, 400);
    assert.deepEqual(calls, []);
  } finally {
    await app.close();
  }
});
