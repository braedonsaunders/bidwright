import assert from "node:assert/strict";
import test from "node:test";

import { getProcessSandboxLauncherIdentity } from "./launcher-identity.js";

test("uses the standard unprivileged runtime identity by default", () => {
  assert.deepEqual(getProcessSandboxLauncherIdentity({}), {
    uid: 1000,
    gid: 1000,
  });
});

test("accepts an explicitly configured unprivileged identity", () => {
  assert.deepEqual(
    getProcessSandboxLauncherIdentity({
      BIDWRIGHT_RUNTIME_UID: "2000",
      BIDWRIGHT_RUNTIME_GID: "2001",
    }),
    { uid: 2000, gid: 2001 },
  );
});

test("rejects root and malformed launcher identities", () => {
  assert.throws(
    () => getProcessSandboxLauncherIdentity({ BIDWRIGHT_RUNTIME_UID: "0" }),
    /BIDWRIGHT_RUNTIME_UID must be between 1/,
  );
  assert.throws(
    () => getProcessSandboxLauncherIdentity({ BIDWRIGHT_RUNTIME_GID: "-1" }),
    /BIDWRIGHT_RUNTIME_GID must be a decimal integer/,
  );
  assert.throws(
    () => getProcessSandboxLauncherIdentity({ BIDWRIGHT_RUNTIME_UID: "user" }),
    /BIDWRIGHT_RUNTIME_UID must be a decimal integer/,
  );
});
