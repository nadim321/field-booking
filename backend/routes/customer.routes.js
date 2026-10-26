const router = require('express').Router();
const asyncHandler = require('../middleware/async-handler');
const customerAuth = require('../middleware/customer-auth');
const controller = require('../controllers/customer-auth.controller');
const bookings = require('../controllers/customer-bookings.controller');

router.post('/api/customer/auth/request-otp', asyncHandler(controller.requestOtp));
router.post('/api/customer/auth/verify-otp', asyncHandler(controller.verifyOtp));
router.get('/api/customer/bookings', customerAuth, asyncHandler(bookings.list));
router.post('/api/customer/bookings/:id/cancellation-request', customerAuth, asyncHandler(bookings.requestCancellation));
router.get('/api/customer/cancellation-requests', customerAuth, asyncHandler(bookings.cancellationRequests));
router.get('/api/admin/cancellation-requests', require('../middleware/auth'), asyncHandler(bookings.adminCancellationRequests));
router.post('/api/admin/cancellation-requests/:id/review', require('../middleware/auth'), asyncHandler(bookings.reviewCancellationRequest));

module.exports = router;
