const venue = require('../services/venue.service');
const { POLICY: cancellationPolicy } = require('../services/bookings/cancellation-policy');
const { bookingPhoneOtpRequired, myBookingsDemoCodeEnabled } = require('../services/customers/customer-auth.service');
exports.policy = (req, res) => res.json(cancellationPolicy);
exports.adminSettings = async (req, res) => res.set('Cache-Control', 'no-store').json(await venue.read());
exports.publicSettings = async (req, res) => res.set('Cache-Control', 'no-store').json({
  ...await venue.read(), cancellation_policy: cancellationPolicy,
  booking_phone_otp_required: bookingPhoneOtpRequired(), my_bookings_demo_code_enabled: myBookingsDemoCodeEnabled()
});
exports.update = async (req, res) => {
  await venue.update(req.body);
  res.json({ message: 'Settings updated successfully' });
};
