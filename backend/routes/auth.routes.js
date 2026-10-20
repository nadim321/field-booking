const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const asyncHandler = require('../middleware/async-handler');

router.get('/api/auth/demo-login-config', controller.demoLoginConfig);
router.post('/api/auth/login', asyncHandler(controller.login));
router.post('/api/auth/change-password', require('../middleware/auth'), asyncHandler(controller.changePassword));

module.exports = router;
