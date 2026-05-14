export const isDemoMode = process.env.NEXT_PUBLIC_BIDWRIGHT_DEMO === "1";

export const DEMO_DISABLED_MESSAGE =
  "This public demo saves quote, client, worksheet, phase, factor, condition, library, document, and manual takeoff data, but disables AI, agent CLI, uploads, package/file ingest, vision and auto-takeoff processing, email delivery, external integrations, plugin execution, and PDF generation.";

export const DEMO_DISABLED_FEATURES = [
  "AI agent and CLI runtime",
  "Uploads, package/file ingest, and vision/auto-takeoff processing",
  "Email delivery and PDF generation",
  "External integrations and plugin execution",
];
