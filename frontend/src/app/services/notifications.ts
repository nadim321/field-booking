export type NotificationStatus = 'queued' | 'processing' | 'retrying' | 'simulated' | 'sent' | 'failed' | 'skipped';
export type NotificationEvent = 'booking_created' | 'booking_confirmed' | 'booking_cancelled' | 'reminder';
export interface NotificationJob {
  id: number; booking_id: number; event: NotificationEvent; status: NotificationStatus; recipient: string;
  scheduled_at: string; next_attempt_at: string; updated_at: string; attempts: number; last_error: string | null; can_retry: boolean; can_resend: boolean; resend_unavailable_reason: string | null; source_job_id: number | null; requested_by: number | null;
}
export interface NotificationPage { mode: 'mock'; items: NotificationJob[]; page: number; page_size: number; total: number; }
export interface NotificationDetail extends NotificationJob {
  message: string;
  history: { id: number; attempt_number: number; outcome: string; started_at: string; finished_at: string | null; error_code: string | null; message: string | null; actor_id: number | null }[];
}
