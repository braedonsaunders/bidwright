"use client";

import { useState } from "react";
import { AlertCircle, Loader2, Sparkles, X } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Textarea } from "@/components/ui";
import { generateManifestFromOpenAPI, installIntegration } from "@/lib/api/integrations";

/**
 * Modal for installing a custom-authored manifest. Two paths:
 *
 *  1. Paste / upload a manifest JSON document directly.
 *  2. (Slice 4 — coming) Generate from an OpenAPI spec.
 *
 * The API parses + Zod-validates the manifest before persisting; on
 * failure we surface the validation message verbatim.
 */
export function CustomManifestModal(props: {
  onClose: () => void;
  onInstalled: (id: string) => void;
}) {
  const [json, setJson] = useState<string>(EXAMPLE);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openapiUrl, setOpenapiUrl] = useState("");
  const [generating, setGenerating] = useState(false);

  const generateFromOpenAPI = async () => {
    setGenerating(true); setError(null);
    try {
      const { manifest } = await generateManifestFromOpenAPI({ specUrl: openapiUrl });
      setJson(JSON.stringify(manifest, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    setInstalling(true); setError(null);
    try {
      const parsed = JSON.parse(json);
      const created = await installIntegration({
        manifestId: parsed.id,
        manifestSource: "custom",
        customManifest: parsed,
      });
      props.onInstalled(created.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[720px] max-w-full max-h-[88vh] overflow-y-auto">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Install custom manifest</CardTitle>
            <button onClick={props.onClose} className="rounded-md p-1 text-fg/60 hover:bg-panel2 hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-fg/65">
              Paste a manifest JSON document below. It will be validated against the integration manifest schema
              before installation. See the docs for the schema reference.
            </p>
            {error ? (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <div className="flex-1 break-words">{error}</div>
              </div>
            ) : null}
            <div className="rounded-md border border-line bg-panel2 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-fg/70">
                <Sparkles className="h-3.5 w-3.5" /> Generate from OpenAPI spec
              </div>
              <div className="flex gap-1.5">
                <Input
                  placeholder="https://api.example.com/openapi.json"
                  value={openapiUrl}
                  onChange={(e) => setOpenapiUrl(e.target.value)}
                />
                <Button size="sm" variant="secondary" onClick={generateFromOpenAPI} disabled={generating || !openapiUrl}>
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
                </Button>
              </div>
              <p className="text-[11px] text-fg/55">Pulls the spec, infers auth + actions, and pre-fills the editor below. Edit before installing.</p>
            </div>
            <Label>Manifest JSON</Label>
            <Textarea
              rows={20}
              spellCheck={false}
              className="font-mono text-xs"
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
              <Button onClick={submit} disabled={installing}>
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Install
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const EXAMPLE = `{
  "id": "my-custom-rest",
  "version": "1.0.0",
  "name": "My Custom REST API",
  "description": "A custom HTTP API integration for our internal system.",
  "category": "other",
  "vendor": "Internal",
  "source": "custom",
  "tags": ["custom"],
  "connection": {
    "baseUrl": "{{config.baseUrl}}",
    "auth": { "type": "api_key", "placement": "header", "paramName": "Authorization", "prefix": "Bearer " },
    "fields": [
      { "key": "baseUrl", "label": "Base URL", "type": "url", "required": true },
      { "key": "apiKey",  "label": "API key",  "type": "secret", "required": true, "credentialKind": "api_key" }
    ],
    "test": { "method": "GET", "path": "/health", "expectStatus": [200], "headers": {} },
    "allowedHosts": []
  },
  "capabilities": {
    "actions": [
      {
        "id": "ping",
        "name": "Ping",
        "description": "Simple GET /health",
        "input": [],
        "request": {
          "method": "GET", "path": "/health",
          "query": {}, "headers": {},
          "bodyEncoding": "none", "timeoutMs": 15000,
          "retry": { "maxAttempts": 2, "initialDelayMs": 500, "backoff": "exponential", "retryOnStatus": [502,503,504] }
        },
        "output": { "select": "$" },
        "mutates": false,
        "requiresConfirmation": false,
        "tags": []
      }
    ],
    "triggers": [],
    "syncs": []
  },
  "ui": { "sections": [] }
}`;
