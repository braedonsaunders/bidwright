import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import MsgReaderModule, { type FieldsData } from "@kenjiuno/msgreader";
import PostalMime, { type Address as PostalAddress, type Attachment as PostalAttachment, type Email as PostalEmail } from "postal-mime";
import type { CanonicalEmailIngestManifest, CanonicalFileIngestManifest, FileIngestCapability } from "@bidwright/domain";
import type { FileAdapterIngestResult, FileIngestAdapter, FileIngestContext, FileIngestSource } from "../types.js";
import {
  makeProvenance,
  normalizeIssues,
  persistFileIngestArtifacts,
  textPreview,
} from "../utils.js";

const ADAPTER_ID = "bidwright-email.manifest";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["eml", "msg"]);
const MsgReader = ((MsgReaderModule as any).default ?? MsgReaderModule) as new (input: DataView) => {
  getFileData(): FieldsData;
  getAttachment(attachment: NonNullable<FieldsData["attachments"]>[number]): { content: ArrayBuffer | Uint8Array };
};
type MsgReaderInstance = InstanceType<typeof MsgReader>;

function toDataView(buffer: Buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function stripHtmlTags(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sha256Bytes(value: Buffer | Uint8Array | ArrayBuffer | string) {
  return createHash("sha256").update(typeof value === "string" ? value : Buffer.from(value as any)).digest("hex");
}

function postalAddressList(addresses: PostalAddress[] | undefined) {
  const values: string[] = [];

  for (const address of addresses ?? []) {
    if ("group" in address && Array.isArray(address.group)) {
      values.push(...postalAddressList(address.group));
      continue;
    }

    const parts = [address.name, address.address].map((item) => item?.trim()).filter(Boolean);
    if (parts.length > 0) values.push(parts.join(" "));
  }

  return values;
}

function postalAttachmentBuffer(attachment: PostalAttachment) {
  if (typeof attachment.content === "string") {
    return Buffer.from(attachment.content, attachment.encoding === "base64" ? "base64" : "utf8");
  }

  if (attachment.content instanceof ArrayBuffer) {
    return Buffer.from(attachment.content);
  }

  return Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength);
}

function recipientList(recipients: FieldsData[] | undefined, kind?: "to" | "cc" | "bcc") {
  return (recipients ?? [])
    .filter((recipient) => !kind || recipient.recipType === kind)
    .map((recipient) => recipient.smtpAddress || recipient.email || recipient.name || "")
    .map((value) => value.trim())
    .filter(Boolean);
}

function safeIsoDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function manifestFromEml(email: PostalEmail): CanonicalEmailIngestManifest {
  const bodyText = [
    email.text,
    email.html ? stripHtmlTags(email.html) : undefined,
  ]
    .map((value) => value?.trim())
    .find((value) => value && value.length > 0) ?? "";

  return {
    subject: email.subject?.trim() || "(no subject)",
    from: postalAddressList(email.from ? [email.from] : undefined)[0],
    to: postalAddressList(email.to),
    cc: postalAddressList(email.cc),
    bcc: postalAddressList(email.bcc),
    replyTo: postalAddressList(email.replyTo),
    sentAt: safeIsoDate(email.date),
    receivedAt: null,
    messageId: email.messageId ?? null,
    bodyTextLength: bodyText.length,
    bodyPreview: textPreview(bodyText, 1200),
    hasHtml: Boolean(email.html),
    attachmentCount: email.attachments.length,
    attachments: email.attachments.map((attachment, index) => {
      const bytes = postalAttachmentBuffer(attachment);
      return {
        fileName: attachment.filename?.trim() || `attachment-${index + 1}`,
        mimeType: attachment.mimeType ?? null,
        size: bytes.byteLength,
        checksum: sha256Bytes(bytes),
      };
    }),
  };
}

function manifestFromMsg(info: FieldsData, reader: MsgReaderInstance): CanonicalEmailIngestManifest {
  const from = [info.senderSmtpAddress, info.senderEmail, info.senderName].filter(Boolean).join(" ").trim();
  const bodyText = [
    info.body,
    info.preview,
    info.bodyHtml ? stripHtmlTags(info.bodyHtml) : undefined,
  ]
    .map((value) => value?.trim())
    .find((value) => value && value.length > 0) ?? "";

  const attachments = (info.attachments ?? [])
    .filter((attachment) => !attachment.attachmentHidden)
    .map((attachment, index) => {
      let size: number | null = null;
      let checksum: string | null = null;
      try {
        const data = reader.getAttachment(attachment);
        const bytes = data.content instanceof ArrayBuffer
          ? Buffer.from(data.content)
          : Buffer.from(data.content.buffer, data.content.byteOffset, data.content.byteLength);
        size = bytes.byteLength;
        checksum = sha256Bytes(bytes);
      } catch {
        size = null;
        checksum = null;
      }
      return {
        fileName: attachment.fileName || attachment.fileNameShort || attachment.name || `attachment-${index + 1}`,
        mimeType: attachment.attachMimeTag ?? null,
        size,
        checksum,
      };
    });

  return {
    subject: info.subject?.trim() || "(no subject)",
    from: from || undefined,
    to: recipientList(info.recipients, "to"),
    cc: recipientList(info.recipients, "cc"),
    bcc: recipientList(info.recipients, "bcc"),
    replyTo: [],
    sentAt: safeIsoDate(info.clientSubmitTime),
    receivedAt: safeIsoDate(info.messageDeliveryTime),
    messageId: info.messageId ?? null,
    bodyTextLength: bodyText.length,
    bodyPreview: textPreview(bodyText, 1200),
    hasHtml: Boolean(info.bodyHtml),
    attachmentCount: attachments.length,
    attachments,
  };
}

function capability(format?: string): FileIngestCapability {
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "bidwright-email",
    family: "email",
    formats: Array.from(FORMATS),
    status: FORMATS.has((format ?? "").toLowerCase()) || !format ? "available" : "unsupported",
    message: "Email manifest parsing is embedded server-side for RFC822 .eml and Outlook .msg files.",
    features: {
      text: true,
      structuredData: true,
      geometry: false,
      quantities: false,
      preview: true,
      rawArtifacts: true,
      requiresCloud: false,
    },
    metadata: {
      localHandlers: ["postal-mime", "@kenjiuno/msgreader"],
    },
  };
}

