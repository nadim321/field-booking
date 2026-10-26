const router = require('express').Router();
const auth = require('../middleware/auth');
const wrap = require('../middleware/async-handler');
const controller = require('../controllers/operations.controller');

router.get('/api/admin/audit-log', auth, wrap(async (req, res) => {
  if (!['admin', 'owner', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Owner or manager access required' });
  return controller.audit(req, res);
}));
router.get('/api/admin/expenses', auth, wrap(async (req, res) => {
  if (!['admin', 'owner', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Owner or manager access required' });
  return controller.expenses(req, res);
}));
router.post('/api/admin/expenses', auth, wrap(async (req, res) => {
  if (!['admin', 'owner', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Owner or manager access required' });
  return controller.addExpense(req, res);
}));
router.post('/api/admin/expenses/:id/void', auth, wrap(async (req, res) => {
  if (!['admin', 'owner', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Owner or manager access required' });
  return controller.voidExpense(req, res);
}));
module.exports = router;
