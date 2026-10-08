const router = require('express').Router();
const controller = require('../controllers/recurring.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

router.post('/api/recurring-bookings', asyncHandler(controller.create));
router.get('/api/admin/recurring-bookings', authenticateAdmin, asyncHandler(controller.list));
router.put('/api/admin/recurring-bookings/:id', authenticateAdmin, asyncHandler(controller.update));
router.delete('/api/admin/recurring-bookings/:id', authenticateAdmin, asyncHandler(controller.remove));
router.post('/api/admin/recurring-bookings/run-now', authenticateAdmin, asyncHandler(controller.runNow));

module.exports = router;
