import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { PDFDocument } from "pdf-lib";
import { sendProjectQuote } from "./send-project-quote.js";
import { sendQuoteEmail } from "./email-service.js";
import { renderQuotePdf } from "./quote-pdf.js";
import { workspaceFixture } from "./pdf-service.test.js";

async function fixture() {
  const doc = await PDFDocument.create();
  doc.addPage().drawText("Quote TEST-42, revision 3");
  const bytes = Buffer.from(await doc.save());
  const workspace = {
    ...workspaceFixture(),
    quote: { quoteNumber: "TEST-42", title: "Current customer proposal" },
    currentRevision: {
      ...workspaceFixture().currentRevision,
      id: "rev-3", revisionNumber: 3,
      pdfPreferences: { activeTemplate: "backup", layouts: { main: { branding: { accentColor: "#012345" } }, backup: { customerFacing: false } } },
    },
  } as any;
  const activities: unknown[][] = [];
  const store = {
    logActivity: async (...args: unknown[]) => { activities.push(args); },
    getSettings: async () => ({ general: { orgName: "Tenant company" }, brand: {}, termsAndConditions: "Tenant terms" }),
    listReportSections: async () => [], getFileNode: async () => null, getDocument: async () => null,
  } as any;
  return { bytes, workspace, store, activities };
}

test("send uses the same revision snapshot and saved customer layout, then attaches real PDF bytes", async () => {
  const { bytes, workspace, store, activities } = await fixture();
  let sent: any;
  const result = await sendProjectQuote(store, "project-one", workspace, { contacts: ["recipient@example.test"], message: "Attached quote" }, {
    render: async (actualStore, projectId, snapshot, template, layout) => {
      assert.equal(actualStore, store);
      assert.equal(projectId, "project-one");
      assert.equal(snapshot, workspace);
      assert.equal(template, "main");
      assert.equal(layout, workspace.currentRevision.pdfPreferences.layouts.main);
      return { buffer: bytes, contentType: "application/pdf", warnings: [] };
    },
    send: async (input) => { sent = input; return { sent: true, message: "sent" }; },
  });
  assert.equal(result.sent, true);
  assert.deepEqual(sent.pdf, { filename: "Quote-TEST-42-Rev-3.pdf", content: bytes });
  assert.equal((await PDFDocument.load(sent.pdf.content)).getPageCount(), 1);
  assert.equal(activities[0]?.[1], "rev-3");
});

test("rendering failure or a missing selected appendix sends nothing; SMTP failure records no sent activity", async () => {
  const { bytes, workspace, store, activities } = await fixture();
  let sends = 0;
  const send = async () => { sends++; return { sent: false, message: "SMTP unavailable" }; };
  for (const render of [
    async () => { throw new Error("browser unavailable"); },
    async () => ({ buffer: bytes, contentType: "application/pdf", warnings: ["Appendix has no stored PDF"] }),
    async () => ({ buffer: Buffer.from("not a PDF"), contentType: "application/pdf", warnings: [] }),
  ]) {
    await assert.rejects(sendProjectQuote(store, "project-one", workspace, { contacts: ["recipient@example.test"], message: "" }, { render, send }));
  }
  assert.equal(sends, 0);
  await sendProjectQuote(store, "project-one", workspace, { contacts: ["recipient@example.test"], message: "" }, {
    render: async () => ({ buffer: bytes, contentType: "application/pdf", warnings: [] }), send,
  });
  assert.equal(sends, 1);
  assert.deepEqual(activities, []);
});

test("shared PDF renderer includes the current quote and tenant branding", async () => {
  const { bytes, workspace, store } = await fixture();
  let html = "";
  const result = await renderQuotePdf(store, "project-one", workspace, "main", undefined, async (value) => {
    html = value;
    return { buffer: bytes, contentType: "application/pdf" };
  });
  assert.match(html, /TEST-42/);
  assert.match(html, /Tenant company/);
  assert.match(html, /Tenant terms/);
  assert.deepEqual(result.buffer, bytes);
});

test("mailer delivers a PDF MIME attachment, not an HTML attachment", async (t) => {
  const { bytes } = await fixture();
  let mail: any;
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async (options: unknown) => { mail = options; } }));
  const result = await sendQuoteEmail({
    to: ["recipient@example.test"], quoteNumber: "TEST-42", subject: "Quote TEST-42", message: "Attached quote",
    pdf: { filename: "Quote-TEST-42-Rev-3.pdf", content: bytes },
  }, { host: "unused.invalid", port: 587, user: "", pass: "", from: "sender@example.test", fromName: "Test" });
  assert.equal(result.sent, true);
  assert.equal(mail.attachments.length, 1);
  assert.equal(mail.attachments[0].contentType, "application/pdf");
  assert.equal(mail.attachments[0].contentDisposition, "attachment");
  assert.equal(mail.attachments[0].filename, "Quote-TEST-42-Rev-3.pdf");
  assert.deepEqual(mail.attachments[0].content, bytes);
});
