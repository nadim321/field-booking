const outbox=require('../notifications/outbox.service');
const {fail,positiveId,manualMethods}=require('./collection.service');
function range(query) {
  const today=new Date(Date.now()+6*3600000).toISOString().slice(0,10);
  const start=query.start||today,end=query.end||start;
  for(const date of [start,end]) if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) throw fail('Invalid report date',400);
  const from=Date.parse(start+'T00:00:00+06:00'),to=Date.parse(end+'T00:00:00+06:00')+86400000;
  if(to<=from||to-from>366*86400000) throw fail('Choose an ordered date range of up to 366 days',400);
  return {start,end,from,to};
}
async function report(query,exportAll=false) {
  const dates=range(query),page=positiveId(query.page||1),params=[dates.from,dates.to];
  if(page>100000) throw fail('Page out of range',400);
  let where="c.kind<>'opening' AND c.created_at>=? AND c.created_at<?";
  if(query.method){if(![...manualMethods,'gateway'].includes(query.method))throw fail('Invalid collection method',400);where+=' AND c.method=?';params.push(query.method);}
  if(query.staff_id){where+=' AND c.actor_id=?';params.push(positiveId(query.staff_id));}
  const sums="COALESCE(SUM(CASE WHEN c.kind='collection' THEN c.amount ELSE 0 END),0) AS gross, COALESCE(SUM(CASE WHEN c.kind='reversal' THEN c.amount ELSE 0 END),0) AS corrections, COALESCE(SUM(CASE WHEN c.kind='reversal' THEN -c.amount ELSE c.amount END),0) AS net";
  return outbox.transaction(async c=>{
    const [[summary]]=await c.query(`SELECT COUNT(*) AS count,${sums} FROM booking_collections c WHERE ${where}`,params);
    if(exportAll&&Number(summary.count)>50000)throw fail('Export exceeds 50000 entries; choose a smaller date range',400);
    const [items]=await c.query(`SELECT c.id,c.booking_id,c.kind,c.amount,c.method,c.reference,c.note,c.actor_id,c.actor_name,c.created_at,c.reversal_of FROM booking_collections c WHERE ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,[...params,exportAll?50000:25,exportAll?0:(page-1)*25]);
    const [by_method]=await c.query(`SELECT c.method,${sums} FROM booking_collections c WHERE ${where} GROUP BY c.method ORDER BY c.method`,params);
    const [by_staff]=await c.query(`SELECT c.actor_id,MAX(c.actor_name) AS actor_name,${sums} FROM booking_collections c WHERE ${where} GROUP BY c.actor_id ORDER BY c.actor_id`,params);
    // Refund methods were never recorded: show date-range total, not an inferred cash balance.
    const [[refund]]=await c.query('SELECT COALESCE(SUM(amount),0) AS amount FROM refund_settlements WHERE UNIX_TIMESTAMP(created_at)*1000>=? AND UNIX_TIMESTAMP(created_at)*1000<?',[dates.from,dates.to]);
    const [staff]=await c.query('SELECT DISTINCT actor_id AS id,actor_name AS name FROM booking_collections WHERE actor_id IS NOT NULL ORDER BY actor_id');
    return {start:dates.start,end:dates.end,page,page_size:25,total:Number(summary.count),summary,by_method,by_staff,staff,
      refunded_amount:refund.amount,refund_scope:'All completed refunds in this date range; method/staff filters do not apply. Refund method is unknown.',
      items:items.map(x=>({...x,created_at:new Date(Number(x.created_at)).toISOString()}))};
  });
}
function csv(data) {
  const cell=value=>{let s=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['Entry','Booking','Kind','Amount BDT','Net BDT','Method','Reference','Staff ID','Staff','Received/Corrected Asia/Dhaka','Note','Reversal of']];
  for(const x of data.items)rows.push([x.id,x.booking_id,x.kind,x.amount,x.kind==='reversal'?-Number(x.amount):Number(x.amount),x.method,x.reference,x.actor_id,x.actor_name||'Gateway system',new Date(Date.parse(x.created_at)+6*3600000).toISOString().replace('T',' ').slice(0,19),x.note,x.reversal_of]);
  return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
module.exports={report,csv,range};
