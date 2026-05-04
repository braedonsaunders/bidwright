import type { IntegrationManifest, IntegrationManifestParsed } from "../manifest/schema.js";
import { parseManifest } from "../manifest/schema.js";
import { genericRestManifest } from "./generic-rest.js";
import { webhookOutManifest } from "./webhook-out.js";
import { webhookInManifest } from "./webhook-in.js";

import { hubspotManifest } from "./hubspot.js";
import { slackManifest } from "./slack.js";
import { microsoft365Manifest } from "./microsoft365.js";
import { netsuiteManifest } from "./netsuite.js";
import { quickbooksManifest } from "./quickbooks.js";
import { procoreManifest } from "./procore.js";
import { salesforceManifest } from "./salesforce.js";
import { googleWorkspaceManifest } from "./google-workspace.js";
import { sftpCsvManifest } from "./sftp-csv.js";

/**
 * Static catalog of built-in manifests. Custom manifests come from the
 * `Integration` table (manifestSnapshot column) at install time, and
 * community manifests are loaded from a registry URL by the API layer.
 *
 * The exported list is the *parsed* shape (defaults applied) — every
 * built-in manifest is normalized at module load so consumers don't have
 * to re-parse on every read.
 */
const rawBuiltins: IntegrationManifest[] = [
  // Escape hatches first — these unlock everything else.
  genericRestManifest,
  webhookOutManifest,
  webhookInManifest,
  // CRM / sales
  hubspotManifest,
  salesforceManifest,
  // Collab / comms
  slackManifest,
  microsoft365Manifest,
  googleWorkspaceManifest,
  // Accounting / ERP
  netsuiteManifest,
  quickbooksManifest,
  // Construction PM
  procoreManifest,
  // Storage / data
  sftpCsvManifest,
];

export const builtinManifests: IntegrationManifestParsed[] = rawBuiltins.map(parseManifest);

export function findBuiltinManifest(id: string): IntegrationManifestParsed | undefined {
  return builtinManifests.find((m) => m.id === id);
}

export function listBuiltinManifestSummaries(): Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  vendor: string;
  icon?: string;
  tags: string[];
  version: string;
  authType: string;
  capabilities: { actions: number; triggers: number; syncs: number };
}> {
  return builtinManifests.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    vendor: m.vendor,
    icon: m.icon,
    tags: m.tags,
    version: m.version,
    authType: m.connection.auth.type,
    capabilities: {
      actions: m.capabilities.actions.length,
      triggers: m.capabilities.triggers.length,
      syncs: m.capabilities.syncs.length,
    },
  }));
}

export {
  genericRestManifest, webhookOutManifest, webhookInManifest,
  hubspotManifest, slackManifest, microsoft365Manifest,
  netsuiteManifest, quickbooksManifest, procoreManifest, salesforceManifest,
  googleWorkspaceManifest, sftpCsvManifest,
};
