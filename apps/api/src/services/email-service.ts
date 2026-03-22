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

// Placeholder email service - logs to console, doesn't actually send
export async function sendQuoteEmail(
  input: SendQuoteInput,
  _config?: EmailConfig
): Promise<{ sent: boolean; message: string }> {
  console.log(
    `[Email] Would send quote ${input.quoteNumber} to: ${input.to.join(", ")}`
  );
  console.log(`[Email] Subject: ${input.subject}`);
  console.log(`[Email] Message: ${input.message.slice(0, 200)}...`);

  // In production, use nodemailer:
  // const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
  // await transporter.sendMail({ from, to, subject, html: message, attachments: [{ filename: 'quote.pdf', content: pdfBuffer }] });

  return {
    sent: true,
    message: `Quote email queued for ${input.to.length} recipient(s)`,
  };
}
