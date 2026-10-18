const db = require('../database');
const notificationService = require('../services/notifications/notification.service');
const cancellationService = require('../services/bookings/cancellation.service');

function cancellationError(res, error) {
  if (!error.status || error.status >= 500) return res.fail(error);
  return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not complete cancellation/refund operation' });
}

exports.list = async (req,res) => {
  try {res.set('Cache-Control','no-store').json(await require('../services/bookings/admin-list.service').list(req.query));}
  catch(error){if(error.status)return res.status(error.status).json({message:error.message});res.fail(error);}
};
exports.exportCsv=async(req,res,next)=>require('../services/bookings/admin-list.service').exportCsv(req.query,res,next);

exports.quote = async (req, res) => {
  try { res.json(await cancellationService.cancel(req.params.id, req.query.source || 'customer', '', req.user.id, true)); }
  catch (error) { cancellationError(res, error); }
};

exports.cancel = async (req, res) => {
  try {
    const result = await cancellationService.cancel(req.params.id, req.body.source, req.body.reason, req.user.id);
    if (result.booking) notificationService.notifyBookingCancelled({ ...result.booking, refund_amount: result.refund_amount });
    const { booking, ...response } = result;
    res.json(response);
  } catch (error) { cancellationError(res, error); }
};

exports.refund = async (req, res) => {
  try { res.json(await cancellationService.recordRefund(req.params.id, req.body.reference, req.body.amount, req.user.id)); }
  catch (error) { cancellationError(res, error); }
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { status, payment_status } = req.body;
  if (payment_status !== undefined || req.body.amount_paid !== undefined) return res.status(400).json({message:'Use Record Payment or an audited reversal to change received amounts.'});
  if (status && !['pending','approved'].includes(status)) return res.status(400).json({ message: 'Use the cancellation workflow to cancel a booking; otherwise choose pending or approved.' });
  if (payment_status && !['paid','unpaid'].includes(payment_status)) return res.status(400).json({ message: 'Invalid payment status value' });
  if (!status && !payment_status) return res.status(400).json({ message: 'Provide status or payment_status to update' });
  const notify = await cancellationService.transaction(async c => {
    const before = await cancellationService.getBooking(c,id);
    if (before.status === 'cancelled') throw Object.assign(new Error('Cancelled bookings cannot be reopened or have payments edited.'),{status:409});
    const after = { status: status || before.status, payment_status: payment_status || before.payment_status,
      amount_paid: payment_status === 'paid' ? before.price : before.amount_paid };
    await c.query('UPDATE bookings SET status=?,payment_status=?,amount_paid=? WHERE id=?',[after.status,after.payment_status,after.amount_paid,id]);
    await require('../services/notifications/outbox.service').transition(c,before,after);
    return before.status !== 'approved' && after.status === 'approved' ? {...before,...after} : null;
  });
  if (notify) notificationService.notifyBookingApproved(notify);
  res.json({message:'Booking updated successfully'});
};

exports.remove = (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM bookings WHERE id = ? AND amount_paid = 0 AND payment_status = 'unpaid' AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE booking_id = ?) AND NOT EXISTS (SELECT 1 FROM booking_cancellations WHERE booking_id = ?) AND NOT EXISTS (SELECT 1 FROM booking_collections WHERE booking_id = ?)", [id, id, id, id], function (err) {
    if (err) {
      return res.fail(err);
    }
    if (this.changes === 0) {
      return res.status(409).json({ message: 'Booking not found or protected by payment/refund history. Cancel instead of deleting.' });
    }
    res.json({ message: 'Booking deleted successfully' });
  });
};
