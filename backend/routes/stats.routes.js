const router = require('express').Router();
const controller = require('../controllers/stats.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

router.post('/api/admin/cleanup-holds', authenticateAdmin, asyncHandler(controller.cleanup));
router.get('/api/admin/stats', authenticateAdmin, asyncHandler(controller.summary));

module.exports = router;
