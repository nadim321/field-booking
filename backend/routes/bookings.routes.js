const router = require('express').Router();
const controller = require('../controllers/bookings.controller');
const asyncHandler = require('../middleware/async-handler');
const requirePolicyAcceptance = require('../middleware/policy-acceptance');

router.get('/api/bookings/:id/result', asyncHandler(controller.result));
router.get('/api/bookings/:id/pdf', asyncHandler(controller.pdf));
router.get('/api/slots/available', asyncHandler(controller.available));
router.post('/api/slots/hold', asyncHandler(controller.hold));
router.delete('/api/slots/hold', asyncHandler(controller.releaseHold));
router.post('/api/slots/confirm', requirePolicyAcceptance, asyncHandler(controller.confirm));
router.post('/api/bookings', requirePolicyAcceptance, asyncHandler(controller.create));

module.exports = router;
