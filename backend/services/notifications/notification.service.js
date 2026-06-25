/**
 * Notification Service
 * ---------------------
 * This is the ONLY module that server.js / booking logic should ever call
 * for notifications. It does not know or care which SMS/email provider is
 * actually wired up underneath -- see providers/sms.provider.js and
 * providers/email.provider.js for that.
 *
 * Design notes:
 * - SMS is the primary channel, email is secondary (per the spec). Both
 *   are still attempted independently; one failing does not block the
 *   other or the booking flow itself.
 * - All sends are fire-and-forget from the caller's perspective: booking
 *   logic calls notifyX() and does not (and should not) await a failure
 *   here to roll back a booking. A failed SMS/email should never prevent
 *   a booking from being created/approved/cancelled.
 * - customer_email is optional on a booking; if absent, email is silently
 *   skipped (not treated as an error).
 */

const smsProvider = require('./providers/sms.provider');
const emailProvider = require('./providers/email.provider');
const templates = require('./templates');

/**
 * Sends both channels for a given template result, logging outcomes.
 * Never throws -- failures are caught and logged so a notification
 * problem can never bubble up and break the calling request handler.
 */
async function dispatch(booking, templateFn, triggerLabel) {
  let content;
  try {
    content = templateFn(booking);
  } catch (err) {
    console.error(`[NotificationService] Failed to build template for "${triggerLabel}":`, err.message);
    return;
  }

  const { smsMessage, emailSubject, emailMessage } = content;

  // SMS (primary channel)
  if (booking.customer_phone) {
    try {
      const result = await smsProvider.activeProvider.send({
        to: booking.customer_phone,
        message: smsMessage
      });
      if (!result.success) {
        console.error(`[NotificationService] SMS failed for "${triggerLabel}" (booking ${booking.id || booking.booking_id}):`, result.error);
      }
    } catch (err) {
      console.error(`[NotificationService] SMS threw for "${triggerLabel}":`, err.message);
    }
  } else {
    console.warn(`[NotificationService] No customer_phone on booking ${booking.id || booking.booking_id}, skipping SMS for "${triggerLabel}"`);
  }

  // Email (secondary channel) -- optional field, skip quietly if absent
  if (booking.customer_email) {
    try {
      const result = await emailProvider.activeProvider.send({
        to: booking.customer_email,
        subject: emailSubject,
        message: emailMessage
      });
      if (!result.success) {
        console.error(`[NotificationService] Email failed for "${triggerLabel}" (booking ${booking.id || booking.booking_id}):`, result.error);
      }
    } catch (err) {
      console.error(`[NotificationService] Email threw for "${triggerLabel}":`, err.message);
    }
  }
}

/** Trigger: a new booking was created (pending admin approval). */
function notifyBookingCreated(booking) {
  return dispatch(booking, templates.bookingCreated, 'booking_created');
}

/** Trigger: an admin approved a booking. */
function notifyBookingApproved(booking) {
  return dispatch(booking, templates.bookingApproved, 'booking_approved');
}

/** Trigger: an admin (or system) cancelled a booking. */
function notifyBookingCancelled(booking) {
  return dispatch(booking, templates.bookingCancelled, 'booking_cancelled');
}

/** Trigger: payment was received for a booking. */
function notifyPaymentReceived(booking) {
  return dispatch(booking, templates.paymentReceived, 'payment_received');
}

module.exports = {
  notifyBookingCreated,
  notifyBookingApproved,
  notifyBookingCancelled,
  notifyPaymentReceived
};
