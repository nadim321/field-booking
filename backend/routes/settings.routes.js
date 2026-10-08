const router = require('express').Router();
const controller = require('../controllers/settings.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

router.get('/api/booking-policy', asyncHandler(controller.policy));
router.get('/api/admin/settings', authenticateAdmin, asyncHandler(controller.adminSettings));
router.put('/api/admin/settings', authenticateAdmin, asyncHandler(controller.update));
router.get('/api/settings/public', asyncHandler(controller.publicSettings));

module.exports = router;
