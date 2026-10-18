const db=require('../../database');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const statuses=['pending','approved','cancelled'];
const paymentStatuses=['unpaid','partially_paid','paid'];
function validDate(value,label) {
  if(value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fail(`Invalid ${label}`);
  return value;
}
function filters(query) {
  let q=query.q??'';
  if(typeof q!=='string')throw fail('Invalid search query');
  q=q.trim();if(q.length>100)throw fail('Search query is too long');
  const dateFrom=validDate(query.date_from,'start date'),dateTo=validDate(query.date_to,'end date');
  if(dateFrom&&dateTo&&dateFrom>dateTo)throw fail('Start date must not be after end date');
  const status=query.status||'';if(status&&!statuses.includes(status))throw fail('Invalid booking status');
  const paymentStatus=query.payment_status||'';if(paymentStatus&&!paymentStatuses.includes(paymentStatus))throw fail('Invalid payment status');
  const page=Number(query.page??1),pageSize=Number(query.page_size??25);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail('Invalid page');
  if(![10,25,50,100].includes(pageSize))throw fail('Page size must be 10, 25, 50 or 100');
  return {q,dateFrom,dateTo,status,paymentStatus,page,pageSize};
}
function where(f) {
  const terms=[],values=[];
  if(f.q){if(/^\d+$/.test(f.q)&&Number.isSafeInteger(Number(f.q)))terms.push('(b.id=? OR LOCATE(LOWER(?),LOWER(b.customer_phone))>0 OR LOCATE(LOWER(?),LOWER(COALESCE(b.team_name, \'\')))>0)'),values.push(Number(f.q),f.q,f.q);else terms.push('(LOCATE(LOWER(?),LOWER(b.customer_phone))>0 OR LOCATE(LOWER(?),LOWER(COALESCE(b.team_name, \'\')))>0)'),values.push(f.q,f.q);}
  if(f.dateFrom){terms.push('b.booking_date>=?');values.push(f.dateFrom);}
  if(f.dateTo){terms.push('b.booking_date<=?');values.push(f.dateTo);}
  if(f.status){terms.push('b.status=?');values.push(f.status);}
  if(f.paymentStatus){terms.push('b.payment_status=?');values.push(f.paymentStatus);}
  return {sql:terms.length?' WHERE '+terms.join(' AND '):'',values};
}
const select=`SELECT b.*,s.start_time,s.end_time,b.booking_price AS price,c.refund_amount,c.refunded_amount,
 c.source AS cancellation_source,c.reason AS cancellation_reason,
 COALESCE(pm.methods,b.payment_method,'unknown') AS payment_methods
 FROM bookings b JOIN slots s ON s.id=b.slot_id LEFT JOIN booking_cancellations c ON c.booking_id=b.id
 LEFT JOIN (SELECT booking_id,GROUP_CONCAT(DISTINCT method ORDER BY method SEPARATOR ', ') AS methods
   FROM booking_collections WHERE kind='collection' GROUP BY booking_id) pm ON pm.booking_id=b.id`;
async function list(query) {
  if(!db.cancellationReady)throw Object.assign(new Error('Booking maintenance in progress'),{status:503});
  const f=filters(query),w=where(f),connection=await db.promiseConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.beginTransaction();
    const [[count]]=await connection.query('SELECT COUNT(*) AS total FROM bookings b'+w.sql,w.values);
    const [items]=await connection.query(select+w.sql+' ORDER BY b.booking_date DESC,TIME(s.start_time) ASC,b.id DESC LIMIT ? OFFSET ?', [...w.values,f.pageSize,(f.page-1)*f.pageSize]);
    await connection.commit();return {items,page:f.page,page_size:f.pageSize,total:Number(count.total)};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
function csvCell(value){let text=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function csvRow(row){return [row.id,row.booking_date,row.start_time,row.end_time,row.customer_name,row.customer_phone,row.customer_email,row.team_name,row.price,row.amount_paid,Math.max(Number(row.price)-Number(row.amount_paid),0),row.refund_amount,row.refunded_amount,Math.max(Number(row.refund_amount||0)-Number(row.refunded_amount||0),0),row.status,row.payment_status,row.payment_methods].map(csvCell).join(',')+'\r\n';}
async function exportCsv(query,res,next){
  if(!db.cancellationReady)return res.status(503).json({message:'Booking maintenance in progress'});
  const f=filters(query),w=where(f),connection=await db.promiseConnection();
  res.status(200).set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="bookings-${f.dateFrom||'all'}-${f.dateTo||'all'}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.write('\uFEFF'+['Booking ID','Booking date','Start time','End time','Customer','Phone','Email','Team','Price BDT','Received BDT','Outstanding BDT','Refund due BDT','Refunded BDT','Refund outstanding BDT','Booking status','Payment status','Payment methods'].map(csvCell).join(',')+'\r\n');
  const sql=select+w.sql+' ORDER BY b.booking_date DESC,TIME(s.start_time) ASC,b.id DESC';
  const stream=connection.connection.query(sql,w.values).stream({highWaterMark:32});
  let released=false;
  const release=()=>{if(!released){released=true;connection.release();}};
  stream.on('data',row=>{if(!res.write(csvRow(row)))stream.pause();});
  res.on('drain',()=>stream.resume());
  stream.on('end',()=>{release();res.end();});
  stream.on('error',error=>{release();if(res.headersSent)res.destroy(error);else next(error);});
  res.on('close',()=>{if(!stream.destroyed)stream.destroy();release();});
}
module.exports={filters,where,list,exportCsv};
