import assert from "node:assert/strict";
import { test } from "node:test";

import { getMcpServerPath, resolveMcpRunner } from "./cli-runtime.js";

test("uses the compiled MCP server without project-relative npx resolution", () => {
  const serverPath = getMcpServerPath();
  const runner = resolveMcpRunner();

  assert.equal(serverPath.endsWith("/packages/mcp-server/dist/index.js"), true);
  assert.equal(runner.mcpRunner, process.execPath);
  assert.deepEqual(runner.mcpArgs, [serverPath]);
});
