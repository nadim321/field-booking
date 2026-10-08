import { BookingResult, resultOutcome } from './payment-result';
describe('verified payment results', () => {
  const booking = { status: 'pending', amount_paid: 0, payment_attempt: { state: 'pending', verified_payment: false } } as BookingResult;
  it('never derives success from approval alone', () => expect(resultOutcome({ ...booking, status: 'approved' })).toBe('approved'));
  it('waits for server validation', () => expect(resultOutcome(booking)).toBe('checking'));
  it('gives cancellation priority over verified money', () => expect(resultOutcome({ ...booking, status: 'cancelled', amount_paid: 500, payment_attempt: { state: 'paid', verified_payment: true, verification_needed: false } })).toBe('booking_cancelled'));
  it('confirms only verified paid and approved bookings', () => expect(resultOutcome({ ...booking, status: 'approved', amount_paid: 500, payment_attempt: { state: 'paid', verified_payment: true, verification_needed: false } })).toBe('success'));
});
