import assert from "node:assert/strict";
import test from "node:test";

import { windowsStopProcessesUsingPathCommand } from "./process-cleanup.js";

test("Windows cleanup quotes a data-dir path for PowerShell -like", () => {
  const command = windowsStopProcessesUsingPathCommand("C:\\Users\\Admin\\AppData\\Roaming\\Bidwright\\postgres");
  assert.match(command, /Get-CimInstance Win32_Process/);
  assert.match(command, /Bidwright\\postgres/);
  assert.match(command, /Stop-Process/);
});

test("Windows cleanup escapes single quotes in the path", () => {
  const command = windowsStopProcessesUsingPathCommand("C:\\Users\\O'Brien\\Bidwright");
  assert.match(command, /O''Brien/);
});
