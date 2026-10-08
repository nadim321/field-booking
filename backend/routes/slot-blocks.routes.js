const router = require('express').Router();
const controller = require('../controllers/slot-blocks.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

router.post('/api/admin/slot-blocks/bulk', authenticateAdmin, asyncHandler(controller.create));
router.get('/api/admin/slot-blocks', authenticateAdmin, asyncHandler(controller.list));
router.delete('/api/admin/slot-blocks/bulk', authenticateAdmin, asyncHandler(controller.remove));

module.exports = router;
