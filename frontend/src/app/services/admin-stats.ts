export interface AdminRevenue {
  approved_booking_value: number;
  received_amount: number;
  approved_outstanding: number;
  pending_outstanding: number;
  refunded_amount: number;
  refund_outstanding: number;
  net_received: number;
  legacy_estimate_count: number;
  missing_paid_amount_count: number;
  total_approved: number;
  total_paid: number;
  pending_payment: number;
}
export interface AdminStats {
  bookings: { total: number; pending: number; approved: number; cancelled: number };
  revenue: AdminRevenue;
  popular_slots: { start_time: string; end_time: string; booking_count: number }[];
  recent_occupancy: { booking_date: string; count: number }[];
}
