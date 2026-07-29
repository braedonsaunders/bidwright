import assert from "node:assert/strict";
import test from "node:test";

import {
  declaredProjectImageMime,
  detectedProjectImageMime,
  validateAgentProjectImage,
} from "./project-image-service.js";

test("declaredProjectImageMime accepts file-node extensions and MIME values", () => {
  assert.equal(declaredProjectImageMime("site-photo.JPG", "jpg"), "image/jpeg");
  assert.equal(declaredProjectImageMime("markup", "image/png"), "image/png");
  assert.equal(declaredProjectImageMime("reference.webp"), "image/webp");
  assert.equal(declaredProjectImageMime("drawing.svg"), null);
});

test("detectedProjectImageMime recognizes supported raster signatures", () => {
  assert.equal(
    detectedProjectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(
    detectedProjectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    "image/jpeg",
  );
  assert.equal(
    detectedProjectImageMime(Buffer.from("GIF89a")),
    "image/gif",
  );
  assert.equal(
    detectedProjectImageMime(Buffer.from("RIFF0000WEBP")),
    "image/webp",
  );
});

test("validateAgentProjectImage rejects extension spoofing", () => {
  assert.throws(
    () => validateAgentProjectImage({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      fileName: "not-really.png",
      fileType: "png",
    }),
    /does not match/,
  );
});
