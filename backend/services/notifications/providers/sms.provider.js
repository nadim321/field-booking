/**
 * SMS adapters. The durable booking worker is pinned to MockSmsProvider.
 * A future real integration requires idempotency and delivery-receipt handling;
 * changing activeProvider alone does not enable real booking SMS.
 * send({ to, message }) returns { success, providerResponse?, error? }.
 * The mock performs no network calls and does not log personal information.
 */
class MockSmsProvider {
  async send({ to, message }) {
    // Simulation only. Never log recipients or message bodies.
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
 * This stub is inactive. Implement and review gateway-specific delivery and
 * idempotency handling before enabling a real provider in any caller.
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
  // Legacy, non-outbox notifications also remain simulated.
  activeProvider: new MockSmsProvider()
};
