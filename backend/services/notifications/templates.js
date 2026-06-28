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

function bookingCreated(booking) {
  const slotLine = formatSlotLine(booking);
  const seasonNote = booking.recurring_booking_id
    ? ' (part of your season booking)'
    : '';
  return {
    smsMessage: `Hi ${booking.customer_name}, your turf booking request for ${slotLine}${seasonNote} has been received and is pending admin approval. - Kickoff Arena`,
    emailSubject: 'Booking Request Received - Kickoff Arena',
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `We've received your turf booking request for ${slotLine}${seasonNote}.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n` +
      `Status: Pending admin approval\n\n` +
      `We'll notify you as soon as it's approved.\n\n` +
      `- Kickoff Arena`
  };
}

function bookingApproved(booking) {
  const slotLine = formatSlotLine(booking);
  return {
    smsMessage: `Good news ${booking.customer_name}! Your turf booking for ${slotLine} is CONFIRMED. See you on the pitch! - Kickoff Arena`,
    emailSubject: 'Booking Confirmed - Kickoff Arena',
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `Your turf booking for ${slotLine} has been approved and confirmed.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n\n` +
      `See you on the pitch!\n\n` +
      `- Kickoff Arena`
  };
}

function bookingCancelled(booking) {
  const slotLine = formatSlotLine(booking);
  return {
    smsMessage: `Hi ${booking.customer_name}, your turf booking for ${slotLine} has been CANCELLED. Contact us if this is unexpected. - Kickoff Arena`,
    emailSubject: 'Booking Cancelled - Kickoff Arena',
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `Your turf booking for ${slotLine} has been cancelled.\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n\n` +
      `If you didn't request this or believe it's a mistake, please contact us.\n\n` +
      `- Kickoff Arena`
  };
}

function paymentReceived(booking) {
  const slotLine = formatSlotLine(booking);
  const amountLine = booking.price ? ` Amount: BDT ${booking.price}.` : '';
  return {
    smsMessage: `Payment received for your turf booking on ${slotLine}.${amountLine} Thank you! - Kickoff Arena`,
    emailSubject: 'Payment Received - Kickoff Arena',
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `We've received your payment for the turf booking on ${slotLine}.${amountLine}\n` +
      `Booking ID: ${booking.id || booking.booking_id}\n\n` +
      `Thank you for booking with us!\n\n` +
      `- Kickoff Arena`
  };
}

/**
 * Sent to the SEASON CUSTOMER when the weekly generation job could not
 * create their booking for a particular week because a one-off booking
 * already took that slot/date first.
 * `recurringBooking` is a recurring_bookings row; `conflictDate` is the
 * specific YYYY-MM-DD that was skipped.
 */
function recurringConflict(recurringBooking, conflictDate) {
  const slotLine = recurringBooking.start_time && recurringBooking.end_time
    ? `${conflictDate} (${recurringBooking.start_time} - ${recurringBooking.end_time})`
    : conflictDate;
  return {
    smsMessage: `Hi ${recurringBooking.customer_name}, unfortunately your season booking slot for ${slotLine} was already taken by another booking this week. Please contact us. - Kickoff Arena`,
    emailSubject: 'Season Booking - Slot Unavailable This Week - Kickoff Arena',
    emailMessage:
      `Hi ${recurringBooking.customer_name},\n\n` +
      `We're sorry, but your season booking slot for ${slotLine} could not be reserved this week ` +
      `because it was already booked by someone else before our system could reserve it for you.\n\n` +
      `Your season booking for other weeks is not affected.\n` +
      `Please contact us if you'd like to arrange an alternative time for this week.\n\n` +
      `- Kickoff Arena`
  };
}

/**
 * Sent to the ADMIN (at the configured EMAIL_USER inbox) for the same
 * conflict event as recurringConflict() above, so they're aware and can
 * manually resolve it with the customer if needed.
 */
function recurringConflictAdminAlert(recurringBooking, conflictDate) {
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
function recurringRequestSubmitted(recurringBooking) {
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
  recurringConflict,
  recurringConflictAdminAlert,
  recurringRequestSubmitted
};