const { normalizePhone, bookingPhoneOtpRequired } = require('../services/customers/customer-auth.service');

module.exports = (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.customer_phone);
    req.body.customer_phone = phone;
    if (req.customer && phone === req.customer.phone) {
      req.body.customer_id = req.customer.id;
    } else if (bookingPhoneOtpRequired()) {
      return res.status(403).json({ message: 'Verify the phone number used for this booking.' });
    }
    next();
  } catch (error) { res.status(error.status || 400).json({ message: error.message }); }
};
