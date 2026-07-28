import assert from "node:assert/strict";
import test from "node:test";

import { isPublicRoute, requiresOrganizationContext } from "./auth-route-policy.js";

test("only self-authenticating auth endpoints are public", () => {
  for (const path of [
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/super-login",
    "/api/auth/logout",
    "/api/auth/me",
  ]) {
    assert.equal(isPublicRoute(path), true, path);
  }

  for (const path of [
    "/api/auth/profile",
    "/api/auth/organizations",
    "/api/auth/switch-org",
  ]) {
    assert.equal(isPublicRoute(path), false, path);
  }
});

test("authenticated auth utilities do not require an organization context", () => {
  for (const path of [
    "/api/auth/profile",
    "/api/auth/organizations",
    "/api/auth/switch-org",
  ]) {
    assert.equal(requiresOrganizationContext(path), false, path);
  }

  assert.equal(requiresOrganizationContext("/projects"), true);
});
