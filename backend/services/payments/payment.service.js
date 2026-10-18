const settingsService = require('../settings.service');
const sslcommerzProvider = require('./sslcommerz.provider');
const cancellationService = require('../bookings/cancellation.service');
const notificationService = require('../notifications/notification.service');
const { dbGetAsync } = require('../../utils/db-async');

async function computeRequiredAdvance(slotPrice) {
  const percentage = await settingsService.getAdvancePaymentPercentage();
  return Math.round((parseFloat(slotPrice) * percentage / 100) * 100) / 100; // round to 2 decimals
}

async function confirmPaymentByValId(valId, sourceLabel) {
  const validation = await sslcommerzProvider.validateTransaction(valId);

  if (!validation || !validation.tran_id) {
    return { ok: false, reason: 'Validation API returned no transaction data' };
  }

  const transaction = await dbGetAsync(
    `SELECT * FROM payment_transactions WHERE tran_id = ?`,
    [validation.tran_id]
  );
  if (!transaction) {
    return { ok: false, reason: `No local transaction found for tran_id ${validation.tran_id}` };
  }

  const expectedAmount = Number(transaction.amount);
  const actualAmount = Number(validation.amount);
  const isValid = validation.status === 'VALID' || validation.status === 'VALIDATED';
  if (!isValid || !Number.isFinite(actualAmount) || actualAmount <= 0 || Math.abs(expectedAmount - actualAmount) > 0.01 || validation.currency !== transaction.currency) {
    return { ok: false, reason: 'Payment amount, currency or validation status did not match' };
  }

  const booking = await dbGetAsync('SELECT b.id, b.booking_price AS price FROM bookings b WHERE b.id = ?', [transaction.booking_id]);
  if (!booking) return { ok: false, reason: 'Booking not found' };
  const requiredAdvance = await computeRequiredAdvance(booking.price);
  const result = await cancellationService.creditValidatedPayment(transaction.id, transaction.booking_id, { ...validation, val_id: valId }, requiredAdvance);
  if (result.notifyBooking) notificationService.notifyAdvancePaymentConfirmed(result.notifyBooking);
  const { notifyBooking, ...response } = result;
  return response;
}
module.exports = { computeRequiredAdvance, confirmPaymentByValId };
