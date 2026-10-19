const router = require('express').Router();
const asyncHandler = require('../middleware/async-handler');
const customerAuth = require('../middleware/customer-auth');
const controller = require('../controllers/customer-auth.controller');
const bookings = require('../controllers/customer-bookings.controller');

router.post('/api/customer/auth/request-otp', asyncHandler(controller.requestOtp));
router.post('/api/customer/auth/verify-otp', asyncHandler(controller.verifyOtp));
router.get('/api/customer/bookings', customerAuth, asyncHandler(bookings.list));

module.exports = router;
