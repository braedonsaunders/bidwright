import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { sealSettingsSecrets } from "./services/settings-secret-crypto.js";

test("settings writes reject caller-supplied sealed envelopes", () => {
  const originalKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  try {
    assert.throws(
      () =>
        sealSettingsSecrets(
          {
            openaiKey: {
              __sealedSecret: "appkit.contextual-secret.v1",
              ciphertext: "attacker-controlled",
            },
          },
          { kind: "organization", id: "org-1", tenantId: "org-1" },
        ),
      /Pre-sealed settings credential envelopes are not accepted/,
    );
  } finally {
    if (originalKey === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    else process.env.INTEGRATIONS_ENCRYPTION_KEY = originalKey;
  }
});
