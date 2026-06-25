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
  return {
    smsMessage: `Hi ${booking.customer_name}, your turf booking request for ${slotLine} has been received and is pending admin approval. - Kickoff Arena`,
    emailSubject: 'Booking Request Received - Kickoff Arena',
    emailMessage:
      `Hi ${booking.customer_name},\n\n` +
      `We've received your turf booking request for ${slotLine}.\n` +
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

module.exports = {
  bookingCreated,
  bookingApproved,
  bookingCancelled,
  paymentReceived
};
