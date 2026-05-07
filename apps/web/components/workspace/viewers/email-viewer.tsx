"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Mail, Paperclip, User, Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui";
import { inspectFileIngest, type FileIngestManifestResponse } from "@/lib/api";

interface EmailViewerProps {
  url: string;
  fileName: string;
  projectId?: string;
  sourceKind?: "source_document" | "file_node";
  sourceId?: string;
}

interface EmailAddress {
  name?: string;
  address?: string;
}

interface EmailAttachment {
  filename?: string;
  mimeType?: string;
  content?: Uint8Array;
}

interface ParsedEmail {
  from?: EmailAddress;
  to?: EmailAddress[];
  cc?: EmailAddress[];
  date?: string;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

function formatAddress(addr: EmailAddress): string {
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  return addr.name || addr.address || "Unknown";
}

function formatAddresses(addrs?: EmailAddress[]): string {
  if (!addrs || addrs.length === 0) return "";
  return addrs.map(formatAddress).join(", ");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailViewer({ url, fileName, projectId, sourceKind, sourceId }: EmailViewerProps) {
  const [email, setEmail] = useState<ParsedEmail | null>(null);
  const [manifest, setManifest] = useState<FileIngestManifestResponse["manifest"]["email"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMsgFile = fileName.toLowerCase().endsWith(".msg");

  useEffect(() => {
    let cancelled = false;

    async function loadEmail() {
      setLoading(true);
      setError(null);

      try {
        if (projectId && sourceKind && sourceId) {
          const result = await inspectFileIngest(projectId, { sourceKind, sourceId });
          if (cancelled) return;
          const emailManifest = result.manifest.email;
          if (!emailManifest) {
            throw new Error("No email manifest was produced for this file.");
          }
          setManifest(emailManifest);
          setEmail(null);
          return;
        }

        if (isMsgFile) {
          throw new Error("Outlook .msg preview requires a stored project file.");
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch email: ${response.statusText}`);

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const PostalMime = (await import("postal-mime")).default;
        const parser = new PostalMime();
        const parsed = await parser.parse(data);
        if (cancelled) return;

        setEmail(parsed as unknown as ParsedEmail);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to parse email");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEmail();
    return () => { cancelled = true; };
  }, [url, isMsgFile, projectId, sourceKind, sourceId]);

  if (manifest) {
    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="border-b border-line bg-panel p-4 space-y-2">
          <h2 className="text-lg font-semibold text-text-primary">{manifest.subject}</h2>
          <div className="space-y-1 text-sm">
            {manifest.from && (
              <div className="flex items-center gap-2 text-text-secondary">
                <User className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="font-medium text-text-primary">From:</span>
                <span>{manifest.from}</span>
              </div>
            )}
            {manifest.to.length > 0 && (
              <div className="flex items-start gap-2 text-text-secondary">
                <Users className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span className="font-medium text-text-primary">To:</span>
                <span>{manifest.to.join(", ")}</span>
              </div>
            )}
            {manifest.cc.length > 0 && (
              <div className="flex items-start gap-2 text-text-secondary">
                <Users className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span className="font-medium text-text-primary">CC:</span>
                <span>{manifest.cc.join(", ")}</span>
              </div>
            )}
            {(manifest.sentAt || manifest.receivedAt) && (
              <div className="flex items-center gap-2 text-text-secondary">
                <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="font-medium text-text-primary">{manifest.sentAt ? "Sent:" : "Received:"}</span>
                <span>{new Date(manifest.sentAt ?? manifest.receivedAt ?? "").toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 bg-bg p-4">
          {manifest.bodyPreview ? (
            <pre className="whitespace-pre-wrap text-sm text-text-primary font-sans leading-relaxed">{manifest.bodyPreview}</pre>
          ) : (
            <p className="text-sm text-text-secondary italic">No readable body text</p>
          )}
        </div>

        {manifest.attachments.length > 0 && (
          <div className="border-t border-line bg-panel p-4">
            <div className="flex items-center gap-2 mb-2">
              <Paperclip className="h-4 w-4 text-text-secondary" />
              <span className="text-sm font-medium text-text-primary">Attachments ({manifest.attachmentCount})</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {manifest.attachments.map((att, i) => (
                <div key={`${att.fileName}-${i}`} className="flex items-center gap-2 rounded border border-line bg-bg px-3 py-1.5 text-sm">
                  <Paperclip className="h-3.5 w-3.5 text-text-secondary" />
                  <span className="text-text-primary">{att.fileName}</span>
                  {att.size != null && <span className="text-text-secondary text-xs">({formatFileSize(att.size)})</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <AlertTriangle className="h-10 w-10 text-yellow-500" />
        <p className="text-sm text-text-secondary">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading || !email) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        <span className="ml-2 text-sm text-text-secondary">Parsing email...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {/* Header */}
      <div className="border-b border-line bg-panel p-4 space-y-2">
        {email.subject && (
          <h2 className="text-lg font-semibold text-text-primary">{email.subject}</h2>
        )}
        <div className="space-y-1 text-sm">
          {email.from && (
            <div className="flex items-center gap-2 text-text-secondary">
              <User className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-medium text-text-primary">From:</span>
              <span>{formatAddress(email.from)}</span>
            </div>
          )}
          {email.to && email.to.length > 0 && (
            <div className="flex items-start gap-2 text-text-secondary">
              <Users className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span className="font-medium text-text-primary">To:</span>
              <span>{formatAddresses(email.to)}</span>
            </div>
          )}
          {email.cc && email.cc.length > 0 && (
            <div className="flex items-start gap-2 text-text-secondary">
              <Users className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span className="font-medium text-text-primary">CC:</span>
              <span>{formatAddresses(email.cc)}</span>
            </div>
          )}
          {email.date && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-medium text-text-primary">Date:</span>
              <span>{new Date(email.date).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 bg-bg p-4">
        {email.html ? (
          <iframe
            srcDoc={email.html}
            className="w-full h-full min-h-[400px] border border-line rounded bg-white"
            sandbox="allow-same-origin"
            title="Email content"
          />
        ) : email.text ? (
          <pre className="whitespace-pre-wrap text-sm text-text-primary font-sans leading-relaxed">
            {email.text}
          </pre>
        ) : (
          <p className="text-sm text-text-secondary italic">No content</p>
        )}
      </div>

      {/* Attachments */}
      {email.attachments && email.attachments.length > 0 && (
        <div className="border-t border-line bg-panel p-4">
          <div className="flex items-center gap-2 mb-2">
            <Paperclip className="h-4 w-4 text-text-secondary" />
            <span className="text-sm font-medium text-text-primary">
              Attachments ({email.attachments.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {email.attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded border border-line bg-bg px-3 py-1.5 text-sm"
              >
                <Paperclip className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-text-primary">{att.filename || `attachment-${i + 1}`}</span>
                {att.content && (
                  <span className="text-text-secondary text-xs">
                    ({formatFileSize(att.content.byteLength)})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
