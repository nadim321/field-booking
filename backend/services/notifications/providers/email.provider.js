/**
 * Email Provider
 * --------------
 * Same pattern as sms.provider.js: a common interface, a mock for testing,
 * and a real provider for production use.
 *
 * Interface contract: every provider must expose
 *   async send({ to, subject, message }) -> { success: boolean, providerResponse?: any, error?: string }
 */

const nodemailer = require('nodemailer');

/**
 * MockEmailProvider
 * ------------------
 * Logs what would be sent, always reports success. Useful for local dev
 * or tests without hitting a real mail server.
 */
class MockEmailProvider {
  async send({ to, subject, message, attachments }) {
    console.log('--- [MOCK EMAIL] ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${message}`);
    if (attachments && attachments.length > 0) {
      console.log(`Attachments: ${attachments.map(a => a.filename).join(', ')}`);
    }
    console.log('--------------------');
    return { success: true, providerResponse: { mock: true } };
  }
}

/**
 * Builds nodemailer transport options from environment variables.
 *
 *   EMAIL_SERVICE  nodemailer well-known service name (gmail, outlook, zoho, ...). Default: gmail.
 *   EMAIL_HOST     custom SMTP host, e.g. mail.yourdomain.com for a cPanel mailbox.
 *                  When set it is used INSTEAD of EMAIL_SERVICE.
 *   EMAIL_PORT     default 465
 *   EMAIL_SECURE   true/false; default true only for port 465 (587 uses STARTTLS)
 *
 * Gmail needs a 16-character App Password in EMAIL_PASS (2-Step Verification on),
 * never the normal account password. A cPanel mailbox uses its own address and password.
 */
function buildTransportOptions(env = process.env) {
  const auth = { user: env.EMAIL_USER || '', pass: env.EMAIL_PASS || '' };
  const host = (env.EMAIL_HOST || '').trim();
  if (host) {
    const port = Number(env.EMAIL_PORT) || 465;
    const secure = env.EMAIL_SECURE === undefined || env.EMAIL_SECURE === '' ? port === 465 : String(env.EMAIL_SECURE).toLowerCase() === 'true';
    return { host, port, secure, auth };
  }
  return { service: (env.EMAIL_SERVICE || 'gmail').trim().toLowerCase(), auth };
}

/**
 * SmtpEmailProvider (exported as GmailSmtpProvider for compatibility)
 * ------------------
 * Sends real email through the SMTP service/host chosen by the variables above.
 * Required: EMAIL_USER, EMAIL_PASS. Optional: EMAIL_FROM (defaults to EMAIL_USER).
 *
 * The transporter is created lazily (on first send, not at require time)
 * so a missing/bad config doesn't crash the whole server on startup --
 * it just makes send() fail gracefully and log an error.
 */
class SmtpEmailProvider {
  constructor() {
    this.user = process.env.EMAIL_USER || '';
    this.pass = process.env.EMAIL_PASS || '';
    this.fromAddress = process.env.EMAIL_FROM || this.user;
    this._transporter = null;
  }

  _getTransporter() {
    if (this._transporter) return this._transporter;
    this._transporter = nodemailer.createTransport(buildTransportOptions());
    return this._transporter;
  }

  async send({ to, subject, message, attachments }) {
    if (!this.user || !this.pass) {
      console.error('[SmtpEmailProvider] Missing EMAIL_USER / EMAIL_PASS in environment. Falling back to no-op.');
      return { success: false, error: 'Email provider not configured' };
    }

    try {
      const transporter = this._getTransporter();
      const mailOptions = {
        from: this.fromAddress,
        to,
        subject,
        text: message
      };
      if (attachments && attachments.length > 0) {
        mailOptions.attachments = attachments;
      }
      const info = await transporter.sendMail(mailOptions);
      return { success: true, providerResponse: { messageId: info.messageId } };
    } catch (err) {
      console.error('[SmtpEmailProvider] Failed to send email:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = {
  MockEmailProvider,
  SmtpEmailProvider,
  GmailSmtpProvider: SmtpEmailProvider,
  buildTransportOptions,
  // Active provider -- sends real email through the SMTP service/host from the environment.
  // Swap back to `new MockEmailProvider()` for local dev/testing if you
  // don't want real emails going out.
  activeProvider: new SmtpEmailProvider()
};