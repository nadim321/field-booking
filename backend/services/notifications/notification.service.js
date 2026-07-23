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
const settingsService = require('../settings.service');

/**
 * Sends both channels for a given template result, logging outcomes.
 * Never throws -- failures are caught and logged so a notification
 * problem can never bubble up and break the calling request handler.
 */
async function dispatch(booking, templateFn, triggerLabel) {
  let content;
  let turfName = 'KICKOFF ARENA'; // Fallback
  try {
    turfName = await settingsService.getSetting('turf_name') || 'KICKOFF ARENA';
  } catch (err) {
    console.warn(`[NotificationService] Failed to load turf_name for ${triggerLabel}, using fallback.`);
  }

  try {
    content = templateFn(booking, turfName);
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
      let attachments = [];
      if (triggerLabel === 'booking_approved' || triggerLabel === 'advance_payment_confirmed') {
        try {
          const pdfService = require('../pdf/pdf.service');
          const pdfBuffer = await pdfService.generateBookingSlipPDF(booking);
          attachments.push({
            filename: `booking_slip_${booking.id || booking.booking_id || 'receipt'}.pdf`,
            content: pdfBuffer
          });
        } catch (pdfErr) {
          console.error(`[NotificationService] Failed to generate PDF for attachment:`, pdfErr.message);
        }
      }

      const result = await emailProvider.activeProvider.send({
        to: booking.customer_email,
        subject: emailSubject,
        message: emailMessage,
        attachments
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

/** Trigger: a verified advance payment automatically confirmed a booking. */
function notifyAdvancePaymentConfirmed(booking) {
  return dispatch(booking, templates.advancePaymentConfirmed, 'advance_payment_confirmed');
}

/** Trigger: a payment attempt failed/was cancelled/expired. `reason` is a
 * short human-readable word/phrase (e.g. "declined", "cancelled", "timed out"). */
function notifyPaymentFailed(booking, reason) {
  return dispatch(booking, (b, tName) => templates.paymentFailed(b, reason, tName), 'payment_failed');
}

/**
 * Sends an email-only notification to the SEASON CUSTOMER (no SMS for
 * this one is also fine to add later, but per spec the conflict notice
 * is naturally low-frequency/informational, so email-first keeps this
 * simple; SMS can be added the same way bookingCreated etc. do it if
 * desired later).
 *
 * Actually sends both channels using the same dispatch() path as regular
 * bookings, since recurringBooking has customer_phone/customer_email --
 * this keeps behavior consistent with every other customer-facing
 * notification in the app.
 */
function notifyRecurringConflict(recurringBooking, conflictDate) {
  return dispatch(
    recurringBooking,
    (rb, tName) => templates.recurringConflict(rb, conflictDate, tName),
    'recurring_conflict_customer'
  );
}

/**
 * Sends an EMAIL-ONLY alert to the admin's own inbox (EMAIL_USER), never
 * to a customer. Used for both the weekly-conflict admin alert and the
 * new-season-request admin alert.
 *
 * This intentionally bypasses dispatch() (which sends to booking.customer_*)
 * and the SMS provider entirely -- admin alerts are internal/informational
 * and the admin already gets a flood of customer SMS copies; email is
 * preferred for this is to keep their phone from being spammed.
 */
async function dispatchAdminEmail(templateFn, args, triggerLabel) {
  let content;
  let turfName = 'KICKOFF ARENA'; // Fallback
  try {
    turfName = await settingsService.getSetting('turf_name') || 'KICKOFF ARENA';
  } catch (err) {
    console.warn(`[NotificationService] Failed to load turf_name for ${triggerLabel}, using fallback.`);
  }

  try {
    content = templateFn(...args, turfName);
  } catch (err) {
    console.error(`[NotificationService] Failed to build admin alert template for "${triggerLabel}":`, err.message);
    return;
  }

  const adminAddress = process.env.EMAIL_USER;
  if (!adminAddress) {
    console.warn(`[NotificationService] EMAIL_USER not configured, cannot send admin alert for "${triggerLabel}"`);
    return;
  }

  try {
    const result = await emailProvider.activeProvider.send({
      to: adminAddress,
      subject: content.emailSubject,
      message: content.emailMessage
    });
    if (!result.success) {
      console.error(`[NotificationService] Admin alert email failed for "${triggerLabel}":`, result.error);
    }
  } catch (err) {
    console.error(`[NotificationService] Admin alert email threw for "${triggerLabel}":`, err.message);
  }
}

/** Trigger: weekly generation job hit a conflict -- alert admin (email only). */
function notifyRecurringConflictAdmin(recurringBooking, conflictDate) {
  return dispatchAdminEmail(
    templates.recurringConflictAdminAlert,
    [recurringBooking, conflictDate],
    'recurring_conflict_admin'
  );
}

/** Trigger: customer submitted a new season booking request -- alert admin (email only). */
function notifyRecurringRequestSubmittedAdmin(recurringBooking) {
  return dispatchAdminEmail(
    templates.recurringRequestSubmitted,
    [recurringBooking],
    'recurring_request_submitted_admin'
  );
}

module.exports = {
  notifyBookingCreated,
  notifyBookingApproved,
  notifyBookingCancelled,
  notifyPaymentReceived,
  notifyAdvancePaymentConfirmed,
  notifyPaymentFailed,
  notifyRecurringConflict,
  notifyRecurringConflictAdmin,
  notifyRecurringRequestSubmittedAdmin
};