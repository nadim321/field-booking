/**
 * Best-effort email and legacy notification dispatch.
 * Booking request, approval, cancellation and reminder SMS are persisted through
 * outbox.service in the booking transaction and processed by notification.worker.
 * This facade skips direct SMS for those tracked lifecycle events. Email remains
 * optional and best-effort; its failure does not roll back a committed booking.
 * Other legacy SMS events continue to use the mock adapter.
 */

const smsProvider = require('./providers/sms.provider');
const emailProvider = require('./providers/email.provider');
const templates = require('./templates');
const venueService = require('../venue.service');

/**
 * Sends email and, for untracked events, legacy mock SMS.
 * Never throws -- failures are caught and logged so a notification
 * problem can never bubble up and break the calling request handler.
 */
async function dispatch(booking, templateFn, triggerLabel) {
  let content;
  let turfName = 'Turf Booking';
  let venueContact = '';
  try {
    const venue = await venueService.read();
    turfName = venue.turf_name || 'Turf Booking';
    venueContact = [venue.turf_address, venue.turf_phone, venue.turf_email].filter(Boolean).join(' | ');
  } catch (err) {
    console.warn(`[NotificationService] Failed to load turf_name for ${triggerLabel}, using fallback.`);
  }

  try {
    content = templateFn(booking, turfName);
    if (venueContact) { content.emailMessage += `\n\n${venueContact}`; content.smsMessage += `\n${venueContact}`; }
  } catch (err) {
    console.error(`[NotificationService] Failed to build template for "${triggerLabel}":`, err.message);
    return;
  }

  const { smsMessage, emailSubject, emailMessage } = content;

  // Durable booking SMS jobs are written in the booking transaction. Email remains unchanged.
  const tracked = ['booking_created', 'booking_approved', 'booking_cancelled', 'advance_payment_confirmed'].includes(triggerLabel);
  if (!tracked && booking.customer_phone) {
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
  } else if (!tracked) {
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
  let turfName = 'Turf Booking';
  let venueContact = '';
  try {
    const venue = await venueService.read();
    turfName = venue.turf_name || 'Turf Booking';
    venueContact = [venue.turf_address, venue.turf_phone, venue.turf_email].filter(Boolean).join(' | ');
  } catch (err) {
    console.warn(`[NotificationService] Failed to load turf_name for ${triggerLabel}, using fallback.`);
  }

  try {
    content = templateFn(...args, turfName);
    if (venueContact) content.emailMessage += `\n\n${venueContact}`;
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
