import nodemailer from "nodemailer";

export interface SendQuoteInput {
  to: string[];
  subject: string;
  message: string;
  quoteNumber: string;
  pdfHtml?: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

function getEmailConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "noreply@bidwright.app",
    fromName: process.env.SMTP_FROM_NAME ?? "Bidwright",
  };
}

export async function sendQuoteEmail(input: SendQuoteInput, config?: EmailConfig): Promise<{ sent: boolean; message: string }> {
  const emailConfig = config ?? getEmailConfig();

  if (!emailConfig) {
    console.log(`[Email] No SMTP configured. Would send quote ${input.quoteNumber} to: ${input.to.join(", ")}`);
    console.log(`[Email] Subject: ${input.subject}`);
    return { sent: false, message: `Email not sent - no SMTP configuration. Would have sent to ${input.to.length} recipient(s).` };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.port === 465,
      auth: emailConfig.user ? { user: emailConfig.user, pass: emailConfig.pass } : undefined,
    });

    const mailOptions: nodemailer.SendMailOptions = {
      from: `"${emailConfig.fromName}" <${emailConfig.from}>`,
      to: input.to.join(", "),
      subject: input.subject,
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Quote ${input.quoteNumber}</h2>
        <div style="color: #555; line-height: 1.6;">${input.message.replace(/\n/g, "<br>")}</div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #999; font-size: 12px;">Sent via Bidwright</p>
      </div>`,
    };

    // If PDF HTML is provided, attach as HTML file
    if (input.pdfHtml) {
      mailOptions.attachments = [{
        filename: `Quote-${input.quoteNumber}.html`,
        content: input.pdfHtml,
        contentType: "text/html",
      }];
    }

    await transporter.sendMail(mailOptions);
    return { sent: true, message: `Quote sent to ${input.to.length} recipient(s)` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Email] Send failed: ${msg}`);
    return { sent: false, message: `Email send failed: ${msg}` };
  }
}

export async function testEmailConnection(config: EmailConfig): Promise<{ success: boolean; message: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: 5000,
    });

    await transporter.verify();
    return { success: true, message: "SMTP connection verified successfully" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `SMTP connection failed: ${msg}` };
  }
}

export function validateEmailConfig(config: Partial<EmailConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.host) errors.push("SMTP host is required");
  if (!config.port || config.port < 1 || config.port > 65535) errors.push("Valid SMTP port is required (1-65535)");
  if (!config.from) errors.push("From address is required");
  if (config.from && !config.from.includes("@")) errors.push("From address must be a valid email");
  return { valid: errors.length === 0, errors };
}
