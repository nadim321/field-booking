const router = require('express').Router();
const auth = require('../middleware/auth');
const wrap = require('../middleware/async-handler');
const controller = require('../controllers/operations.controller');

const managerOnly = (req, res, next) => ['admin', 'owner', 'manager'].includes(req.user.role)
  ? next()
  : res.status(403).json({ message: 'Owner or manager access required' });

router.get('/api/admin/audit-log', auth, managerOnly, wrap(controller.audit));
router.get('/api/admin/expenses', auth, managerOnly, wrap(controller.expenses));
router.post('/api/admin/expenses', auth, managerOnly, wrap(controller.addExpense));
router.post('/api/admin/expenses/:id/void', auth, managerOnly, wrap(controller.voidExpense));
router.get('/api/admin/daily-summary', auth, managerOnly, wrap(controller.dailySummary));
router.get('/api/admin/daily-closings', auth, managerOnly, wrap(controller.dailyClosings));
router.post('/api/admin/daily-closings/:date', auth, managerOnly, wrap(controller.closeDay));
router.get('/api/admin/sms-usage', auth, managerOnly, wrap(controller.smsUsage));
module.exports = router;
