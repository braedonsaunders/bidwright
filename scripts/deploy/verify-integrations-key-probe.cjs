"use strict";

const crypto = require("crypto");

function hkdfSha256(inputKey, salt, info, length) {
  const prk = crypto.createHmac("sha256", salt).update(inputKey).digest();
  const blocks = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  let produced = 0;

  while (produced < length) {
    previous = crypto
      .createHmac("sha256", prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    blocks.push(previous);
    produced += previous.length;
    counter += 1;
  }

  return Buffer.concat(blocks).subarray(0, length);
}

const encodedKey = (process.env.INTEGRATIONS_ENCRYPTION_KEY || "").trim();
const encodedProbe = (
  process.env.INTEGRATIONS_ENCRYPTION_KEY_PROBE || ""
).trim();
const key = Buffer.from(encodedKey, "base64");

if (key.length !== 32) {
  throw new Error("INTEGRATIONS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
}
if (!encodedProbe) {
  throw new Error("INTEGRATIONS_ENCRYPTION_KEY_PROBE is required.");
}

const payload = Buffer.from(encodedProbe, "base64");
if (payload.length < 29 || payload[0] !== 1) {
  throw new Error("INTEGRATIONS_ENCRYPTION_KEY_PROBE has an invalid envelope.");
}

const derivedKey = hkdfSha256(
  key,
  Buffer.from("bidwright-integrations-key-probe:v1"),
  Buffer.from("bidwright:settings:key-probe:v1"),
  32,
);
const decipher = crypto.createDecipheriv(
  "aes-256-gcm",
  derivedKey,
  payload.subarray(1, 13),
);
decipher.setAAD(
  Buffer.from("bidwright:integrations-encryption-key:probe:v1"),
);
decipher.setAuthTag(payload.subarray(13, 29));
const plaintext = Buffer.concat([
  decipher.update(payload.subarray(29)),
  decipher.final(),
]).toString("utf8");

if (plaintext !== "bidwright-integrations-key-probe:v1") {
  throw new Error("INTEGRATIONS_ENCRYPTION_KEY_PROBE plaintext is invalid.");
}

console.log("Protected integrations encryption key probe verified.");