export const emailFileAdapter: FileIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  family: "email",
  formats: FORMATS,
  priority: 80,
  capability,
  async ingest(source: FileIngestSource, context: FileIngestContext): Promise<FileAdapterIngestResult> {
    const activeCapability = capability(context.format);
    const buffer = await readFile(context.absPath);
    let email: CanonicalEmailIngestManifest;
    if (context.format === "msg") {
      const reader = new MsgReader(toDataView(buffer));
      email = manifestFromMsg(reader.getFileData(), reader);
    } else {
      email = manifestFromEml(await PostalMime.parse(buffer, {
          rfc822Attachments: true,
          forceRfc822Attachments: true,
          attachmentEncoding: "arraybuffer",
        }));
    }

    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: "embedded_email_manifest_parser",
      confidence: 0.92,
    });
    const issues = email.bodyTextLength > 0 ? [] : [{
      severity: "warning",
      code: "email_empty_body",
      message: "No readable message body was found, but headers and attachments were parsed.",
    }];
    const manifest: CanonicalFileIngestManifest = {
      schemaVersion: 1,
      runStatus: "indexed",
      family: "email",
      adapter: activeCapability,
      provenance,
      summary: {
        parser: "email-file-adapter",
        subject: email.subject,
        from: email.from,
        sentAt: email.sentAt,
        receivedAt: email.receivedAt,
        attachmentCount: email.attachmentCount,
      },
      artifacts: [],
      email,
      issues: normalizeIssues(issues),
    };
    const artifacts = await persistFileIngestArtifacts({
      projectId: source.projectId,
      sourceId: source.id,
      checksum: context.checksum,
      manifest,
      extraArtifacts: [{
        kind: "email-manifest",
        fileName: "email.json",
        payload: email,
        description: "Parsed email manifest",
      }],
    });
    const finalManifest = { ...manifest, artifacts };
    return {
      status: "indexed",
      family: "email",
      manifest: finalManifest,
      issues,
    };
  },
};
