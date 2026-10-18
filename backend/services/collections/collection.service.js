const {createHash} = require('node:crypto');
const db = require('../../database');
const outbox = require('../notifications/outbox.service');
const manualMethods = ['cash','bkash','nagad','bank_transfer'];
const fail = (message,status=409) => Object.assign(new Error(message),{status});
function paisa(value) {
  const text=String(value);
  if(!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw fail('Enter a valid amount with at most two decimal places',400);
  const [whole,fraction='']=text.split('.');
  return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
const money = n => (n/100).toFixed(2);
function positiveId(value) {
  if(!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1) throw fail('Invalid ID',400);
  return Number(value);
}
function text(value,max,required=false) {
  if(value==null&&!required) return '';
  if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim())) throw fail(`Text is required and must be at most ${max} characters`,400);
  return value.trim();
}
async function advance(c,price) {
  const [[row]]=await c.query("SELECT setting_value FROM app_settings WHERE setting_key='advance_payment_percentage'");
  const p=Number(row?.setting_value);return Math.round(paisa(price)*(p>0&&p<=100?p:25)/100);
}
async function actorName(c,actor) {
  const [[user]]=await c.query('SELECT username FROM users WHERE id=?',[actor.id]);
  return user?.username || actor.username || `Admin #${actor.id}`;
}
async function total(c,id) {
  const [rows]=await c.query('SELECT kind,amount FROM booking_collections WHERE booking_id=? FOR UPDATE',[id]);
  return rows.reduce((sum,row)=>sum+(row.kind==='reversal'?-1:1)*paisa(row.amount),0);
}
async function receipt(c,key,actor,payload) {
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(key)) throw fail('Invalid request key',400);
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const [[old]]=await c.query('SELECT * FROM collection_requests WHERE request_key=? FOR UPDATE',[key]);
  if(old&&(old.actor_id!==actor.id||old.payload_hash!==hash)) throw fail('Request key already used with different details');
  return {hash,old};
}
async function saveReceipt(c,key,actor,hash,id,now) {
  await c.query('INSERT INTO collection_requests(request_key,actor_id,payload_hash,collection_id,created_at) VALUES (?,?,?,?,?)',[key,actor.id,hash,id,now]);
}
function duplicate(error) {
  if(error.code==='ER_DUP_ENTRY') throw fail('This reference or request has already been recorded');
  throw error;
}
async function record(id,input,actor,now=Date.now()) {
  id=positiveId(id);const amount=paisa(input.amount);
  if(amount<=0) throw fail('Amount must be greater than zero',400);
  if(!manualMethods.includes(input.method)) throw fail('Select cash or a supported manual transfer method',400);
  const reference=text(input.reference,150,input.method!=='cash'),note=text(input.note,500);
  let notify;
  const result=await outbox.transaction(async c=>{
    const b=await require('../bookings/cancellation.service').getBooking(c,id);
    const {hash,old}=await receipt(c,input.request_key,actor,{operation:'collection',id,amount,method:input.method,reference,note});
    if(old) return {collection_id:old.collection_id,already_recorded:true};
    if(b.status==='cancelled') throw fail('Cancelled bookings cannot accept manual collections');
    const current=await total(c,id);
    if(current!==paisa(b.amount_paid || 0) || (b.payment_status==='paid'&&current===0)) throw fail('Historical payment mismatch requires reconciliation before recording money');
    const price=paisa(b.price);
    if(amount>Math.max(price-current,0)) throw fail('Amount exceeds the current outstanding balance');
    const [r]=await c.query(`INSERT INTO booking_collections
      (booking_id,kind,amount,method,reference,reference_key,note,actor_id,actor_name,created_at,recorded_at)
      VALUES (?,'collection',?,?,?,?,?,?,?,?,?)`,[id,money(amount),input.method,reference||null,input.method==='cash'?null:input.method+':'+reference.toLowerCase(),note,actor.id,await actorName(c,actor),now,now]);
    const received=current+amount, paymentStatus=received>=price?'paid':'partially_paid';
    const status=b.status==='pending'&&received>=await advance(c,b.price)?'approved':b.status;
    await c.query('UPDATE bookings SET amount_paid=?,payment_status=?,status=? WHERE id=?',[money(received),paymentStatus,status,id]);
    await outbox.transition(c,b,{status,amount_paid:money(received),payment_status:paymentStatus});
    if(status==='approved'&&b.status==='pending') notify={...b,status,amount_paid:money(received),payment_status:paymentStatus};
    await saveReceipt(c,input.request_key,actor,hash,r.insertId,now);
    return {collection_id:r.insertId,already_recorded:false};
  }).catch(duplicate);
  if(notify) require('../notifications/notification.service').notifyBookingApproved(notify);
  return result;
}
async function reverse(id,input,actor,now=Date.now()) {
  id=positiveId(id);const reason=text(input.reason,500,true);
  return outbox.transaction(async c=>{
    const [[ref]]=await c.query('SELECT booking_id FROM booking_collections WHERE id=?',[id]);
    if(!ref) throw fail('Collection not found',404);
    const b=await require('../bookings/cancellation.service').getBooking(c,ref.booking_id);
    const {hash,old}=await receipt(c,input.request_key,actor,{operation:'reversal',id,reason});
    if(old) return {collection_id:old.collection_id,already_recorded:true};
    const [[entry]]=await c.query('SELECT * FROM booking_collections WHERE id=? FOR UPDATE',[id]);
    if(b.status==='cancelled') throw fail('Cancelled booking corrections require separate reconciliation');
    if(entry.kind!=='collection'||!manualMethods.includes(entry.method)) throw fail('Only manual collections can be reversed');
    const [[reversed]]=await c.query('SELECT id FROM booking_collections WHERE reversal_of=? FOR UPDATE',[id]);
    if(reversed) throw fail('Collection already reversed');
    const current=await total(c,b.id);
    if(current!==paisa(b.amount_paid||0)) throw fail('Historical payment mismatch requires reconciliation');
    const received=current-paisa(entry.amount);
    if(received<0) throw fail('Reversal would make received amount negative');
    const [r]=await c.query(`INSERT INTO booking_collections
      (booking_id,kind,amount,method,reference,note,actor_id,actor_name,created_at,recorded_at,reversal_of)
      VALUES (?,'reversal',?,?,?,?,?,?,?,?,?)`,[b.id,entry.amount,entry.method,entry.reference,reason,actor.id,await actorName(c,actor),now,now,id]);
    await c.query('UPDATE bookings SET amount_paid=?,payment_status=? WHERE id=?',[money(received),received===0?'unpaid':received>=paisa(b.price)?'paid':'partially_paid',b.id]);
    await saveReceipt(c,input.request_key,actor,hash,r.insertId,now);
    return {collection_id:r.insertId,already_recorded:false};
  }).catch(duplicate);
}
async function gateway(c,b,payment,validation,now=Date.now()) {
  await c.query(`INSERT INTO booking_collections
    (booking_id,kind,amount,method,reference,note,created_at,recorded_at,gateway_transaction_id)
    VALUES (?,'collection',?,'gateway',?,'Verified gateway payment',?,?,?)`,
    [b.id,Number(validation.amount).toFixed(2),validation.bank_tran_id||validation.tran_id||payment.tran_id,now,now,payment.id]);
}
async function history(id) {
  id=positiveId(id);
  return outbox.transaction(async c=>{
    const b=await require('../bookings/cancellation.service').getBooking(c,id);
    const [entries]=await c.query(`SELECT c.*,r.id AS reversed_by_entry FROM booking_collections c
      LEFT JOIN booking_collections r ON r.reversal_of=c.id WHERE c.booking_id=? ORDER BY c.id DESC`,[id]);
    const [gatewayHistory]=await c.query('SELECT id,tran_id,amount,status,bank_tran_id,created_at FROM payment_transactions WHERE booking_id=? ORDER BY id DESC',[id]);
    const received=await total(c,id),price=paisa(b.price),required=await advance(c,b.price);
    return {booking_id:id,status:b.status,price:money(price),received:money(received),outstanding:money(Math.max(price-received,0)),excess:money(Math.max(received-price,0)),
      review_required:received!==paisa(b.amount_paid||0)||(b.payment_status==='paid'&&received===0),
      advance_review:b.status==='approved'&&received<required,required_advance:money(required),
      entries:entries.map(e=>({...e,created_at:e.created_at==null?null:new Date(Number(e.created_at)).toISOString(),can_reverse:b.status!=='cancelled'&&e.kind==='collection'&&manualMethods.includes(e.method)&&!e.reversed_by_entry})),gateway_history:gatewayHistory};
  });
}
module.exports={record,reverse,gateway,history,paisa,money,positiveId,fail,manualMethods};
