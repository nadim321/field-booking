const {randomUUID}=require('node:crypto');
const outbox=require('./outbox.service');
const {bookingProvider}=require('./providers/sms.provider');
const logger=require('../../utils/logger');
const smsUsage=require('./sms-usage.service');
const delays=[60000,300000,900000];
const LEASE_MS=60000;
const SEND_TIMEOUT_MS=10000;
const defaultProvider=bookingProvider;

async function finish(job,outcome,now,error=null,providerMessageId=null) {
  await outbox.transaction(async c=>{
    const [[current]]=await c.query('SELECT * FROM notification_jobs WHERE id=? FOR UPDATE',[job.id]);
    if (!current || current.status!=='processing' || current.lease_token!==job.lease_token) return;
    const status=outcome==='simulated'?'simulated':outcome==='sent'?'sent':current.cycle_attempts>=4?'failed':'retrying';
    // A new provider message id starts a fresh delivery history for this job.
    const receiptColumns=providerMessageId?',provider_message_id=?,delivery_status=NULL,delivery_updated_at=NULL':'';
    await c.query('UPDATE notification_jobs SET status=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,last_error=?,updated_at=?'+receiptColumns+' WHERE id=?',
      [status,now+(delays[current.cycle_attempts-1] || 0),error,now,...(providerMessageId?[providerMessageId]:[]),job.id]);
    await c.query('UPDATE notification_attempts SET outcome=?,finished_at=?,error_code=? WHERE job_id=? AND lease_token=? AND outcome=\'processing\'',
      [outcome,now,error,job.id,job.lease_token]);
  });
}
async function refreshAndClaim(id,now) {
  return outbox.transaction(async c=>{
    const [[ref]]=await c.query('SELECT booking_id FROM notification_jobs WHERE id=?',[id]);
    if (!ref) return null;
    // Same lock order as booking writers and manual retries: booking, then job.
    const b=await outbox.booking(c,ref.booking_id);
    const [[job]]=await c.query('SELECT * FROM notification_jobs WHERE id=? FOR UPDATE',[id]);
    if (!job || !['queued','retrying','failed'].includes(job.status)) return null;
    const reason=job.requested_by!=null ? outbox.manualReason(job,b,now) : outbox.irrelevant(job,b,now);
    if (reason) {
      await c.query("UPDATE notification_jobs SET status='skipped',last_error=?,updated_at=? WHERE id=?",[reason,now,id]); return null;
    }
    const kickoff=outbox.kickoff(b);
    if (job.event==='reminder' && Number(job.kickoff_at)!==kickoff) {
      const due=job.source_job_id ? Number(job.scheduled_at) : kickoff-2*outbox.HOUR;
      job.message=await outbox.message(c,b,'reminder'); job.scheduled_at=due;
      job.next_attempt_at=Math.max(due,job.status==='retrying'?Number(job.next_attempt_at):due);
      await c.query('UPDATE notification_jobs SET kickoff_at=?,scheduled_at=?,next_attempt_at=?,message=?,updated_at=? WHERE id=?',[kickoff,due,job.next_attempt_at,job.message,now,id]);
    }
    if (job.status==='failed' || Number(job.next_attempt_at)>now) return null;
    if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(job.recipient) && !/^\+[1-9]\d{7,14}$/.test(job.recipient)) {
      await c.query("UPDATE notification_jobs SET status='skipped',last_error='INVALID_RECIPIENT',updated_at=? WHERE id=?",[now,id]); return null;
    }
    const token=randomUUID();
    await c.query("UPDATE notification_jobs SET status='processing',attempts=attempts+1,cycle_attempts=cycle_attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?",[token,now+LEASE_MS,now,id]);
    await c.query("INSERT INTO notification_attempts (job_id,attempt_number,outcome,started_at,message,lease_token) VALUES (?,?,'processing',?,?,?)",[id,Number(job.attempts)+1,now,job.message,token]);
    return {...job,lease_token:token};
  });
}
async function processClaim(job,provider,now) {
  let timer;
  try {
    const result=await Promise.race([provider.send({to:job.recipient,message:job.message,idempotencyKey:String(job.id)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),SEND_TIMEOUT_MS);})]);
    const simulated=result?.success===true && result?.providerResponse?.mock===true;
    const sent=result?.success===true && !simulated;
    await finish(job,simulated?'simulated':sent?'sent':'failed',now(),simulated||sent?null:'SMS_PROVIDER_REJECTED',sent?smsUsage.safeMessageId(result.providerMessageId):null);
    await smsUsage.record({purpose:'booking',provider:provider.providerName||'unknown',result,message:job.message,jobId:job.id,now:now()});
  } catch { await finish(job,'failed',now(),'SMS_PROVIDER_FAILED_OR_TIMEOUT'); }
  finally {clearTimeout(timer);}
}
async function runOnce({provider=defaultProvider,now=()=>Date.now()}={}) {
  await outbox.initializeExisting(now());
  const expired=await outbox.transaction(async c=>(await c.query("SELECT * FROM notification_jobs WHERE status='processing' AND lease_until<=? ORDER BY id LIMIT 100",[now()]))[0]);
  for (const job of expired) await finish(job,'interrupted',now(),'WORKER_LEASE_EXPIRED');
  // Reminders must be checked even before their old due time, in case slot time moved earlier.
  const maxId=await outbox.transaction(async c=>(await c.query('SELECT COALESCE(MAX(id),0) AS id FROM notification_jobs'))[0][0].id);
  let cursor=0;
  while (cursor<maxId) {
    const rows=await outbox.transaction(async c=>(await c.query(`SELECT id FROM notification_jobs
      WHERE id>? AND id<=? AND status IN ('queued','retrying','failed') AND (event='reminder' OR next_attempt_at<=?) ORDER BY id LIMIT 200`,[cursor,maxId,now()]))[0]);
    if (!rows.length) break;
    for (const row of rows) {
      const job=await refreshAndClaim(row.id,now());
      if (job) await processClaim(job,provider,now);
      cursor=row.id;
    }
  }
}
let interval, running;
function start() {
  if(interval) return;
  const tick=()=>{
    if(running) return;
    running=runOnce().catch(()=>logger.error('notification_worker_failed',{code:'WORKER_ERROR'})).finally(()=>{running=null;});
  };
  tick(); interval=setInterval(tick,60000);
}
async function stop(){clearInterval(interval);interval=null;if(running) await running;}
module.exports={start,stop,runOnce,refreshAndClaim,processClaim,LEASE_MS};
