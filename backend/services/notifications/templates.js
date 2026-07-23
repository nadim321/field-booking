/**
 * Notification Templates
 * -----------------------
 * Plain message text for each trigger point. Kept separate from
 * notification.service.js so wording/branding can be edited without
 * touching any sending or booking logic.
 *
 * Each function returns { smsMessage, emailSubject, emailMessage }.
 * `booking` is the booking row (joined with slot start_time/end_time/price
 * where available); fields are read defensively since not every call site
 * has every joined column.
 */

function formatSlotLine(booking) {
  const time = booking.start_time && booking.end_time
    ? `${booking.start_time} - ${booking.end_time}`
    : 'your selected time';
  return `${booking.booking_date || ''} (${time})`.trim();
}

function bookingCreated(booking, turfName) {
  const slotLine = formatSlotLine(booking);
  const seasonNote = booking.recurring_booking_id
    ? ' (part of your season booking)'
    : '';
  return {
    smsMessage: `Hi ${booking.customer_name}, your turf booking request for ${slotLine}${seasonNote} has been received and is pending admin approval. - ${turfName}`,
    emailSubject: `Booking Request Received - ${turfName}`,
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `We've received your turf booking request for ${slotLine}${seasonNote}.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n` +
      `Status: Pending admin approval\n\n` +
      `We'll notify you as soon as it's approved.\n\n` +
      `- ${turfName}`
  };
}

function bookingApproved(booking, turfName) {
  const slotLine = formatSlotLine(booking);
  return {
    smsMessage: `Good news ${booking.customer_name}! Your turf booking for ${slotLine} is CONFIRMED. See you on the pitch! - ${turfName}`,
    emailSubject: `Booking Confirmed - ${turfName}`,
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `Your turf booking for ${slotLine} has been approved and confirmed.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n\n` +
      `See you on the pitch!\n\n` +
      `- ${turfName}`
  };
}

function bookingCancelled(booking, turfName) {
  const slotLine = formatSlotLine(booking);
  return {
    smsMessage: `Hi ${booking.customer_name}, your turf booking for ${slotLine} has been CANCELLED. Contact us if this is unexpected. - ${turfName}`,
    emailSubject: `Booking Cancelled - ${turfName}`,
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `Your turf booking for ${slotLine} has been cancelled.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n\n` +
      `If you didn't request this or believe it's a mistake, please contact us.\n\n` +
      `- ${turfName}`
  };
}

function paymentReceived(booking, turfName) {
  const slotLine = formatSlotLine(booking);
  const amountLine = booking.price ? ` Amount: BDT ${booking.price}.` : '';
  return {
    smsMessage: `Payment received for your turf booking on ${slotLine}.${amountLine} Thank you! - ${turfName}`,
    emailSubject: `Payment Received - ${turfName}`,
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `We've received your payment for the turf booking on ${slotLine}.${amountLine}\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n\n` +
      `Thank you for booking with us!\n\n` +
      `- ${turfName}`
  };
}

/**
 * Sent when a verified advance payment automatically confirms a booking
 * (the real SSLCommerz flow -- distinct from the legacy paymentReceived
 * template above, which was written for the old mock-payment flow and is
 * kept only for backward compatibility).
 */
function advancePaymentConfirmed(booking, turfName) {
  const slotLine = formatSlotLine(booking);
  const balanceDue = booking.price && booking.amount_paid
    ? (parseFloat(booking.price) - parseFloat(booking.amount_paid))
    : null;
  const balanceLine = balanceDue && balanceDue > 0
    ? ` Remaining balance of BDT ${balanceDue.toFixed(2)} is due at the turf.`
    : '';
  return {
    smsMessage: `Hi ${booking.customer_name}, your advance payment was received and your turf booking for ${slotLine} is CONFIRMED.${balanceLine} - ${turfName}`,
    emailSubject: `Booking Confirmed - Advance Payment Received - ${turfName}`,
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `We've received your advance payment and your turf booking for ${slotLine} is now CONFIRMED.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n` +
      `Amount paid: BDT ${booking.amount_paid}\n` +
      (balanceDue && balanceDue > 0 ? `Remaining balance (due at the turf): BDT ${balanceDue.toFixed(2)}\n` : '') +
      `\nSee you on the pitch!\n\n` +
      `- ${turfName}`
  };
}

