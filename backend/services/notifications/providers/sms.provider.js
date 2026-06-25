/**
 * SMS Provider
 * ------------
 * Defines a common interface so the rest of the app never cares which SMS
 * gateway is actually in use. To switch providers, change which class is
 * exported at the bottom of this file -- nothing else in the codebase
 * needs to change.
 *
 * Interface contract: every provider must expose
 *   async send({ to, message }) -> { success: boolean, providerResponse?: any, error?: string }
 */

/**
 * MockSmsProvider
 * ----------------
 * Default provider while no real SMS gateway is purchased yet.
 * Just logs what *would* be sent, and always reports success so the rest
 * of the booking flow can be developed/tested end-to-end.
 */
class MockSmsProvider {
  async send({ to, message }) {
    console.log('--- [MOCK SMS] ---');
    console.log(`To: ${to}`);
    console.log(`Message: ${message}`);
    console.log('------------------');
    return { success: true, providerResponse: { mock: true } };
  }
}

/**
 * BulkSmsBdProvider
 * ------------------
 * STUB for a real Bangladesh bulk SMS gateway (e.g. BulkSMSBD, Alpha SMS,
 * Banglalink/Grameenphone masking SMS API, etc.). Most of these gateways
 * follow a similar pattern: an HTTP GET/POST with api_key, sender_id (a
 * pre-approved masking name), recipient number, and message text.
 *
 * This class is NOT wired in or active. It exists so that once you buy a
 * real SMS API key, you only need to:
 *   1. Fill in API_URL / API_KEY / SENDER_ID below (or read from .env)
 *   2. Adjust the request shape to match your chosen provider's docs
 *   3. Swap the export at the bottom of this file
 *
 * Nothing in notification.service.js or server.js needs to change.
 */
class BulkSmsBdProvider {
  constructor() {
    this.apiUrl = process.env.SMS_API_URL || '';
    this.apiKey = process.env.SMS_API_KEY || '';
    this.senderId = process.env.SMS_SENDER_ID || '';
  }

  async send({ to, message }) {
    if (!this.apiUrl || !this.apiKey) {
      console.error('[BulkSmsBdProvider] Missing SMS_API_URL / SMS_API_KEY in environment. Falling back to no-op.');
      return { success: false, error: 'SMS provider not configured' };
    }

    try {
      // Example shape only -- replace with your actual provider's request
      // format once you have real API docs. Most BD gateways look roughly
      // like this (form-encoded GET or POST):
      //
      // const params = new URLSearchParams({
      //   api_key: this.apiKey,
      //   senderid: this.senderId,
      //   number: to,
      //   message
      // });
      // const response = await fetch(`${this.apiUrl}?${params.toString()}`);
      // const data = await response.json();
      // return { success: data.status === 'success', providerResponse: data };

      throw new Error('BulkSmsBdProvider.send() is a stub -- implement the real HTTP call here once an SMS API key is purchased.');
    } catch (err) {
      console.error('[BulkSmsBdProvider] Failed to send SMS:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = {
  MockSmsProvider,
  BulkSmsBdProvider,
  // Active provider. Swap to `new BulkSmsBdProvider()` once real
  // credentials exist in .env.
  activeProvider: new MockSmsProvider()
};
