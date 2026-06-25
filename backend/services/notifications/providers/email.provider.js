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
  async send({ to, subject, message }) {
    console.log('--- [MOCK EMAIL] ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${message}`);
    console.log('--------------------');
    return { success: true, providerResponse: { mock: true } };
  }
}

/**
 * GmailSmtpProvider
 * ------------------
 * Sends real email via Gmail's SMTP server using nodemailer.
 *
 * IMPORTANT -- Gmail will NOT accept your normal account password here.
 * You must:
 *   1. Turn on 2-Step Verification on the Gmail account
 *   2. Generate an "App Password" at https://myaccount.google.com/apppasswords
 *   3. Put that 16-character app password in .env as EMAIL_PASS
 *      (NOT your real Gmail login password)
 *
 * Required .env variables:
 *   EMAIL_USER = nadim.hq321@gmail.com
 *   EMAIL_PASS = <16-character app password, no spaces>
 *   EMAIL_FROM = "Kickoff Arena <nadim.hq321@gmail.com>"   (optional, defaults to EMAIL_USER)
 *
 * The transporter is created lazily (on first send, not at require time)
 * so a missing/bad config doesn't crash the whole server on startup --
 * it just makes send() fail gracefully and log an error, the same as any
 * other provider failure in this module.
 */
class GmailSmtpProvider {
  constructor() {
    this.user = process.env.EMAIL_USER || '';
    this.pass = process.env.EMAIL_PASS || '';
    this.fromAddress = process.env.EMAIL_FROM || this.user;
    this._transporter = null;
  }

  _getTransporter() {
    if (this._transporter) return this._transporter;

    this._transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.user,
        pass: this.pass
      }
    });
    return this._transporter;
  }

  async send({ to, subject, message }) {
    if (!this.user || !this.pass) {
      console.error('[GmailSmtpProvider] Missing EMAIL_USER / EMAIL_PASS in environment. Falling back to no-op.');
      return { success: false, error: 'Email provider not configured' };
    }

    try {
      const transporter = this._getTransporter();
      const info = await transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text: message
      });
      return { success: true, providerResponse: { messageId: info.messageId } };
    } catch (err) {
      console.error('[GmailSmtpProvider] Failed to send email:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = {
  MockEmailProvider,
  GmailSmtpProvider,
  // Active provider -- now sending real email via Gmail SMTP.
  // Swap back to `new MockEmailProvider()` for local dev/testing if you
  // don't want real emails going out.
  activeProvider: new GmailSmtpProvider()
};