import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { validateStoredSettingsCredentials } from "./services/settings-key-validation.js";
import { sealSettingsSecrets } from "./services/settings-secret-crypto.js";

test("startup validation rejects a key that cannot decrypt stored credentials", async () => {
  const originalKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  const organizationId = "org-key-check";
  const matchingKey = randomBytes(32).toString("base64");

  try {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = matchingKey;
    const integrations = sealSettingsSecrets(
      { openaiKey: "sk-test-key-check" },
      { kind: "organization", id: organizationId, tenantId: organizationId },
    );
    const records = {
      organizations: [{ organizationId, email: {}, integrations }],
      users: [],
      superAdmins: [],
    };

    assert.doesNotThrow(() => validateStoredSettingsCredentials(records));

    process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.throws(
      () => validateStoredSettingsCredentials(records),
      /does not match stored settings credentials/,
    );
  } finally {
    if (originalKey === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    else process.env.INTEGRATIONS_ENCRYPTION_KEY = originalKey;
  }
});
