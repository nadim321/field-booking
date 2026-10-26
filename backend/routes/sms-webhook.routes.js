const router = require('express').Router();
const wrap = require('../middleware/async-handler');
const smsUsage = require('../services/notifications/sms-usage.service');

/**
 * Provider delivery receipts. Disabled until SMS_WEBHOOK_SECRET is set; the provider must send
 * `Authorization: Bearer <secret>`. Body: {"message_id","status"} or {"receipts":[...]} (max 100).
 * Statuses: delivered | failed | undelivered | rejected | expired.
 */
router.post('/api/webhooks/sms-delivery', wrap(async (req, res) => {
  const secret = process.env.SMS_WEBHOOK_SECRET || '';
  if (secret.length < 16) return res.status(503).json({ message: 'Delivery receipts are not enabled' });
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ') || !smsUsage.secretMatches(header.slice(7), secret)) return res.status(401).json({ message: 'Invalid webhook credentials' });
  const receipts = Array.isArray(req.body?.receipts) ? req.body.receipts : [req.body];
  res.json(await smsUsage.applyReceipts(receipts));
}));

module.exports = router;
