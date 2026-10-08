const router = require('express').Router();
const controller = require('../controllers/slots.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

router.get('/api/admin/slots', authenticateAdmin, asyncHandler(controller.list));
router.post('/api/admin/slots', authenticateAdmin, asyncHandler(controller.create));
router.put('/api/admin/slots/:id', authenticateAdmin, asyncHandler(controller.update));
router.delete('/api/admin/slots/:id', authenticateAdmin, asyncHandler(controller.remove));

module.exports = router;
