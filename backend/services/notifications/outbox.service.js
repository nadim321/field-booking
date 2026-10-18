const db = require('../../database');
const HOUR = 3600000;
const EVENTS = ['booking_created','booking_confirmed','booking_cancelled','reminder'];
const STATUSES = ['queued','processing','retrying','simulated','failed','skipped'];
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
function kickoff(b) {
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b.booking_date) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(b.start_time)) return null;
  const midnight = new Date(b.booking_date + 'T00:00:00Z');
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0,10) !== b.booking_date) return null;
  return new Date(`${b.booking_date}T${b.start_time.length === 5 ? b.start_time+':00' : b.start_time}+06:00`).getTime();
}
async function transaction(work) {
  const c = await db.promiseConnection();
  try { await c.beginTransaction(); const value = await work(c); await c.commit(); return value; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
async function booking(c,id) {
  const [[b]] = await c.query('SELECT b.*,s.start_time,s.end_time FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? FOR UPDATE',[id]);
  return b;
}
async function message(c,b,event) {
  const [rows] = await c.query("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('turf_name','turf_phone')");
  const settings = Object.fromEntries(rows.map(r=>[r.setting_key,r.setting_value]));
  const description = {booking_created:'Booking request received; awaiting approval.',booking_confirmed:'Your booking is confirmed.',booking_cancelled:'Your booking is cancelled.',reminder:'Reminder: your game starts soon.'}[event];
  return `${settings.turf_name || 'Turf Booking'}: ${description} Booking #${b.id}. ${b.booking_date}, ${b.start_time}–${b.end_time} (Asia/Dhaka).${settings.turf_phone ? ' Contact: '+settings.turf_phone+'.' : ''}`;
}
async function enqueue(c,b,event,now=Date.now(),skipReason=null) {
  const start = kickoff(b);
  const due = event === 'reminder' && start !== null ? start-2*HOUR : now;
  const reason = skipReason || (event === 'reminder' && start === null ? 'INVALID_KICKOFF' : null);
  await c.query(`INSERT INTO notification_jobs
    (booking_id,event,version,recipient,message,status,scheduled_at,next_attempt_at,kickoff_at,last_error,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
  [b.id,event,b.notification_version || 0,b.customer_phone || '',await message(c,b,event),reason?'skipped':'queued',due,due,start,reason,now,now]);
}
async function created(c,id,now=Date.now()) {
  const b = await booking(c,id);
  await c.query('UPDATE bookings SET notification_initialized=1 WHERE id=?',[id]);
  await enqueue(c,b,'booking_created',now);
}
async function transition(c,before,after,now=Date.now()) {
  if (before.status === after.status) return;
  const b = {...before,...after,notification_version:Number(before.notification_version || 0)+1};
  await c.query('UPDATE bookings SET notification_version=?,notification_initialized=1 WHERE id=?',[b.notification_version,b.id]);
  await c.query(`UPDATE notification_jobs SET status='skipped',last_error='BOOKING_STATUS_CHANGED',updated_at=?
    WHERE booking_id=? AND event IN ('booking_created','booking_confirmed','reminder') AND status IN ('queued','retrying','failed')`,[now,b.id]);
  if (b.status === 'approved') {
    await enqueue(c,b,'booking_confirmed',now);
    const start=kickoff(b);
    await enqueue(c,b,'reminder',now,start===null?'INVALID_KICKOFF':start-now<2*HOUR?'SHORT_NOTICE_APPROVAL':null);
  } else if (b.status === 'cancelled') await enqueue(c,b,'booking_cancelled',now);
}
function irrelevant(job,b,now) {
  if (!b) return 'BOOKING_REMOVED';
  if (Number(job.version)!==Number(b.notification_version)) return 'BOOKING_STATUS_CHANGED';
  if (job.event==='booking_created' && b.status!=='pending') return 'BOOKING_STATUS_CHANGED';
  if (job.event==='booking_cancelled') return b.status==='cancelled'?null:'BOOKING_STATUS_CHANGED';
  if (['booking_confirmed','reminder'].includes(job.event)) {
    if (b.status!=='approved') return 'BOOKING_NOT_APPROVED';
    const start=kickoff(b);
    if (start===null) return 'INVALID_KICKOFF';
    if (start<=now) return 'KICKOFF_PASSED';
  }
  return null;
}
async function initializeExisting(now=Date.now()) {
  // Small batches bound startup work; each booking is marked once, under its lock.
  const ids=await transaction(async c=>(await c.query('SELECT id FROM bookings WHERE notification_initialized=0 ORDER BY id LIMIT 100'))[0]);
  for (const {id} of ids) await transaction(async c=>{
    const b=await booking(c,id);
    if (!b || b.notification_initialized) return;
    await c.query('UPDATE bookings SET notification_initialized=1 WHERE id=?',[id]);
    if (b.status==='approved' && kickoff(b)!==null && kickoff(b)-now>=2*HOUR) await enqueue(c,b,'reminder',now);
  });
}
async function retry(id,actor,now=Date.now()) {
  return transaction(async c=>{
    const [[ref]]=await c.query('SELECT booking_id FROM notification_jobs WHERE id=?',[id]);
    if (!ref) throw failure('Notification not found',404);
    const b=await booking(c,ref.booking_id);
    const [[job]]=await c.query('SELECT * FROM notification_jobs WHERE id=? FOR UPDATE',[id]);
    if (job.status!=='failed' || manualReason(job,b,now)) throw failure('Only failed, still-relevant notifications can be retried');
    const root=job.source_job_id || job.id;
    const [active]=await c.query("SELECT id FROM notification_jobs WHERE (id=? OR source_job_id=?) AND (status='processing' OR (requested_by IS NOT NULL AND status IN ('queued','retrying'))) FOR UPDATE",[root,root]);
    if(active.length) throw failure('A manual send is already pending');
    await c.query("UPDATE notification_jobs SET status='queued',cycle_attempts=0,next_attempt_at=?,last_error=NULL,requested_by=?,updated_at=? WHERE id=?",[now,actor,now,id]);
    await c.query("INSERT INTO notification_attempts (job_id,attempt_number,outcome,started_at,finished_at,actor_id) VALUES (?,?,'manual_retry',?,?,?)",[id,job.attempts,now,now,actor]);
    return {message:'Notification queued for simulation; no real SMS will be sent'};
  });
}
function manualReason(job,b,now) {
  const reason=irrelevant(job,b,now);
  if(reason) return reason;
  const start=kickoff(b);
  if(start===null) return 'INVALID_KICKOFF';
  if(start<=now) return 'KICKOFF_PASSED';
  if(!['queued','retrying','failed','simulated'].includes(job.status)) return 'NOT_SENDABLE';
  return null;
}
async function resend(id,actor,key,now=Date.now()) {
  if(typeof key!=='string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(key)) throw failure('Invalid request key',400);
  return transaction(async c=>{
    const [[ref]]=await c.query('SELECT booking_id FROM notification_jobs WHERE id=?',[id]);
    if(!ref) throw failure('Notification not found',404);
    const b=await booking(c,ref.booking_id);
    const [[job]]=await c.query('SELECT * FROM notification_jobs WHERE id=? FOR UPDATE',[id]);
    const [[previous]]=await c.query('SELECT * FROM notification_resend_requests WHERE request_key=? FOR UPDATE',[key]);
    if(previous) {
      if(Number(previous.source_job_id)!==Number(id) || previous.actor_id!==actor) throw failure('Request key already used');
      return {job_id:previous.job_id,message:'Queued for simulation. No real SMS will be sent.'};
    }
    const reason=manualReason(job,b,now);
    if(reason) throw failure('Notification cannot be sent: '+reason);
    const root=job.source_job_id || job.id;
    const [active]=await c.query("SELECT id FROM notification_jobs WHERE (id=? OR source_job_id=?) AND (status='processing' OR (requested_by IS NOT NULL AND status IN ('queued','retrying'))) FOR UPDATE",[root,root]);
    if(active.some(x=>Number(x.id)!==Number(id)) || (job.requested_by!=null && ['queued','retrying'].includes(job.status))) throw failure('A manual send is already pending');
    const body=await message(c,b,job.event);
    let target=id;
    // Future automatic reminders retain their schedule; completed jobs retain history.
    const separate=job.status==='simulated' || (job.event==='reminder' && !job.source_job_id && kickoff(b)-2*HOUR>now);
    if(separate) {
      const [insert]=await c.query(`INSERT INTO notification_jobs
        (booking_id,event,version,recipient,message,status,scheduled_at,next_attempt_at,kickoff_at,created_at,updated_at,dispatch_key,source_job_id,requested_by)
        VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?,?)`,
        [job.booking_id,job.event,job.version,b.customer_phone || '',body,now,now,kickoff(b),now,now,key,root,actor]);
      target=insert.insertId;
    } else {
      await c.query("UPDATE notification_jobs SET status='queued',cycle_attempts=0,next_attempt_at=?,kickoff_at=?,message=?,recipient=?,last_error=NULL,requested_by=?,updated_at=? WHERE id=?",[now,kickoff(b),body,b.customer_phone || '',actor,now,id]);
    }
    await c.query("INSERT INTO notification_attempts(job_id,attempt_number,outcome,started_at,finished_at,actor_id,message) VALUES (?,?,'manual_send',?,?,?,?)",[target,separate?0:job.attempts,now,now,actor,body]);
    await c.query('INSERT INTO notification_resend_requests(request_key,source_job_id,job_id,actor_id,created_at) VALUES (?,?,?,?,?)',[key,id,target,actor,now]);
    return {job_id:target,message:'Queued for simulation. No real SMS will be sent.'};
  });
}
module.exports={manualReason,resend,HOUR,EVENTS,STATUSES,kickoff,transaction,booking,message,created,transition,irrelevant,initializeExisting,retry,failure};
