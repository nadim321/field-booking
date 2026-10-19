const auth = require('../services/customers/customer-auth.service');

exports.requestOtp = async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await auth.requestOtp(req.body.phone, req.ip));
};

exports.verifyOtp = async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await auth.verifyOtp(req.body.phone, req.body.code));
};