/**
 * Sent when a payment attempt failed or was cancelled (the booking stays
 * pending; this just keeps the customer informed of what happened).
 */
function paymentFailed(booking, reason, turfName) {
  const slotLine = formatSlotLine(booking);
  return {
    smsMessage: `Hi ${booking.customer_name}, your payment attempt for the turf booking on ${slotLine} was ${reason}. Your booking is still pending -- please try again or contact us. - ${turfName}`,
    emailSubject: `Payment Not Completed - ${turfName}`,
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `Your payment attempt for the turf booking on ${slotLine} was ${reason}.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n` +
      `Your booking is still pending -- please try the payment again, or contact us if you'd like to arrange payment another way.\n\n` +
      `- ${turfName}`
  };
}

/**
 * Sent to the SEASON CUSTOMER when the weekly generation job could not
 * create their booking for a particular week because a one-off booking
 * already took that slot/date first.
 */
function recurringConflict(recurringBooking, conflictDate, turfName) {
  const slotLine = recurringBooking.start_time && recurringBooking.end_time
    ? `${conflictDate} (${recurringBooking.start_time} - ${recurringBooking.end_time})`
    : conflictDate;
  return {
    smsMessage: `Hi ${recurringBooking.customer_name}, unfortunately your season booking slot for ${slotLine} was already taken by another booking this week. Please contact us. - ${turfName}`,
    emailSubject: `Season Booking - Slot Unavailable This Week - ${turfName}`,
    emailMessage:
      `Hi ${recurringBooking.customer_name},\n\n` +
      `We're sorry, but your season booking slot for ${slotLine} could not be reserved this week ` +
      `because it was already booked by someone else before our system could reserve it for you.\n\n` +
      `Your season booking for other weeks is not affected.\n` +
      `Please contact us if you'd like to arrange an alternative time for this week.\n\n` +
      `- ${turfName}`
  };
}

/**
 * Sent to the ADMIN (at the configured EMAIL_USER inbox) for the same
 * conflict event as recurringConflict() above, so they're aware and can
 * manually resolve it with the customer if needed.
 */
function recurringConflictAdminAlert(recurringBooking, conflictDate, turfName) {
  const slotLine = recurringBooking.start_time && recurringBooking.end_time
    ? `${conflictDate} (${recurringBooking.start_time} - ${recurringBooking.end_time})`
    : conflictDate;
  return {
    smsMessage: '', // admin alert is email-only; see notification.service.js
    emailSubject: 'Season Booking Conflict - Admin Action May Be Needed',
    emailMessage:
      `A season booking could not be auto-generated this week due to a conflict.\n\n` +
      `Recurring booking ID: ${recurringBooking.id}\n` +
      `Customer: ${recurringBooking.customer_name} (${recurringBooking.customer_phone})\n` +
      `Slot/date affected: ${slotLine}\n\n` +
      `The slot was already booked by a separate one-off reservation before the ` +
      `weekly generation job ran. The customer has been notified automatically. ` +
      `You may want to contact them to offer an alternative if appropriate.`
  };
}

/**
 * Sent to the ADMIN when a customer submits a new self-serve season
 * booking request, so the admin knows to check the approval queue.
 */
function recurringRequestSubmitted(recurringBooking, turfName) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[recurringBooking.day_of_week] || `day ${recurringBooking.day_of_week}`;
  return {
    smsMessage: '', // admin alert is email-only; see notification.service.js
    emailSubject: 'New Season Booking Request Awaiting Approval',
    emailMessage:
      `A new season booking request has been submitted and is awaiting your approval.\n\n` +
      `Recurring booking ID: ${recurringBooking.id}\n` +
      `Customer: ${recurringBooking.customer_name} (${recurringBooking.customer_phone})\n` +
      (recurringBooking.customer_email ? `Email: ${recurringBooking.customer_email}\n` : '') +
      (recurringBooking.team_name ? `Team: ${recurringBooking.team_name}\n` : '') +
      `Requested day: every ${dayName}\n` +
      `Date range: ${recurringBooking.start_date} to ${recurringBooking.end_date}\n\n` +
      `Please review and approve or reject this request from the admin panel.`
  };
}

module.exports = {
  bookingCreated,
  bookingApproved,
  bookingCancelled,
  paymentReceived,
  advancePaymentConfirmed,
  paymentFailed,
  recurringConflict,
  recurringConflictAdminAlert,
  recurringRequestSubmitted
};