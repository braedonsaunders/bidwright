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

test("server mode refuses to start without an application key probe", () => {
  const originalMode = process.env.BIDWRIGHT_MODE;
  process.env.BIDWRIGHT_MODE = "server";
  try {
    assert.throws(
      () => validateIntegrationsEncryptionKey(randomBytes(32).toString("base64"), ""),
      /PROBE is required in Bidwright server mode/,
    );
  } finally {
    if (originalMode === undefined) delete process.env.BIDWRIGHT_MODE;
    else process.env.BIDWRIGHT_MODE = originalMode;
  }
});

// The public demo container runs with BIDWRIGHT_MODE=server but is never given
// a probe, because it holds no tenant credentials and mints a fresh key on
// every cold start. Requiring one aborted startup before the server could
// listen, so the Worker answered "the container is not running" — the demo was
// dark from 2026-07-28 until this was fixed.
test("the public demo starts without a probe it was never given", () => {
  const originalMode = process.env.BIDWRIGHT_MODE;
  const originalDemo = process.env.BIDWRIGHT_DEMO_MODE;
  process.env.BIDWRIGHT_MODE = "server";
  process.env.BIDWRIGHT_DEMO_MODE = "1";
  try {
    assert.deepEqual(
      validateIntegrationsEncryptionKey(randomBytes(32).toString("base64"), ""),
      { probeVerified: false },
    );
  } finally {
    if (originalMode === undefined) delete process.env.BIDWRIGHT_MODE;
    else process.env.BIDWRIGHT_MODE = originalMode;
    if (originalDemo === undefined) delete process.env.BIDWRIGHT_DEMO_MODE;
    else process.env.BIDWRIGHT_DEMO_MODE = originalDemo;
  }
});

test("a probe the demo does supply is still verified against the key", () => {
  const originalMode = process.env.BIDWRIGHT_MODE;
  const originalDemo = process.env.BIDWRIGHT_DEMO_MODE;
  process.env.BIDWRIGHT_MODE = "server";
  process.env.BIDWRIGHT_DEMO_MODE = "1";
  const key = randomBytes(32).toString("base64");
  try {
    assert.deepEqual(validateIntegrationsEncryptionKey(key, createIntegrationsEncryptionKeyProbe(key)), {
      probeVerified: true,
    });
    assert.throws(
      () => validateIntegrationsEncryptionKey(
        randomBytes(32).toString("base64"),
        createIntegrationsEncryptionKeyProbe(key),
      ),
      /does not match INTEGRATIONS_ENCRYPTION_KEY_PROBE/,
    );
  } finally {
    if (originalMode === undefined) delete process.env.BIDWRIGHT_MODE;
    else process.env.BIDWRIGHT_MODE = originalMode;
    if (originalDemo === undefined) delete process.env.BIDWRIGHT_DEMO_MODE;
    else process.env.BIDWRIGHT_DEMO_MODE = originalDemo;
  }
});
