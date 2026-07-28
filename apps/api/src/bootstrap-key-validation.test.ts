import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  createIntegrationsEncryptionKeyProbe,
  validateIntegrationsEncryptionKey,
} from "./services/settings-key-validation.js";

test("startup validation rejects malformed keys before any credential is read", () => {
  assert.throws(
    () => validateIntegrationsEncryptionKey("not-a-32-byte-base64-key"),
    /must decode to exactly 32 bytes/,
  );
});

test("startup validation uses an application probe without scanning tenant records", () => {
  const matchingKey = randomBytes(32).toString("base64");
  const probe = createIntegrationsEncryptionKeyProbe(matchingKey);

  assert.deepEqual(validateIntegrationsEncryptionKey(matchingKey, probe), {
    probeVerified: true,
  });
  assert.throws(
    () => validateIntegrationsEncryptionKey(randomBytes(32).toString("base64"), probe),
    /does not match INTEGRATIONS_ENCRYPTION_KEY_PROBE/,
  );
});
