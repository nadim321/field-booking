export type PaymentOutcome = 'checking' | 'success' | 'received' | 'approved' | 'failed' | 'cancelled' | 'error' | 'requested' | 'booking_cancelled';
export interface BookingResult {
  booking_id: number;
  booking_date: string;
  start_time: string;
  end_time: string;
  price: number;
  price_source?: 'captured' | 'legacy_estimate';
  amount_paid: number;
  balance_due: number;
  refund_amount?: number;
  refunded_amount?: number;
  status: string;
  payment_status: string;
  payment_attempt?: { verified_payment: boolean; state: string; verification_needed: boolean };
}
export function resultOutcome(result: BookingResult): PaymentOutcome {
  if (result.status === 'cancelled') return 'booking_cancelled';
  if (result.payment_attempt?.verified_payment && Number(result.amount_paid) > 0) return result.status === 'approved' ? 'success' : 'received';
  if (result.status === 'approved') return 'approved';
  if (result.payment_attempt?.state === 'failed' || result.payment_attempt?.state === 'expired') return 'failed';
  if (result.payment_attempt?.state === 'cancelled') return 'cancelled';
  return result.payment_attempt?.state === 'none' ? 'requested' : 'checking';
}
