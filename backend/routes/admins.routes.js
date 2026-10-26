const router = require('express').Router();
const controller = require('../controllers/admins.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticateAdmin = require('../middleware/auth');

const requireRegularAdmin = (req, res, next) => ['admin','owner'].includes(req.user.role)
  ? next()
  : res.status(403).json({ message: 'Admin account management is unavailable to demo accounts' });

router.get('/api/admin/admins', authenticateAdmin, requireRegularAdmin, asyncHandler(controller.list));
router.post('/api/admin/admins', authenticateAdmin, requireRegularAdmin, asyncHandler(controller.create));
router.patch('/api/admin/admins/:id', authenticateAdmin, requireRegularAdmin, asyncHandler(controller.update));
router.delete('/api/admin/admins/:id', authenticateAdmin, requireRegularAdmin, asyncHandler(controller.remove));

module.exports = router;
