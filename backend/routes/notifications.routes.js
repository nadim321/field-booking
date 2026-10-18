const router=require('express').Router();
const auth=require('../middleware/auth');
const wrap=require('../middleware/async-handler');
const controller=require('../controllers/notifications.controller');
router.get('/api/admin/notifications',auth,wrap(controller.list));
router.get('/api/admin/notifications/:id',auth,wrap(controller.detail));
router.post('/api/admin/notifications/:id/retry',auth,wrap(controller.retry));
router.post('/api/admin/notifications/:id/resend',auth,wrap(controller.resend));
module.exports=router;
