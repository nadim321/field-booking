const outbox=require('../services/notifications/outbox.service');
const iso=value=>value==null?null:new Date(Number(value)).toISOString();
function positive(value,label) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1) throw outbox.failure(`Invalid ${label}`,400);
  return Number(value);
}
function project(row) {
  const b=row.booking_status ? {status:row.booking_status,notification_version:row.booking_version,booking_date:row.booking_date,start_time:row.start_time}:null;
  return {id:row.id,booking_id:row.booking_id,event:row.event,status:row.status,
    recipient:row.recipient ? '••••'+row.recipient.slice(-4):'Missing number',
    scheduled_at:iso(row.scheduled_at),next_attempt_at:iso(row.next_attempt_at),updated_at:iso(row.updated_at),
    attempts:row.attempts,last_error:row.last_error,source_job_id:row.source_job_id,requested_by:row.requested_by,
    can_resend:!outbox.manualReason(row,b,Date.now())&&!row.active_manual,
    resend_unavailable_reason:outbox.manualReason(row,b,Date.now()) || (row.active_manual?'MANUAL_SEND_PENDING':null),
    can_retry:row.status==='failed'&&!outbox.manualReason(row,b,Date.now())&&!row.active_manual};
}
const select=`SELECT j.*,EXISTS(SELECT 1 FROM notification_jobs a WHERE (a.id=COALESCE(j.source_job_id,j.id) OR a.source_job_id=COALESCE(j.source_job_id,j.id)) AND (a.status='processing' OR (a.requested_by IS NOT NULL AND a.status IN ('queued','retrying')))) AS active_manual,b.status AS booking_status,b.notification_version AS booking_version,b.booking_date,s.start_time
 FROM notification_jobs j LEFT JOIN bookings b ON b.id=j.booking_id LEFT JOIN slots s ON s.id=b.slot_id`;
exports.list=async(req,res)=>{
  const page=positive(req.query.page || 1,'page'),size=25;
  if(page>100000) throw outbox.failure('Page out of range',400);
  const where=[],params=[];
  for(const [key,allowed] of [['event',outbox.EVENTS],['status',outbox.STATUSES]]) if(req.query[key]) {
    if(!allowed.includes(req.query[key])) throw outbox.failure(`Invalid ${key}`,400);
    where.push(`j.${key}=?`);params.push(req.query[key]);
  }
  if(req.query.booking_id){where.push('j.booking_id=?');params.push(positive(req.query.booking_id,'booking ID'));}
  const clause=where.length?' WHERE '+where.join(' AND '):'';
  const result=await outbox.transaction(async c=>{
    const [[count]]=await c.query('SELECT COUNT(*) AS total FROM notification_jobs j'+clause,params);
    const [rows]=await c.query(select+clause+' ORDER BY j.id DESC LIMIT ? OFFSET ?',[...params,size,(page-1)*size]);
    return {mode:'mock',page,page_size:size,total:count.total,items:rows.map(project)};
  });
  res.set('Cache-Control','no-store').json(result);
};
exports.detail=async(req,res)=>{
  const id=positive(req.params.id,'notification ID');
  const result=await outbox.transaction(async c=>{
    const [[row]]=await c.query(select+' WHERE j.id=?',[id]);
    if(!row) throw outbox.failure('Notification not found',404);
    const [attempts]=await c.query('SELECT id,attempt_number,outcome,started_at,finished_at,error_code,message,actor_id FROM notification_attempts WHERE job_id=? ORDER BY id DESC',[id]);
    return {...project(row),message:row.message,history:attempts.map(a=>({...a,started_at:iso(a.started_at),finished_at:iso(a.finished_at)}))};
  });
  res.set('Cache-Control','no-store').json(result);
};
exports.retry=async(req,res)=>res.json(await outbox.retry(positive(req.params.id,'notification ID'),req.user.id));

exports.resend=async(req,res)=>res.json(await outbox.resend(positive(req.params.id,'notification ID'),req.user.id,req.body.request_key));
