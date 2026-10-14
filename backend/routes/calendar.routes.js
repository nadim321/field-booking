const router = require('express').Router();
const authenticateAdmin = require('../middleware/auth');
const asyncHandler = require('../middleware/async-handler');
const controller = require('../controllers/calendar.controller');

router.get('/api/admin/calendar', authenticateAdmin, asyncHandler(controller.read));
module.exports = router;
