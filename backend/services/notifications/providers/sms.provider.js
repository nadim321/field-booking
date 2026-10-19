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

/** Configurable JSON SMS endpoint for the not-yet-selected OTP provider.
 * Contract: POST {to,message,idempotency_key}; return 2xx on acceptance. */
class OtpSmsProvider {
  constructor({ apiUrl = process.env.SMS_API_URL || '', apiKey = process.env.SMS_API_KEY || '', senderId = process.env.SMS_SENDER_ID || '' } = {}) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.senderId = senderId;
  }

  async send({ to, message, idempotencyKey }) {
    if (!this.apiUrl || !this.apiKey) {
      if (process.env.NODE_ENV !== 'production') return new MockSmsProvider().send({ to, message });
      return { success: false, error: 'OTP SMS provider is not configured' };
    }
    let endpoint;
    try { endpoint = new URL(this.apiUrl); } catch { return { success: false, error: 'OTP SMS endpoint is invalid' }; }
    if (endpoint.protocol !== 'https:') return { success: false, error: 'OTP SMS endpoint must use HTTPS' };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ to, message, sender_id: this.senderId || undefined, idempotency_key: idempotencyKey }),
        signal: AbortSignal.timeout(10000)
      });
      return response.ok ? { success: true } : { success: false, error: `OTP SMS provider returned ${response.status}` };
    } catch { return { success: false, error: 'OTP SMS delivery failed' }; }
  }
}

module.exports = {
  MockSmsProvider,
  BulkSmsBdProvider,
  OtpSmsProvider,
  otpProvider: new OtpSmsProvider(),
  // Legacy, non-outbox notifications also remain simulated.
  activeProvider: new MockSmsProvider()
};
