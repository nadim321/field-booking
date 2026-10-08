const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const asyncHandler = require('../middleware/async-handler');

router.post('/api/auth/login', asyncHandler(controller.login));

module.exports = router;
