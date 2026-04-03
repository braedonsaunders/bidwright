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
  authMethod?: "smtp" | "oauth2";
  oauth2TenantId?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
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

async function fetchOAuth2AccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://outlook.office365.com/.default",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth2 token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function createTransporter(config: EmailConfig): Promise<nodemailer.Transporter> | nodemailer.Transporter {
  if (config.authMethod === "oauth2") {
    // OAuth2 path — need to fetch token first
    return (async () => {
      if (!config.oauth2TenantId || !config.oauth2ClientId || !config.oauth2ClientSecret) {
        throw new Error("OAuth2 requires tenantId, clientId, and clientSecret");
      }
      const accessToken = await fetchOAuth2AccessToken(
        config.oauth2TenantId,
        config.oauth2ClientId,
        config.oauth2ClientSecret,
      );
      return nodemailer.createTransport({
        host: "smtp.office365.com",
        port: 587,
        secure: false,
        auth: {
          type: "OAuth2",
          user: config.from,
          accessToken,
        } as any,
      });
    })();
  }

  // Standard SMTP path
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
}

export async function sendQuoteEmail(input: SendQuoteInput, config?: EmailConfig): Promise<{ sent: boolean; message: string }> {
  const emailConfig = config ?? getEmailConfig();

  if (!emailConfig) {
    console.log(`[Email] No SMTP configured. Would send quote ${input.quoteNumber} to: ${input.to.join(", ")}`);
    console.log(`[Email] Subject: ${input.subject}`);
    return { sent: false, message: `Email not sent - no SMTP configuration. Would have sent to ${input.to.length} recipient(s).` };
  }

  try {
    const transporter = await createTransporter(emailConfig);

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
    const transporter = await createTransporter(config);

    // For OAuth2, just verifying the transporter was created (token fetched) is a good test
    if (config.authMethod === "oauth2") {
      await transporter.verify();
      return { success: true, message: "Office 365 OAuth2 connection verified successfully" };
    }

    await transporter.verify();
    return { success: true, message: "SMTP connection verified successfully" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Connection failed: ${msg}` };
  }
}

export function validateEmailConfig(config: Partial<EmailConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.authMethod === "oauth2") {
    if (!config.oauth2TenantId) errors.push("Azure Tenant ID is required");
    if (!config.oauth2ClientId) errors.push("Azure Client ID is required");
    if (!config.oauth2ClientSecret) errors.push("Azure Client Secret is required");
    if (!config.from) errors.push("From address is required");
    if (config.from && !config.from.includes("@")) errors.push("From address must be a valid email");
  } else {
    if (!config.host) errors.push("SMTP host is required");
    if (!config.port || config.port < 1 || config.port > 65535) errors.push("Valid SMTP port is required (1-65535)");
    if (!config.from) errors.push("From address is required");
    if (config.from && !config.from.includes("@")) errors.push("From address must be a valid email");
  }

  return { valid: errors.length === 0, errors };
}
