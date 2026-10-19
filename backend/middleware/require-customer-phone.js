const { normalizePhone } = require('../services/customers/customer-auth.service');

module.exports = (req, res, next) => {
  try {
    if (normalizePhone(req.body.customer_phone) !== req.customer.phone) {
      return res.status(403).json({ message: 'Verify the phone number used for this booking.' });
    }
    req.body.customer_phone = req.customer.phone;
    req.body.customer_id = req.customer.id;
    next();
  } catch (error) { res.status(error.status || 400).json({ message: error.message }); }
};
