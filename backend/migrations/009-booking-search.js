exports.up=async c=>{
  const [indexes]=await c.query('SHOW INDEX FROM bookings');
  const names=new Set(indexes.map(x=>x.Key_name));
  for(const [name,columns] of Object.entries({
    ix_bookings_date_status_payment:'booking_date,status,payment_status,id',
    ix_bookings_status_payment_date:'status,payment_status,booking_date,id'
  }))if(!names.has(name))await c.query(`ALTER TABLE bookings ADD INDEX ${name} (${columns})`);
};
