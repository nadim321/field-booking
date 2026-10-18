const router=require('express').Router();
const auth=require('../middleware/auth');
const wrap=require('../middleware/async-handler');
const service=require('../services/collections/collection.service');
const reports=require('../services/collections/report.service');
router.use('/api/admin/collections',auth);
router.get('/api/admin/collections/export',wrap(async(req,res)=>{
  const data=await reports.report(req.query,true);
  res.set('Cache-Control','no-store').attachment(`collections-${data.start}-${data.end}.csv`).type('text/csv').send(reports.csv(data));
}));
router.get('/api/admin/collections',wrap(async(req,res)=>res.set('Cache-Control','no-store').json(await reports.report(req.query))));
router.post('/api/admin/collections/:id/reverse',wrap(async(req,res)=>res.json(await service.reverse(req.params.id,req.body,req.user))));
router.get('/api/admin/bookings/:id/collections',auth,wrap(async(req,res)=>res.set('Cache-Control','no-store').json(await service.history(req.params.id))));
router.post('/api/admin/bookings/:id/collections',auth,wrap(async(req,res)=>res.json(await service.record(req.params.id,req.body,req.user))));
module.exports=router;
