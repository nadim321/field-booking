/**
 * SSLCommerz Payment Provider
 * -----------------------------
 * Thin wrapper around the official `sslcommerz-lts` package, isolating
 * all SSLCommerz-specific request/response shapes in one place so the
 * rest of the app (server.js routes) only deals with our own simplified
 * shapes.
 *
 * Credentials are read from environment variables -- see .env.example.
 * Sandbox is the default (is_live defaults to false) since this project
 * has not purchased live credentials yet.
 *
 * SECURITY NOTE: this module only ever sends server-controlled values to
 * SSLCommerz (our own tran_id, prices we calculated, customer contact
 * info already stored in our own DB) -- it never forwards raw,
 * unvalidated request bodies.
 */

const crypto = require('crypto');
const SSLCommerzPayment = require('sslcommerz-lts');

const STORE_ID = process.env.SSLCOMMERZ_STORE_ID || '';
const STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD || '';
const IS_LIVE = process.env.SSLCOMMERZ_IS_LIVE === 'true'; // defaults to false (sandbox)

function getClient() {
  if (!STORE_ID || !STORE_PASSWORD) {
    throw new Error('SSLCommerz credentials not configured (SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD missing in .env)');
  }
  return new SSLCommerzPayment(STORE_ID, STORE_PASSWORD, IS_LIVE);
}

/** Generates a short, unique transaction ID, well under SSLCommerz's
 * 30-character tran_id limit even for large booking IDs. */
function generateTranId(bookingId) {
  const shortTime = Date.now().toString(36);
  const random = crypto.randomBytes(3).toString('hex');
  return `KA${bookingId}_${shortTime}_${random}`;
}

/**
 * Initiates a payment session with SSLCommerz.
 * `params`: { tran_id, amount, customer_name, customer_phone, customer_email,
 *             success_url, fail_url, cancel_url, ipn_url, product_name }
 * Returns the raw SSLCommerz response (callers read .GatewayPageURL,
 * .sessionkey, .status, .failedreason).
 */
async function initiateSession(params) {
  const client = getClient();

  const data = {
    total_amount: params.amount,
    currency: 'BDT',
    tran_id: params.tran_id,
    success_url: params.success_url,
    fail_url: params.fail_url,
    cancel_url: params.cancel_url,
    ipn_url: params.ipn_url,
    shipping_method: 'NO',
    product_name: params.product_name || 'Turf Booking Advance Payment',
    product_category: 'Sports Booking',
    product_profile: 'general',
    cus_name: params.customer_name || 'Customer',
    cus_email: params.customer_email || 'noemail@example.com',
    cus_add1: 'Dhaka',
    cus_city: 'Dhaka',
    cus_state: 'Dhaka',
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    cus_phone: params.customer_phone || '01700000000',
    // value_a carries our own booking_id through the whole gateway flow --
    // SSLCommerz echoes it back unchanged in both the redirect and the
    // IPN payload, which lets us tie a notification back to a booking
    // without an extra DB lookup by tran_id alone.
    value_a: String(params.booking_id)
  };

  return client.init(data);
}

/**
 * Validates a transaction with SSLCommerz's Order Validation API using a
 * val_id (from the IPN payload or the success redirect query string).
 * NEVER trust a val_id's accompanying claims (amount, status) without
 * calling this -- it is the authoritative server-to-server check.
 */
async function validateTransaction(valId) {
  const client = getClient();
  return client.validate({ val_id: valId });
}

/**
 * Verifies the verify_sign field on an IPN payload, per SSLCommerz's
 * documented algorithm: take the fields listed in verify_key, sort keys
 * alphabetically (with store_passwd's MD5 added), build a key=value&...
 * string, and MD5 it -- it must match verify_sign exactly.
 *
 * This is a FAST, LOCAL check (no network call) that can reject an
 * obviously-tampered or forged IPN payload immediately. It is NOT a
 * substitute for calling validateTransaction() with the val_id --
 * SSLCommerz's own documentation treats the Order Validation API as the
 * authoritative check, so both are used together: this catches malformed
 * forgeries cheaply, the Validation API confirms the transaction is real
 * and matches our own records.
 */
function verifyIpnSignature(body) {
  if (!body || !body.verify_sign || !body.verify_key) return false;
  if (!STORE_PASSWORD) return false;

  const fieldsToInclude = body.verify_key.split(',');
  const dataForHash = {};
  for (const field of fieldsToInclude) {
    if (body[field] !== undefined) {
      dataForHash[field] = body[field];
    }
  }
  dataForHash['store_passwd'] = crypto.createHash('md5').update(STORE_PASSWORD).digest('hex');

  const sortedKeys = Object.keys(dataForHash).sort();
  const hashString = sortedKeys.map(k => `${k}=${dataForHash[k]}`).join('&');
  const computedSign = crypto.createHash('md5').update(hashString).digest('hex');

  return computedSign === body.verify_sign;
}

module.exports = {
  generateTranId,
  initiateSession,
  validateTransaction,
  verifyIpnSignature,
  IS_LIVE
};
