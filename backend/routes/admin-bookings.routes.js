const router = require('express').Router();
const controller = require('../controllers/admin-bookings.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

router.get('/api/admin/bookings/export', authenticateAdmin, asyncHandler(controller.exportCsv));
router.get('/api/admin/bookings', authenticateAdmin, asyncHandler(controller.list));
router.get('/api/admin/bookings/:id/cancellation-quote', authenticateAdmin, asyncHandler(controller.quote));
router.post('/api/admin/bookings/:id/cancel', authenticateAdmin, asyncHandler(controller.cancel));
router.post('/api/admin/bookings/:id/refund-record', authenticateAdmin, asyncHandler(controller.refund));
router.put('/api/admin/bookings/:id', authenticateAdmin, asyncHandler(controller.update));
router.delete('/api/admin/bookings/:id', authenticateAdmin, asyncHandler(controller.remove));

module.exports = router;
