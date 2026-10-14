export type CalendarStatus = 'available' | 'booked' | 'pending' | 'held' | 'season_reserved' | 'blocked' | 'inactive' | 'past';
export interface CalendarSlot {
  id: number; start_time: string; end_time: string; price: number; is_active: boolean;
}
export interface CalendarCell {
  slot_id: number; date: string; status: CalendarStatus; is_past: boolean; conflict: boolean;
  booking: { id: number; customer_name: string; customer_phone: string; team_name: string | null;
    status: string; payment_status: string; amount_paid: number; balance_due: number } | null;
  block_reason: string | null; hold_expires_at: string | null;
  seasons: { id: number; customer_name: string; customer_phone: string; team_name: string | null; start_date: string; end_date: string }[];
}
export interface CalendarResponse {
  start_date: string; end_date: string; timezone: string; server_time: string; dates: string[];
  slots: CalendarSlot[]; cells: CalendarCell[]; counts: Record<CalendarStatus, number>;
}
export const CALENDAR_STATUSES: { key: CalendarStatus; label: string; icon: string }[] = [
  { key: 'available', label: 'Available', icon: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z' },
  { key: 'booked', label: 'Booked', icon: 'M4 10l4 4 8-8' },
  { key: 'pending', label: 'Pending', icon: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z M10 6v4l3 2' },
  { key: 'held', label: 'Held', icon: 'M5 3h10M5 17h10M6 3v3l8 8v3M14 3v3l-8 8v3' },
  { key: 'season_reserved', label: 'Season Reserved', icon: 'M4 7h12l-3-3M16 13H4l3 3' },
  { key: 'blocked', label: 'Blocked', icon: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z M5 5l10 10' },
  { key: 'inactive', label: 'Inactive', icon: 'M7 4v12M13 4v12' },
  { key: 'past', label: 'Past', icon: 'M4 10h12' }
];
export function dhakaToday(now = new Date()): string {
  return new Date(now.getTime() + 6 * 3600000).toISOString().slice(0, 10);
}
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function calendarRange(date: string, view: 'week' | 'day'): [string, string] {
  const start = view === 'week' ? shiftDate(date, -new Date(`${date}T00:00:00Z`).getUTCDay()) : date;
  return [start, view === 'week' ? shiftDate(start, 6) : start];
}
